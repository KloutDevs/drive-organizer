import Anthropic from '@anthropic-ai/sdk'
import { drive_v3 } from 'googleapis'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as stream from 'stream'
import { Readable } from 'stream'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'
// @ts-ignore — pdf-parse has no proper ESM types
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { tempManager, TEMP_DIR, TempManagerError } from './temp-manager.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-5'
const MAX_TEXT_STREAM_BYTES = Number(process.env.MAX_TEXT_STREAM_KB ?? 8) * 1024
const MAX_PDF_BYTES = Number(process.env.MAX_PDF_PARTIAL_KB ?? 512) * 1024

type DriveFile = drive_v3.Schema$File
type DriveInstance = ReturnType<typeof import('googleapis').google.drive>

export interface DocumentAnalysis {
  theme: 'trabajo' | 'personal' | 'legal' | 'financiero' | 'educacion' | 'otro'
  project: string | null
  estimatedYear: number | null
  documentType: 'contrato' | 'informe' | 'factura' | 'presentacion' | 'nota' | 'otro'
  language: 'es' | 'en' | 'pt' | 'otro'
  suggestedName: string
  tags: string[]
  confidence: number
}

function defaultDocumentAnalysis(): DocumentAnalysis {
  return {
    theme: 'otro',
    project: null,
    estimatedYear: null,
    documentType: 'otro',
    language: 'otro',
    suggestedName: 'documento_sin_clasificar',
    tags: [],
    confidence: 0.1,
  }
}

function parseJsonResponse<T>(response: Anthropic.Message, fallback: T): T {
  try {
    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleaned) as T
  } catch {
    return fallback
  }
}

async function sendTextToClaude(text: string, metadata: DriveFile): Promise<DocumentAnalysis> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: 'Sos un sistema experto en clasificación de documentos. Retornás ÚNICAMENTE un JSON válido, sin markdown.',
    messages: [{
      role: 'user',
      content: `Analizá este fragmento de documento y retorná ÚNICAMENTE este JSON:
{
  "theme": "<trabajo|personal|legal|financiero|educacion|otro>",
  "project": "<nombre del proyecto o empresa si se detecta, sino null>",
  "estimatedYear": <número o null>,
  "documentType": "<contrato|informe|factura|presentacion|nota|otro>",
  "language": "<es|en|pt|otro>",
  "suggestedName": "<nombre_sugerido_sin_extension>",
  "tags": ["<tag1>"],
  "confidence": <0.0 al 1.0>
}

Nombre del archivo: ${metadata.name ?? 'desconocido'}
Fragmento:
${text.slice(0, 4000)}`,
    }],
  })

  return parseJsonResponse<DocumentAnalysis>(response, defaultDocumentAnalysis())
}

function classifyFromFilenameAndMetadata(metadata: DriveFile): DocumentAnalysis {
  const year = metadata.createdTime ? new Date(metadata.createdTime).getFullYear() : null
  const name = metadata.name ?? 'documento'
  const sanitized = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)

  return {
    theme: 'otro',
    project: null,
    estimatedYear: year,
    documentType: 'otro',
    language: 'otro',
    suggestedName: sanitized || 'documento_sin_clasificar',
    tags: [],
    confidence: 0.15,
  }
}

function isPlainText(mimeType: string): boolean {
  return (
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    mimeType === 'application/javascript'
  )
}

async function readStreamToString(readable: Readable, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytesRead = 0

    readable.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length
      if (bytesRead <= maxBytes) {
        chunks.push(chunk)
      } else {
        const remaining = maxBytes - (bytesRead - chunk.length)
        if (remaining > 0) chunks.push(chunk.slice(0, remaining))
        readable.destroy()
      }
    })
    readable.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    readable.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')))
    readable.on('error', reject)
  })
}

async function writeStreamToFile(readable: Readable, filepath: string, maxBytes: number): Promise<void> {
  const writeStream = await fs.open(filepath, 'w')
  const ws = writeStream.createWriteStream()

  return new Promise((resolve, reject) => {
    let bytesWritten = 0

    readable.on('data', (chunk: Buffer) => {
      bytesWritten += chunk.length
      if (bytesWritten <= maxBytes) {
        ws.write(chunk)
      } else {
        readable.destroy()
      }
    })
    readable.on('end', () => { ws.end(); resolve() })
    readable.on('close', () => { ws.end(); resolve() })
    readable.on('error', (err) => { ws.destroy(); reject(err) })
  })
}

async function analyzeGoogleWorkspaceDoc(
  fileId: string,
  metadata: DriveFile,
  drive: DriveInstance
): Promise<DocumentAnalysis> {
  const res = await drive.files.export(
    { fileId, mimeType: 'text/plain' },
    { responseType: 'text' }
  )
  const text = String(res.data).slice(0, 4000)
  return sendTextToClaude(text, metadata)
}

async function analyzeTextStream(
  fileId: string,
  metadata: DriveFile,
  drive: DriveInstance
): Promise<DocumentAnalysis> {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  )
  const text = await readStreamToString(res.data as Readable, MAX_TEXT_STREAM_BYTES)
  return sendTextToClaude(text, metadata)
}

async function analyzePdfPartial(
  fileId: string,
  metadata: DriveFile,
  drive: DriveInstance
): Promise<DocumentAnalysis> {
  const available = await tempManager.availableBytes()
  if (available < MAX_PDF_BYTES) {
    return classifyFromFilenameAndMetadata(metadata)
  }

  const tmpPath = path.join(TEMP_DIR, `pdf-${fileId}-${Date.now()}.pdf`)
  try {
    await tempManager.register(tmpPath, MAX_PDF_BYTES)

    const res = await drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'stream',
        headers: { Range: `bytes=0-${MAX_PDF_BYTES - 1}` },
      }
    )
    await writeStreamToFile(res.data as Readable, tmpPath, MAX_PDF_BYTES)

    const fileBuffer = await fs.readFile(tmpPath)
    const pdfData = await pdfParse(fileBuffer)
    const text = pdfData.text.slice(0, 4000)
    return sendTextToClaude(text, metadata)
  } catch (err) {
    if (err instanceof TempManagerError) {
      return classifyFromFilenameAndMetadata(metadata)
    }
    throw err
  } finally {
    await tempManager.cleanup(tmpPath)
  }
}

export async function analyzeDocument(
  fileId: string,
  metadata: DriveFile,
  drive: DriveInstance
): Promise<DocumentAnalysis> {
  const mime = metadata.mimeType ?? ''

  if (mime.startsWith('application/vnd.google-apps.')) {
    return analyzeGoogleWorkspaceDoc(fileId, metadata, drive)
  }
  if (isPlainText(mime)) {
    return analyzeTextStream(fileId, metadata, drive)
  }
  if (mime === 'application/pdf') {
    return analyzePdfPartial(fileId, metadata, drive)
  }
  return classifyFromFilenameAndMetadata(metadata)
}
