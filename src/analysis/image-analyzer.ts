import Anthropic from '@anthropic-ai/sdk'
import { drive_v3 } from 'googleapis'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-5'

export interface ImageAnalysis {
  theme: 'vacaciones' | 'trabajo' | 'familia' | 'eventos' | 'documentos' | 'capturas' | 'otro'
  detectedPeople: boolean
  estimatedYear: number | null
  estimatedLocation: string | null
  quality: 1 | 2 | 3 | 4 | 5
  suggestedName: string
  tags: string[]
  confidence: number
  rawDescription: string
}

type DriveFile = drive_v3.Schema$File

function defaultImageAnalysis(): ImageAnalysis {
  return {
    theme: 'otro',
    detectedPeople: false,
    estimatedYear: null,
    estimatedLocation: null,
    quality: 3,
    suggestedName: 'imagen_sin_clasificar',
    tags: [],
    confidence: 0.1,
    rawDescription: 'No se pudo analizar la imagen',
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

async function analyzeFromMetadataOnly(metadata: DriveFile): Promise<ImageAnalysis> {
  const context = JSON.stringify({
    filename: metadata.name,
    createdTime: metadata.createdTime,
    modifiedTime: metadata.modifiedTime,
    capturedAt: metadata.imageMediaMetadata?.time ?? null,
    location: metadata.imageMediaMetadata?.location ?? null,
    camera: metadata.imageMediaMetadata?.cameraModel ?? null,
  }, null, 2)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: 'Sos un sistema experto en clasificación de archivos. Retornás ÚNICAMENTE un JSON válido, sin markdown.',
    messages: [{
      role: 'user',
      content: `Clasificá esta imagen basándote solo en metadata. Retorná este JSON:
{
  "theme": "<vacaciones|trabajo|familia|eventos|documentos|capturas|otro>",
  "detectedPeople": false,
  "estimatedYear": <número o null>,
  "estimatedLocation": "<lugar o null>",
  "quality": 3,
  "suggestedName": "<nombre_sin_extension>",
  "tags": [],
  "confidence": 0.3,
  "rawDescription": "<descripción basada en metadata>"
}

Metadata: ${context}`,
    }],
  })

  return parseJsonResponse<ImageAnalysis>(response, defaultImageAnalysis())
}

export async function analyzeImage(fileId: string, metadata: DriveFile): Promise<ImageAnalysis> {
  const driveContext = JSON.stringify({
    capturedAt: metadata.imageMediaMetadata?.time ?? null,
    location: metadata.imageMediaMetadata?.location ?? null,
    camera: metadata.imageMediaMetadata?.cameraModel ?? null,
    dimensions: metadata.imageMediaMetadata
      ? `${metadata.imageMediaMetadata.width}x${metadata.imageMediaMetadata.height}`
      : null,
    filename: metadata.name,
    createdTime: metadata.createdTime,
  }, null, 2)

  if (!metadata.thumbnailLink) {
    return analyzeFromMetadataOnly(metadata)
  }

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 500,
    system: `Sos un sistema experto en clasificación de archivos visuales.
Retornás ÚNICAMENTE un JSON válido, sin markdown, sin explicaciones.`,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'url',
            url: metadata.thumbnailLink,
          },
        },
        {
          type: 'text',
          text: `Analizá esta imagen y retorná este JSON exacto:
{
  "theme": "<vacaciones|trabajo|familia|eventos|documentos|capturas|otro>",
  "detectedPeople": <true|false>,
  "estimatedYear": <número o null>,
  "estimatedLocation": "<ciudad/lugar o null>",
  "quality": <1 al 5>,
  "suggestedName": "<nombre_archivo_sin_extension>",
  "tags": ["<tag1>", "<tag2>"],
  "confidence": <0.0 al 1.0>,
  "rawDescription": "<descripción breve en español>"
}

Metadata del archivo (usar como contexto prioritario, especialmente la fecha):
${driveContext}`,
        },
      ],
    }],
  })

  return parseJsonResponse<ImageAnalysis>(response, defaultImageAnalysis())
}
