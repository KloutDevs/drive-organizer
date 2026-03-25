import { Redis } from 'ioredis'
import * as dotenv from 'dotenv'
import * as path from 'path'
import * as child_process from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../.env') })

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const PORT = process.env.PORT ?? '3000'

const args = process.argv.slice(2)
const userId = args.find(a => !a.startsWith('--'))
const openBrowser = args.includes('--browser')

if (!userId) {
  console.error('Usage: npm run connect-drive -- <userId> [--browser]')
  console.error('Example: npm run connect-drive -- mi_usuario --browser')
  process.exit(1)
}

if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
  console.error('Error: userId must contain only alphanumeric characters, underscores, or hyphens')
  process.exit(1)
}

function openUrl(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`
  child_process.exec(cmd, (err) => {
    if (err) console.error('[browser] Could not open browser automatically:', err.message)
  })
}

const redis = new Redis(REDIS_URL)
const AUTH_URL = `http://localhost:${PORT}/connect/${userId}`

console.log('\n=== Google Drive Connection ===')
console.log(`User: ${userId}`)

if (openBrowser) {
  console.log('\nAbriendo el navegador...')
  openUrl(AUTH_URL)
  console.log(`URL: ${AUTH_URL}`)
} else {
  console.log(`\nStep 1: Make sure the OAuth server is running:`)
  console.log(`  npm run oauth-server\n`)
  console.log(`Step 2: Open this URL in your browser:`)
  console.log(`  ${AUTH_URL}`)
}

// Give more time when --browser is used since it takes a moment to load
const TIMEOUT_MS = openBrowser ? 120_000 : 30_000
console.log(`\nWaiting for authorization (${TIMEOUT_MS / 1000}s)...`)

const start = Date.now()
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
  console.log('\n\n❌ Timeout: no token received.')
  if (!openBrowser) {
    console.log('Make sure:')
    console.log('  1. The OAuth server is running (npm run oauth-server)')
    console.log(`  2. You visited: ${AUTH_URL}`)
    console.log('  3. You completed the Google authorization flow')
  } else {
    console.log(`Try manually: ${AUTH_URL}`)
  }
  process.exit(1)
}
