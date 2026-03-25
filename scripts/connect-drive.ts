import { Redis } from 'ioredis'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const PORT = process.env.PORT ?? '3000'

const userId = process.argv[2]

if (!userId) {
  console.error('Usage: npm run connect-drive -- <userId>')
  console.error('Example: npm run connect-drive -- mi_usuario')
  process.exit(1)
}

if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
  console.error('Error: userId must contain only alphanumeric characters, underscores, or hyphens')
  process.exit(1)
}

const redis = new Redis(REDIS_URL)
const AUTH_URL = `http://localhost:${PORT}/connect/${userId}`

console.log('\n=== Google Drive Connection ===')
console.log(`User: ${userId}`)
console.log(`\nStep 1: Make sure the OAuth server is running:`)
console.log(`  npm run oauth-server\n`)
console.log(`Step 2: Open this URL in your browser:`)
console.log(`  ${AUTH_URL}\n`)
console.log('Waiting for authorization (30 seconds)...')

const start = Date.now()
const TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2_000

let connected = false
while (Date.now() - start < TIMEOUT_MS) {
  await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

  const token = await redis.get(`drive_tokens:${userId}`)
  if (token) {
    connected = true
    break
  }

  const elapsed = Math.round((Date.now() - start) / 1000)
  process.stdout.write(`\rWaiting... ${elapsed}s / ${TIMEOUT_MS / 1000}s`)
}

await redis.quit()

if (connected) {
  console.log(`\n\n✅ User "${userId}" connected to Google Drive successfully!`)
  console.log(`\nYou can now run:`)
  console.log(`  npm run organize -- --userId=${userId} --dry-run`)
} else {
  console.log('\n\n❌ Timeout: no token received within 30 seconds.')
  console.log('Make sure:')
  console.log('  1. The OAuth server is running (npm run oauth-server)')
  console.log(`  2. You visited: ${AUTH_URL}`)
  console.log('  3. You completed the Google authorization flow')
  process.exit(1)
}
