import Anthropic from '@anthropic-ai/sdk'
import { drive_v3 } from 'googleapis'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { fetchThumbnailAsBase64 } from './thumbnail-fetcher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const MODEL = 'claude-opus-4-5'

export interface VideoAnalysis {
  theme: 'vacaciones' | 'trabajo' | 'familia' | 'eventos' | 'tutoriales' | 'otro'
  duration: number
  estimatedYear: number | null
  scene: string
  suggestedName: string
  tags: string[]
  confidence: number
}

type DriveFile = drive_v3.Schema$File

function defaultVideoAnalysis(): Omit<VideoAnalysis, 'duration'> {
  return {
    theme: 'otro',
    estimatedYear: null,
    scene: 'Sin descripción disponible',
    suggestedName: 'video_sin_clasificar',
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

function classifyVideoFromMetadataOnly(
  metadata: DriveFile,
  durationSec: number | null
): VideoAnalysis {
  const year = metadata.createdTime ? new Date(metadata.createdTime).getFullYear() : null
  const name = metadata.name ?? 'video'
  const sanitized = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)

  return {
    theme: 'otro',
    duration: durationSec ?? 0,
    estimatedYear: year,
    scene: `Video: ${name}`,
    suggestedName: sanitized || 'video_sin_clasificar',
    tags: [],
    confidence: 0.2,
  }
}

export async function analyzeVideo(fileId: string, metadata: DriveFile, accessToken?: string): Promise<VideoAnalysis> {
  const videoMeta = metadata.videoMediaMetadata
  const durationSec = videoMeta?.durationMillis
    ? Math.round(Number(videoMeta.durationMillis) / 1000)
    : null

  const context = JSON.stringify({
    filename: metadata.name,
    duration: durationSec ? `${durationSec}s` : 'unknown',
    resolution: videoMeta ? `${videoMeta.width}x${videoMeta.height}` : null,
    size: metadata.size ? `${Math.round(Number(metadata.size) / 1024 / 1024)}MB` : null,
    createdTime: metadata.createdTime,
    modifiedTime: metadata.modifiedTime,
  }, null, 2)

  if (!metadata.thumbnailLink) {
    return classifyVideoFromMetadataOnly(metadata, durationSec)
  }

  // Drive thumbnailLinks require OAuth — fetch and convert to base64
  const thumbnail = await fetchThumbnailAsBase64(metadata.thumbnailLink, accessToken)
  if (!thumbnail) {
    return classifyVideoFromMetadataOnly(metadata, durationSec)
  }

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: `Sos un sistema experto en clasificación de videos.
Retornás ÚNICAMENTE un JSON válido, sin markdown, sin explicaciones.`,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: thumbnail.mediaType,
              data: thumbnail.data,
            },
          },
          {
            type: 'text',
            text: `Este es el thumbnail representativo de un video. Analizalo y retorná este JSON:
{
  "theme": "<vacaciones|trabajo|familia|eventos|tutoriales|otro>",
  "estimatedYear": <número o null>,
  "scene": "<descripción breve de la escena>",
  "suggestedName": "<nombre_sugerido_sin_extension>",
  "tags": ["<tag1>"],
  "confidence": <0.0 al 1.0>
}

Metadata del video:
${context}`,
          },
        ],
      }],
    })

    const parsed = parseJsonResponse<Omit<VideoAnalysis, 'duration'>>(response, defaultVideoAnalysis())
    return { ...parsed, duration: durationSec ?? 0 }
  } catch {
    // Thumbnail exists but Claude couldn't process it — fall back to metadata
    return classifyVideoFromMetadataOnly(metadata, durationSec)
  }
}
