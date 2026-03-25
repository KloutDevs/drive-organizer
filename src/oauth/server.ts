import express from 'express'
import { google } from 'googleapis'
import { Redis } from 'ioredis'
import * as crypto from 'crypto'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!
const REDIRECT_URI = process.env.REDIRECT_URI ?? 'http://localhost:3000/oauth/callback'
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!
const PORT = Number(process.env.PORT ?? 3000)
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

const redis = new Redis(REDIS_URL)

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12)
  const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32))
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
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

function createOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, REDIRECT_URI)
}

const app = express()

app.get('/connect/:userId', (req, res) => {
  const { userId } = req.params
  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    res.status(400).json({ error: 'Invalid userId. Use only alphanumeric, underscore, or hyphen.' })
    return
  }

  const oauth2Client = createOAuth2Client()
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: userId,
  })

  res.send(`
    <html>
      <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; text-align: center;">
        <h2>Connect Google Drive</h2>
        <p>User: <strong>${userId}</strong></p>
        <a href="${url}" style="display:inline-block;padding:12px 24px;background:#4285f4;color:white;border-radius:4px;text-decoration:none;font-size:16px;">
          Connect with Google
        </a>
      </body>
    </html>
  `)
})

app.get('/oauth/callback', async (req, res) => {
  const { code, state: userId, error } = req.query

  if (error) {
    res.status(400).send(`<h2>Authorization denied: ${error}</h2>`)
    return
  }

  if (!code || !userId) {
    res.status(400).send('<h2>Missing code or userId</h2>')
    return
  }

  try {
    const oauth2Client = createOAuth2Client()
    const { tokens } = await oauth2Client.getToken(String(code))

    if (!tokens.refresh_token) {
      res.status(400).send(`
        <h2>No refresh token received</h2>
        <p>This usually means the account was already connected.
        Try <a href="/connect/${userId}">reconnecting</a> after revoking access at
        <a href="https://myaccount.google.com/permissions">Google Account Permissions</a>.</p>
      `)
      return
    }

    const encrypted = encrypt(JSON.stringify(tokens))
    const redisKey = `drive_tokens:${userId}`
    await redis.set(redisKey, encrypted, 'EX', 365 * 24 * 60 * 60)

    res.send(`
      <html>
        <body style="font-family: sans-serif; max-width: 600px; margin: 50px auto; text-align: center;">
          <h2>✅ Connected successfully!</h2>
          <p>User <strong>${userId}</strong> is now connected to Google Drive.</p>
          <p>You can close this window.</p>
        </body>
      </html>
    `)
    console.log(`[oauth] User ${userId} connected successfully`)
  } catch (err) {
    console.error('[oauth] Token exchange error:', err)
    res.status(500).send('<h2>Internal error during token exchange</h2>')
  }
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

export { encrypt, decrypt, createOAuth2Client }

const server = app.listen(PORT, () => {
  console.log(`[oauth] Server running at http://localhost:${PORT}`)
  console.log(`[oauth] Connect a user: http://localhost:${PORT}/connect/{userId}`)
})

export default server
