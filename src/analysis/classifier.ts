import { drive_v3 } from 'googleapis'
import type { ImageAnalysis } from './image-analyzer.js'
import type { VideoAnalysis } from './video-analyzer.js'
import type { DocumentAnalysis } from './document-analyzer.js'

type DriveFile = drive_v3.Schema$File

export type AnalysisStrategy = 'url_only' | 'memory_stream' | 'partial_download' | 'metadata_only'

export interface ClassificationResult {
  targetPath: string[]
  targetFolderId?: string
  rename: string
  confidence: number
  reason: string
  strategy: AnalysisStrategy
  requiresManualReview: boolean
  isDuplicate: boolean
}

type AnyAnalysis = ImageAnalysis | VideoAnalysis | DocumentAnalysis

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .slice(0, 200)
    .trim()
}

function buildDatePrefix(
  year: number | null,
  metadata: DriveFile
): string | null {
  const dateStr = metadata.imageMediaMetadata?.time
    ?? metadata.createdTime
    ?? null

  if (!dateStr) return year ? String(year) : null

  try {
    const d = new Date(dateStr)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  } catch {
    return year ? String(year) : null
  }
}

function getExtension(metadata: DriveFile): string {
  if (metadata.fileExtension) return `.${metadata.fileExtension}`
  const name = metadata.name ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot) : ''
}

export function resolveStrategy(mimeType: string, _sizeBytes: number): AnalysisStrategy {
  if (mimeType.startsWith('image/')) return 'url_only'
  if (mimeType.startsWith('video/')) return 'url_only'
  if (mimeType.startsWith('application/vnd.google-apps.')) return 'memory_stream'
  if (mimeType.startsWith('text/')) return 'memory_stream'
  if (mimeType === 'application/pdf') return 'partial_download'
  return 'metadata_only'
}

export function classify(
  metadata: DriveFile,
  analysis: AnyAnalysis,
  strategy: AnalysisStrategy,
  knownChecksums: Set<string>
): ClassificationResult {
  const a = analysis as unknown as Record<string, unknown>
  const theme = a['theme'] as string ?? 'otro'
  const confidence = a['confidence'] as number ?? 0
  const suggestedName = a['suggestedName'] as string ?? 'sin_nombre'
  const estimatedYear = a['estimatedYear'] as number | null ?? null
  const project = a['project'] as string | null ?? null

  // Check for duplicates
  const isDuplicate = !!(
    metadata.md5Checksum && knownChecksums.has(metadata.md5Checksum)
  )
  if (metadata.md5Checksum) knownChecksums.add(metadata.md5Checksum)

  if (isDuplicate) {
    return {
      targetPath: ['_Duplicados'],
      rename: metadata.name ?? 'duplicado',
      confidence: 1,
      reason: 'Duplicate file (same md5Checksum)',
      strategy,
      requiresManualReview: false,
      isDuplicate: true,
    }
  }

  // Build target path
  let targetPath: string[]
  const year = estimatedYear ?? (metadata.createdTime ? new Date(metadata.createdTime).getFullYear() : null)
  const yearStr = year ? String(year) : null

  if (confidence < 0.4) {
    targetPath = ['_Revisar']
  } else {
    switch (theme) {
      case 'vacaciones':
        targetPath = yearStr ? [yearStr, 'Personal', 'Vacaciones'] : ['Personal', 'Vacaciones']
        break
      case 'trabajo':
        targetPath = project
          ? (yearStr ? [yearStr, 'Trabajo', project] : ['Trabajo', project])
          : (yearStr ? [yearStr, 'Trabajo'] : ['Trabajo'])
        break
      case 'familia':
        targetPath = yearStr ? [yearStr, 'Personal', 'Familia'] : ['Personal', 'Familia']
        break
      case 'eventos':
        targetPath = yearStr ? [yearStr, 'Personal', 'Eventos'] : ['Personal', 'Eventos']
        break
      case 'legal':
      case 'financiero': {
        const docType = a['documentType'] as string ?? 'otro'
        targetPath = yearStr ? [yearStr, 'Documentos', docType] : ['Documentos', docType]
        break
      }
      case 'capturas':
        targetPath = yearStr ? [yearStr, 'Capturas'] : ['Capturas']
        break
      case 'educacion':
        targetPath = yearStr ? [yearStr, 'Educacion'] : ['Educacion']
        break
      case 'tutoriales':
        targetPath = ['Educacion', 'Tutoriales']
        break
      default:
        targetPath = ['_Revisar']
    }
  }

  // Build final filename
  const ext = getExtension(metadata)
  const datePrefix = buildDatePrefix(estimatedYear, metadata)
  const cleanName = sanitizeFilename(suggestedName)
  const rename = datePrefix
    ? `${datePrefix}_${cleanName}${ext}`
    : `${cleanName}${ext}`

  return {
    targetPath,
    rename,
    confidence,
    reason: `theme=${theme}, confidence=${confidence.toFixed(2)}, strategy=${strategy}`,
    strategy,
    requiresManualReview: confidence < 0.4,
    isDuplicate: false,
  }
}
