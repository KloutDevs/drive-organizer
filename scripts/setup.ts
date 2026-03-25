/**
 * drive-organizer setup wizard
 *
 * Automates everything possible:
 *   - ENCRYPTION_KEY generation (fully automatic)
 *   - Redis detection (fully automatic)
 *   - Anthropic API key  → opens browser to the right page, reads from stdin
 *   - Google credentials → opens browser to each exact Console page step by step
 *   - Writes .env
 *   - Starts OAuth server + connects Drive (--browser)
 */

import * as readline from 'readline'
import * as fs from 'fs/promises'
import * as crypto from 'crypto'
import * as child_process from 'child_process'
import * as path from 'path'
import * as net from 'net'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '../.env')
const ENV_EXAMPLE_PATH = path.join(__dirname, '../.env.example')

// ─── Terminal helpers ──────────────────────────────────────────────────────────

const RESET  = '\x1b[0m'
const BOLD   = '\x1b[1m'
const DIM    = '\x1b[2m'
const GREEN  = '\x1b[32m'
const YELLOW = '\x1b[33m'
const CYAN   = '\x1b[36m'
const RED    = '\x1b[31m'

const ok   = (msg: string) => console.log(`${GREEN}✔${RESET}  ${msg}`)
const warn = (msg: string) => console.log(`${YELLOW}⚠${RESET}  ${msg}`)
const info = (msg: string) => console.log(`${CYAN}→${RESET}  ${msg}`)
const err  = (msg: string) => console.log(`${RED}✖${RESET}  ${msg}`)
const step = (n: number, total: number, title: string) =>
  console.log(`\n${BOLD}[${n}/${total}] ${title}${RESET}`)
const divider = () => console.log(DIM + '─'.repeat(60) + RESET)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (question: string): Promise<string> =>
  new Promise(resolve => rl.question(question, answer => resolve(answer.trim())))

const askSecret = (question: string): Promise<string> =>
  new Promise(resolve => {
    // Pause readline so it doesn't compete for stdin events
    rl.pause()
    process.stdout.write(question)

    const stdin = process.stdin
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let value = ''

    const onData = (char: string) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode?.(false)
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        // Hand stdin back to readline — do NOT pause the stream
        rl.resume()
        resolve(value)
      } else if (char === '\u0003') {
        process.exit()
      } else if (char === '\u007f') {
        value = value.slice(0, -1)
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        process.stdout.write(question + '*'.repeat(value.length))
      } else {
        value += char
        process.stdout.write('*')
      }
    }
    stdin.on('data', onData)
  })

function openUrl(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`
  child_process.exec(cmd, (e) => {
    if (e) warn(`Could not open browser automatically. Visit manually: ${url}`)
  })
}

// ─── Redis detection ───────────────────────────────────────────────────────────

async function detectRedis(url: string): Promise<boolean> {
  return new Promise(resolve => {
    const parsed = new URL(url)
    const socket = net.createConnection(
      { host: parsed.hostname, port: Number(parsed.port || 6379) },
      () => { socket.destroy(); resolve(true) }
    )
    socket.on('error', () => resolve(false))
    socket.setTimeout(2000, () => { socket.destroy(); resolve(false) })
  })
}

// ─── Load existing .env ───────────────────────────────────────────────────────

async function loadExistingEnv(): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(ENV_PATH, 'utf8')
    const result: Record<string, string> = {}
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match) result[match[1]] = match[2].trim()
    }
    return result
  } catch {
    return {}
  }
}

// ─── Write .env ───────────────────────────────────────────────────────────────

async function writeEnv(values: Record<string, string>): Promise<void> {
  // Start from .env.example to preserve comments and order
  let template: string
  try {
    template = await fs.readFile(ENV_EXAMPLE_PATH, 'utf8')
  } catch {
    template = Object.keys(values).map(k => `${k}=`).join('\n')
  }

  const result = template.replace(/^([A-Z_]+)=.*$/gm, (_, key) =>
    values[key] !== undefined ? `${key}=${values[key]}` : `${key}=`
  )
  await fs.writeFile(ENV_PATH, result, 'utf8')
}

// ─── Main setup flow ──────────────────────────────────────────────────────────

const TOTAL_STEPS = 5

console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════════╗`)
console.log(`║              drive-organizer — Setup Wizard                 ║`)
console.log(`╚══════════════════════════════════════════════════════════════╝${RESET}`)
console.log(`\nEste wizard configura todo lo necesario para correr el proyecto.`)
console.log(`Vas a necesitar una cuenta de Google y una cuenta de Anthropic.\n`)

const existing = await loadExistingEnv()
const config: Record<string, string> = { ...existing }

// ─── Step 1: ENCRYPTION_KEY ───────────────────────────────────────────────────

step(1, TOTAL_STEPS, 'Encryption Key')
divider()

if (config.ENCRYPTION_KEY && config.ENCRYPTION_KEY.length >= 32) {
  ok('Ya existe una ENCRYPTION_KEY válida — se mantiene.')
} else {
  config.ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex')
  ok(`ENCRYPTION_KEY generada automáticamente: ${DIM}${config.ENCRYPTION_KEY.slice(0, 8)}...${RESET}`)
}

// ─── Step 2: Redis ────────────────────────────────────────────────────────────

step(2, TOTAL_STEPS, 'Redis')
divider()

const defaultRedis = config.REDIS_URL || 'redis://localhost:6379'
info(`Verificando conexión a Redis en ${defaultRedis}...`)
const redisOk = await detectRedis(defaultRedis)

if (redisOk) {
  config.REDIS_URL = defaultRedis
  ok(`Redis disponible en ${defaultRedis}`)
} else {
  warn('Redis no responde en la URL por defecto.')
  console.log('\nOpciones:')
  console.log('  1. Instalar Redis localmente: brew install redis && brew services start redis')
  console.log('  2. Usar Redis Cloud (gratis): https://redis.io/try-free/')
  console.log('  3. Ingresar una URL personalizada\n')

  const redisUrl = await ask(`URL de Redis [${defaultRedis}]: `)
  config.REDIS_URL = redisUrl || defaultRedis

  const retryOk = await detectRedis(config.REDIS_URL)
  if (retryOk) {
    ok(`Redis disponible en ${config.REDIS_URL}`)
  } else {
    warn(`No se pudo verificar Redis en ${config.REDIS_URL}. Continuando de todas formas.`)
  }
}

// ─── Step 3: Anthropic API Key ────────────────────────────────────────────────

step(3, TOTAL_STEPS, 'Anthropic API Key')
divider()

if (config.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) {
  ok('Ya hay una ANTHROPIC_API_KEY configurada — se mantiene.')
  const keep = await ask('¿Querés reemplazarla? (y/N): ')
  if (keep.toLowerCase() !== 'y') {
    info('Manteniendo la key existente.')
  } else {
    config.ANTHROPIC_API_KEY = ''
  }
}

if (!config.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) {
  console.log('\nNecesitás una API key de Anthropic para el análisis con Claude.')
  console.log('Abriendo la consola de Anthropic en el navegador...\n')
  openUrl('https://console.anthropic.com/settings/keys')

  console.log('1. Hacé click en "Create Key"')
  console.log('2. Poné un nombre (ej: "drive-organizer")')
  console.log('3. Copiá la key (empieza con sk-ant-...)\n')

  const apiKey = await askSecret('Pegá tu Anthropic API Key: ')

  if (!apiKey.startsWith('sk-ant-')) {
    err('La key no parece válida (debe empezar con sk-ant-).')
    err('Podés editarla manualmente en .env y volver a correr setup.')
    config.ANTHROPIC_API_KEY = apiKey
  } else {
    config.ANTHROPIC_API_KEY = apiKey
    ok('Anthropic API Key guardada.')
  }
}

// ─── Step 4: Google OAuth Credentials ────────────────────────────────────────

step(4, TOTAL_STEPS, 'Google OAuth Credentials')
divider()

const hasGoogleCreds = config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
if (hasGoogleCreds) {
  ok('Ya hay credenciales de Google configuradas — se mantienen.')
  const replace = await ask('¿Querés reemplazarlas? (y/N): ')
  if (replace.toLowerCase() !== 'y') {
    info('Manteniendo credenciales existentes.')
  } else {
    config.GOOGLE_CLIENT_ID = ''
    config.GOOGLE_CLIENT_SECRET = ''
  }
}

if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
  console.log('\nNecesitás crear un proyecto en Google Cloud y habilitar la Drive API.')
  console.log('Vamos paso a paso — el navegador se abre en cada página exacta.\n')

  // Step 4.1: Create project
  console.log(`${BOLD}4.1 — Creá un proyecto en Google Cloud${RESET}`)
  console.log('       (si ya tenés uno, saltá este paso)')
  await ask('Presioná ENTER para abrir Google Cloud Console → ')
  openUrl('https://console.cloud.google.com/projectcreate')
  console.log('\n  1. Poné un nombre (ej: "drive-organizer")')
  console.log('  2. Hacé click en "Create"')
  console.log('  3. Esperá a que se cree y copiá el Project ID\n')
  const projectId = await ask('Pegá el Project ID (ej: drive-organizer-123456): ')
  if (projectId) config['GOOGLE_PROJECT_ID'] = projectId

  // Step 4.2: Enable Drive API
  console.log(`\n${BOLD}4.2 — Habilitá la Google Drive API${RESET}`)
  await ask('Presioná ENTER para abrir la página de activación → ')
  const driveApiUrl = projectId
    ? `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${projectId}`
    : 'https://console.cloud.google.com/apis/library/drive.googleapis.com'
  openUrl(driveApiUrl)
  console.log('\n  1. Hacé click en "Enable"')
  console.log('  2. Esperá a que se habilite\n')
  await ask('Presioná ENTER cuando esté habilitada → ')

  // Step 4.3: Configure OAuth consent screen
  console.log(`\n${BOLD}4.3 — Configurá la pantalla de consentimiento OAuth${RESET}`)
  await ask('Presioná ENTER para abrir la configuración → ')
  const consentUrl = projectId
    ? `https://console.cloud.google.com/apis/credentials/consent?project=${projectId}`
    : 'https://console.cloud.google.com/apis/credentials/consent'
  openUrl(consentUrl)
  console.log('\n  1. Elegí "External" y hacé click en "Create"')
  console.log('  2. Completá el nombre de la app (ej: "Drive Organizer")')
  console.log('  3. Poné tu email en "User support email" y "Developer contact"')
  console.log('  4. Hacé click en "Save and Continue" hasta el final')
  console.log('  5. En "Test users" agregá tu email de Google\n')
  await ask('Presioná ENTER cuando esté configurado → ')

  // Step 4.4: Create OAuth credentials
  console.log(`\n${BOLD}4.4 — Creá las credenciales OAuth 2.0${RESET}`)
  await ask('Presioná ENTER para abrir la página de credenciales → ')
  const credsUrl = projectId
    ? `https://console.cloud.google.com/apis/credentials?project=${projectId}`
    : 'https://console.cloud.google.com/apis/credentials'
  openUrl(credsUrl)
  console.log('\n  1. Hacé click en "+ Create Credentials" → "OAuth client ID"')
  console.log('  2. Application type: "Web application"')
  console.log('  3. Name: "drive-organizer"')
  console.log('  4. En "Authorized redirect URIs" agregá:')
  console.log(`     ${BOLD}http://localhost:3000/oauth/callback${RESET}`)
  console.log('  5. Hacé click en "Create"')
  console.log('  6. Copiá el Client ID y el Client Secret del popup\n')

  const clientId = await ask('Pegá el Client ID: ')
  const clientSecret = await askSecret('Pegá el Client Secret: ')

  if (!clientId || !clientSecret) {
    err('Credenciales incompletas. Editá .env manualmente y volvé a correr setup.')
  } else {
    config.GOOGLE_CLIENT_ID = clientId.trim()
    config.GOOGLE_CLIENT_SECRET = clientSecret.trim()
    ok('Credenciales de Google guardadas.')
  }

  config.REDIRECT_URI = 'http://localhost:3000/oauth/callback'
}

// ─── Write .env ───────────────────────────────────────────────────────────────

step(5, TOTAL_STEPS, 'Guardando configuración')
divider()

await writeEnv(config)
ok(`.env guardado en ${ENV_PATH}`)

// ─── Offer to connect Drive ───────────────────────────────────────────────────

console.log(`\n${BOLD}╔══════════════════════════════════════════════════════════════╗`)
console.log(`║                    ✅  Setup completo                        ║`)
console.log(`╚══════════════════════════════════════════════════════════════╝${RESET}\n`)

const connectNow = await ask('¿Querés conectar tu Google Drive ahora? (Y/n): ')

if (connectNow.toLowerCase() !== 'n') {
  const userId = await ask('Nombre de usuario para el Drive (ej: mi_usuario): ')

  if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    warn('Nombre de usuario inválido. Podés conectarlo después con:')
    console.log('  npm run oauth-server      # en una terminal')
    console.log('  npm run connect-drive -- <userId> --browser')
  } else {
    console.log('\nArrancar el OAuth server y conectar Drive...')
    console.log('(Esto abre el navegador para que autoricés el acceso a tu Drive)\n')

    // Start oauth server in background
    const server = child_process.spawn(
      'node', ['--loader', 'ts-node/esm', 'src/oauth/server.ts'],
      { cwd: path.join(__dirname, '..'), detached: false, stdio: 'inherit' }
    )

    // Give the server 2 seconds to start
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Run connect-drive with --browser
    const connect = child_process.spawnSync(
      'node',
      ['--loader', 'ts-node/esm', 'scripts/connect-drive.ts', userId, '--browser'],
      { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
    )

    server.kill()

    if (connect.status === 0) {
      console.log(`\n${BOLD}Todo listo. Para organizar tu Drive:${RESET}`)
      console.log(`  npm run organize -- --userId=${userId} --dry-run`)
    } else {
      warn('La conexión no se completó. Intentalo manualmente:')
      console.log('  npm run oauth-server      # terminal 1')
      console.log(`  npm run connect-drive -- ${userId} --browser`)
    }
  }
} else {
  console.log('\nCuando quieras conectar tu Drive:')
  console.log('  npm run oauth-server      # en una terminal aparte')
  console.log('  npm run connect-drive -- <userId> --browser')
}

rl.close()
