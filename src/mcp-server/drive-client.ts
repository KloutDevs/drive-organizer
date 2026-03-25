import { google, drive_v3 } from 'googleapis'
import { Redis } from 'ioredis'
import * as crypto from 'crypto'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'http://localhost:3000/oauth/callback'

// Full field set to always request — covers all analysis needs
export const DRIVE_FILE_FIELDS = [
  'id',
  'name',
  'mimeType',
  'size',
  'createdTime',
  'modifiedTime',
  'parents',
  'thumbnailLink',
  'webViewLink',
  'imageMediaMetadata',
  'videoMediaMetadata',
  'fileExtension',
  'md5Checksum',
  'trashed',
].join(',')

let redisClient: Redis | null = null

function getRedis(): Redis {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL)
  }
  return redisClient
}

function decrypt(data: string): string {
  const buf = Buffer.from(data, 'base64')
  const iv = buf.slice(0, 12)
  const authTag = buf.slice(12, 28)
  const encrypted = buf.slice(28)
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf8')
}

export class DriveAuthError extends Error {
  constructor(userId: string) {
    super(`User ${userId} is not connected. Run: npm run connect-drive -- ${userId}`)
    this.name = 'DriveAuthError'
  }
}

export class DriveClient {
  private drive: drive_v3.Drive

  private constructor(drive: drive_v3.Drive) {
    this.drive = drive
  }

  static async forUser(userId: string): Promise<DriveClient> {
    const redis = getRedis()
    const redisKey = `drive_tokens:${userId}`
    const encryptedTokens = await redis.get(redisKey)

    if (!encryptedTokens) {
      throw new DriveAuthError(userId)
    }

    const tokens = JSON.parse(decrypt(encryptedTokens))
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      REDIRECT_URI
    )
    oauth2Client.setCredentials(tokens)

    // Auto-refresh tokens when they expire
    oauth2Client.on('tokens', async (newTokens) => {
      const merged = { ...tokens, ...newTokens }
      // Preserve refresh_token if new one wasn't returned
      if (!newTokens.refresh_token && tokens.refresh_token) {
        merged.refresh_token = tokens.refresh_token
      }
      const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32))
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      const encryptedBuf = Buffer.concat([cipher.update(JSON.stringify(merged), 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      const updated = Buffer.concat([iv, authTag, encryptedBuf]).toString('base64')
      await redis.set(redisKey, updated, 'EX', 365 * 24 * 60 * 60)
    })

    const drive = google.drive({ version: 'v3', auth: oauth2Client })
    return new DriveClient(drive)
  }

  getDrive(): drive_v3.Drive {
    return this.drive
  }
}
