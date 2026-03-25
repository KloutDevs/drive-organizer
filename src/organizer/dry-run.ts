import type { ClassificationResult } from '../analysis/classifier.js'

export interface DryRunEntry {
  fileId: string
  fileName: string
  currentPath: string[]
  proposedPath: string[]
  proposedName: string
  confidence: number
  reason: string
  strategy: string
  isDuplicate: boolean
  requiresManualReview: boolean
}

// Recursive tree node: keys are folder names, '_files_' holds the leaf entries
interface TreeNode {
  [key: string]: TreeNode | DryRunEntry[]
}

function insertIntoTree(tree: TreeNode, pathParts: string[], entry: DryRunEntry): void {
  let node = tree
  for (const part of pathParts) {
    if (!node[part]) node[part] = {}
    node = node[part] as TreeNode
  }
  if (!Array.isArray(node['_files_'])) node['_files_'] = []
  ;(node['_files_'] as DryRunEntry[]).push(entry)
}

function renderTree(node: TreeNode, indent: string, lines: string[]): void {
  // Separate folder keys from the _files_ leaf
  const folderKeys = Object.keys(node).filter(k => k !== '_files_').sort()
  const files = (node['_files_'] as DryRunEntry[] | undefined) ?? []

  const allItems: Array<{ type: 'folder'; key: string } | { type: 'file'; entry: DryRunEntry }> = [
    ...folderKeys.map(k => ({ type: 'folder' as const, key: k })),
    ...files.map(e => ({ type: 'file' as const, entry: e })),
  ]

  for (let i = 0; i < allItems.length; i++) {
    const isLast = i === allItems.length - 1
    const branch = isLast ? '└── ' : '├── '
    const childIndent = indent + (isLast ? '    ' : '│   ')
    const item = allItems[i]

    if (item.type === 'folder') {
      const childNode = node[item.key] as TreeNode
      const fileCount = countFiles(childNode)
      lines.push(`${indent}${branch}📁 ${item.key}/  (${fileCount} archivo${fileCount !== 1 ? 's' : ''})`)
      renderTree(childNode, childIndent, lines)
    } else {
      const conf = `[${(item.entry.confidence * 100).toFixed(0)}%]`
      const flag = item.entry.requiresManualReview ? ' ⚠' : item.entry.isDuplicate ? ' ♻' : ''
      lines.push(`${indent}${branch}${conf} ${item.entry.proposedName}${flag}`)
    }
  }
}

function countFiles(node: TreeNode): number {
  const files = (node['_files_'] as DryRunEntry[] | undefined) ?? []
  let count = files.length
  for (const key of Object.keys(node)) {
    if (key !== '_files_') count += countFiles(node[key] as TreeNode)
  }
  return count
}

export class DryRunLog {
  private entries: DryRunEntry[] = []

  record(
    fileId: string,
    fileName: string,
    classification: ClassificationResult,
  ): void {
    this.entries.push({
      fileId,
      fileName,
      currentPath: [],
      proposedPath: classification.targetPath,
      proposedName: classification.rename,
      confidence: classification.confidence,
      reason: classification.reason,
      strategy: classification.strategy,
      isDuplicate: classification.isDuplicate,
      requiresManualReview: classification.requiresManualReview,
    })
  }

  print(): void {
    const lines: string[] = []

    lines.push('')
    lines.push('╔══════════════════════════════════════════════════════════════╗')
    lines.push('║           ESTRUCTURA PROPUESTA — SOLO LECTURA                ║')
    lines.push('║     Nada fue movido. Revisá y después corrés sin --dry-run   ║')
    lines.push('╚══════════════════════════════════════════════════════════════╝')
    lines.push('')
    lines.push('My Drive/')

    // Build tree
    const tree: TreeNode = {}
    for (const entry of this.entries) {
      insertIntoTree(tree, entry.proposedPath, entry)
    }

    renderTree(tree, '', lines)

    // Legend
    lines.push('')
    lines.push('Leyenda:')
    lines.push('  [XX%]  confianza del análisis')
    lines.push('  ⚠      confianza baja (<40%) — revisar manualmente')
    lines.push('  ♻      duplicado detectado (mismo md5)')

    // Stats by strategy
    const byStrategy: Record<string, number> = {}
    for (const e of this.entries) {
      byStrategy[e.strategy] = (byStrategy[e.strategy] ?? 0) + 1
    }
    lines.push('')
    lines.push('Estrategias de análisis:')
    for (const [strat, count] of Object.entries(byStrategy).sort()) {
      const desc: Record<string, string> = {
        url_only: 'thumbnail URL → Claude (0 bytes a disco)',
        memory_stream: 'stream en memoria (0 bytes a disco)',
        partial_download: 'descarga parcial → borrado inmediato',
        metadata_only: 'solo metadata y nombre de archivo',
      }
      lines.push(`  ${strat.padEnd(18)} ${count.toString().padStart(4)} archivos  — ${desc[strat] ?? ''}`)
    }

    // Summary
    const total = this.entries.length
    const duplicates = this.entries.filter(e => e.isDuplicate).length
    const lowConf = this.entries.filter(e => e.requiresManualReview).length
    const ready = total - duplicates - lowConf

    lines.push('')
    lines.push('─────────────────────────────────────────────────')
    lines.push(`  Total archivos analizados : ${total}`)
    lines.push(`  Listos para mover         : ${ready}`)
    lines.push(`  Requieren revisión manual : ${lowConf}  (→ _Revisar/)`)
    lines.push(`  Duplicados detectados     : ${duplicates}  (→ _Duplicados/)`)
    lines.push('─────────────────────────────────────────────────')
    lines.push('')
    lines.push('Para ejecutar los movimientos:')
    lines.push('  npm run organize -- --userId=<userId>')
    lines.push('')

    console.log(lines.join('\n'))
  }

  getEntries(): DryRunEntry[] {
    return this.entries
  }
}
