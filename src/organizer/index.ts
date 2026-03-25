import * as fs from 'fs/promises'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
import { drive_v3 } from 'googleapis'
import { DriveClient } from '../mcp-server/drive-client.js'
import { DRIVE_FILE_FIELDS } from '../mcp-server/drive-client.js'
import { tempManager } from '../analysis/temp-manager.js'
import { analyzeImage } from '../analysis/image-analyzer.js'
import { analyzeVideo } from '../analysis/video-analyzer.js'
import { analyzeDocument } from '../analysis/document-analyzer.js'
import { classify, resolveStrategy, ClassificationResult } from '../analysis/classifier.js'
import { FolderMapper } from './folder-mapper.js'
import { DryRunLog } from './dry-run.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

type DriveFile = drive_v3.Schema$File
type DriveInstance = ReturnType<typeof import('googleapis').google.drive>

export interface ProgressInfo {
  current: number
  total: number
  filename: string
  strategy: string
  diskUsageMB: number
  action: 'analyzing' | 'moving' | 'skipped' | 'error' | 'cleanup'
}

interface OrganizeOptions {
  userId: string
  dryRun: boolean
  folderId?: string
  batchSize?: number
  delayMs?: number
  onProgress?: (info: ProgressInfo) => void
}

interface Report {
  summary: {
    totalFiles: number
    moved: number
    skipped: number
    errors: number
    peakDiskUsageMB: number
  }
  byStrategy: Record<string, number>
  byCategory: Record<string, number>
  decisions: Array<{
    fileId: string
    fileName: string
    targetPath: string[]
    rename: string
    confidence: number
    strategy: string
  }>
  lowConfidence: Array<{ fileId: string; fileName: string; confidence: number }>
  skippedFiles: Array<{ fileId: string; fileName: string; reason: string }>
  errors: Array<{ fileId: string; fileName: string; error: string }>
  dryRun?: ReturnType<DryRunLog['getEntries']>
}

// ALL native Google Workspace types are skipped — folders, shortcuts, forms, etc.
// can't be moved or meaningfully analyzed. We only process real files.
const GOOGLE_WORKSPACE_PREFIX = 'application/vnd.google-apps.'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function getAllFiles(
  drive: DriveInstance,
  folderId?: string,
  onProgress?: (count: number) => void
): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const queryParts = ['trashed = false']
    if (folderId) queryParts.push(`'${folderId}' in parents`)

    const res = await drive.files.list({
      q: queryParts.join(' and '),
      pageSize: 1000,
      pageToken,
      fields: `nextPageToken, files(${DRIVE_FILE_FIELDS})`,
    })

    const batch = res.data.files ?? []
    files.push(...batch)
    pageToken = res.data.nextPageToken ?? undefined
    onProgress?.(files.length)
  } while (pageToken)

  return files
}

async function analyzeFile(
  file: DriveFile,
  drive: DriveInstance
): Promise<ReturnType<typeof classify> | null> {
  const mime = file.mimeType ?? ''
  const size = Number(file.size ?? 0)
  const strategy = resolveStrategy(mime, size)

  // Skip native Google Workspace files — can't move them
  if (mime.startsWith(GOOGLE_WORKSPACE_PREFIX)) {
    return null
  }

  let analysis
  try {
    if (mime.startsWith('image/')) {
      analysis = await analyzeImage(file.id!, file)
    } else if (mime.startsWith('video/')) {
      analysis = await analyzeVideo(file.id!, file)
    } else {
      analysis = await analyzeDocument(file.id!, file, drive)
    }
  } catch {
    return null
  }

  const knownChecksums = new Set<string>()
  return classify(file, analysis, strategy, knownChecksums)
}

export async function organizeDrive(options: OrganizeOptions): Promise<Report> {
  const {
    userId,
    dryRun,
    folderId,
    batchSize = Number(process.env.DEFAULT_BATCH_SIZE ?? 10),
    delayMs = Number(process.env.DEFAULT_DELAY_MS ?? 1500),
    onProgress,
  } = options

  const report: Report = {
    summary: { totalFiles: 0, moved: 0, skipped: 0, errors: 0, peakDiskUsageMB: 0 },
    byStrategy: {},
    byCategory: {},
    decisions: [],
    lowConfidence: [],
    skippedFiles: [],
    errors: [],
  }

  const dryRunLog = dryRun ? new DryRunLog() : null

  // Clean up stale temp files from previous runs
  await tempManager.cleanupStale()

  let peakDisk = 0

  try {
    const client = await DriveClient.forUser(userId)
    const drive = client.getDrive()
    const accessToken = await client.getAccessToken() ?? undefined

    console.log(`[organizer] Fetching file list for user: ${userId}`)
    console.log(folderId ? `[organizer] Scope: folder ${folderId}` : '[organizer] Scope: entire Drive')

    process.stdout.write('[organizer] Listing files ')
    const allFiles = await getAllFiles(drive, folderId, (count) => {
      process.stdout.write(`\r[organizer] Listing files: ${count} found...`)
    })
    console.log(`\n[organizer] Found ${allFiles.length} files`)

    report.summary.totalFiles = allFiles.length

    const folderMapper = dryRun ? null : new FolderMapper(drive)
    const knownChecksums = new Set<string>()

    for (let i = 0; i < allFiles.length; i++) {
      const file = allFiles[i]
      const currentDisk = tempManager.currentUsageMB()
      if (currentDisk > peakDisk) peakDisk = currentDisk

      const mime = file.mimeType ?? ''
      const strategy = resolveStrategy(mime, Number(file.size ?? 0))

      onProgress?.({
        current: i + 1,
        total: allFiles.length,
        filename: file.name ?? 'unknown',
        strategy,
        diskUsageMB: currentDisk,
        action: 'analyzing',
      })

      // Skip native Google Workspace files
      if (mime.startsWith(GOOGLE_WORKSPACE_PREFIX)) {
        report.skippedFiles.push({ fileId: file.id!, fileName: file.name!, reason: 'Native Google Workspace file — cannot be moved' })
        report.summary.skipped++

        const progress = `[${i + 1}/${allFiles.length}] ${file.name?.slice(0, 40).padEnd(40)} → skipped (native workspace)    disk: ${currentDisk}MB`
        console.log(progress)
        continue
      }

      let classification: ClassificationResult | null = null
      try {
        let analysis
        if (mime.startsWith('image/')) {
          analysis = await analyzeImage(file.id!, file, accessToken)
        } else if (mime.startsWith('video/')) {
          analysis = await analyzeVideo(file.id!, file, accessToken)
        } else {
          analysis = await analyzeDocument(file.id!, file, drive)
        }

        classification = classify(file, analysis, strategy, knownChecksums)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        report.errors.push({ fileId: file.id!, fileName: file.name!, error: errMsg })
        report.summary.errors++

        onProgress?.({
          current: i + 1,
          total: allFiles.length,
          filename: file.name ?? 'unknown',
          strategy,
          diskUsageMB: tempManager.currentUsageMB(),
          action: 'error',
        })
        console.log(`[${i + 1}/${allFiles.length}] ${file.name?.slice(0, 40).padEnd(40)} → ERROR: ${errMsg.slice(0, 60)}`)
        continue
      }

      // Update strategy stats
      report.byStrategy[strategy] = (report.byStrategy[strategy] ?? 0) + 1

      const category = classification.targetPath[0] ?? 'unknown'
      report.byCategory[category] = (report.byCategory[category] ?? 0) + 1

      if (classification.requiresManualReview) {
        report.lowConfidence.push({
          fileId: file.id!,
          fileName: file.name!,
          confidence: classification.confidence,
        })
      }

      const pathStr = [...classification.targetPath, classification.rename].join('/')
      const diskAfter = tempManager.currentUsageMB()
      const diskWas = currentDisk
      const diskNote = diskAfter < diskWas ? `cleanup → ${diskAfter}MB` : `disk: ${diskAfter}MB`

      console.log(
        `[${i + 1}/${allFiles.length}] ${(file.name ?? '').slice(0, 35).padEnd(35)} → ${strategy.padEnd(16)} → ${pathStr.slice(0, 50).padEnd(50)}  ${diskNote}`
      )

      if (dryRun) {
        dryRunLog!.record(file.id!, file.name ?? 'unknown', classification)
      } else {
        // Actually move and rename the file
        try {
          const targetFolderId = await folderMapper!.ensurePath(classification.targetPath)

          onProgress?.({
            current: i + 1,
            total: allFiles.length,
            filename: file.name ?? 'unknown',
            strategy,
            diskUsageMB: tempManager.currentUsageMB(),
            action: 'moving',
          })

          // Rename
          await drive.files.update({
            fileId: file.id!,
            requestBody: { name: classification.rename },
            fields: 'id',
          })

          // Move
          const currentParents = file.parents ?? []
          await drive.files.update({
            fileId: file.id!,
            addParents: targetFolderId,
            removeParents: currentParents.join(','),
            fields: 'id',
          })

          report.decisions.push({
            fileId: file.id!,
            fileName: file.name!,
            targetPath: classification.targetPath,
            rename: classification.rename,
            confidence: classification.confidence,
            strategy,
          })
          report.summary.moved++
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          report.errors.push({ fileId: file.id!, fileName: file.name!, error: errMsg })
          report.summary.errors++
        }
      }

      // Rate limiting between batches
      if ((i + 1) % batchSize === 0 && i + 1 < allFiles.length) {
        await sleep(delayMs)
      }
    }

    if (dryRun && dryRunLog) {
      dryRunLog.print()
      report.dryRun = dryRunLog.getEntries()
    }
  } finally {
    await tempManager.cleanupAll()
    onProgress?.({
      current: report.summary.totalFiles,
      total: report.summary.totalFiles,
      filename: 'done',
      strategy: '-',
      diskUsageMB: 0,
      action: 'cleanup',
    })
  }

  report.summary.peakDiskUsageMB = peakDisk

  // Save report
  const reportsDir = path.join(process.cwd(), 'reports')
  await fs.mkdir(reportsDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(reportsDir, `${timestamp}-report.json`)
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n[organizer] Report saved: ${reportPath}`)

  const action = dryRun ? 'DRY RUN' : 'DONE'
  console.log(`\n[organizer] ${action}`)
  console.log(`  Total: ${report.summary.totalFiles}`)
  if (!dryRun) console.log(`  Moved: ${report.summary.moved}`)
  console.log(`  Skipped: ${report.summary.skipped}`)
  console.log(`  Errors: ${report.summary.errors}`)
  console.log(`  Peak disk usage: ${peakDisk}MB`)

  return report
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const userId = args.find(a => a.startsWith('--userId='))?.split('=')[1]
  const dryRun = args.includes('--dry-run')
  const folderId = args.find(a => a.startsWith('--folderId='))?.split('=')[1]

  if (!userId) {
    console.error('Usage: npm run organize -- --userId=<userId> [--dry-run] [--folderId=<id>]')
    process.exit(1)
  }

  organizeDrive({
    userId,
    dryRun,
    folderId,
    onProgress: (info) => {
      if (info.action === 'cleanup') {
        process.stdout.write(`\r[disk cleanup] disk: ${info.diskUsageMB}MB\n`)
      }
    },
  }).catch(err => {
    console.error('[organizer] Fatal error:', err)
    process.exit(1)
  })
}
