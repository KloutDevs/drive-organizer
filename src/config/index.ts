import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  google: {
    clientId: requireEnv('GOOGLE_CLIENT_ID'),
    clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
    redirectUri: process.env.REDIRECT_URI ?? 'http://localhost:3000/oauth/callback',
    scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
    ],
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  encryption: {
    key: requireEnv('ENCRYPTION_KEY'),
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
    model: 'claude-opus-4-5' as const,
  },
  server: {
    port: Number(process.env.PORT ?? 3000),
  },
  limits: {
    maxDiskMB: Number(process.env.MAX_DISK_MB ?? 200),
    maxPdfPartialKB: Number(process.env.MAX_PDF_PARTIAL_KB ?? 512),
    maxTextStreamKB: Number(process.env.MAX_TEXT_STREAM_KB ?? 8),
  },
  organizer: {
    defaultBatchSize: Number(process.env.DEFAULT_BATCH_SIZE ?? 10),
    defaultDelayMs: Number(process.env.DEFAULT_DELAY_MS ?? 1500),
  },
} as const
