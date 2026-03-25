import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const TEMP_DIR = path.join(os.tmpdir(), 'drive-organizer')
const MAX_DISK_BYTES = Number(process.env.MAX_DISK_MB ?? 200) * 1024 * 1024

export class TempManagerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TempManagerError'
  }
}

function mb(b: number): number {
  return Math.round(b / 1024 / 1024 * 10) / 10
}

class TempManager {
  private tracked = new Map<string, number>() // filepath → bytes

  async availableBytes(): Promise<number> {
    const used = [...this.tracked.values()].reduce((a, b) => a + b, 0)
    return Math.max(0, MAX_DISK_BYTES - used)
  }

  async register(filepath: string, expectedBytes: number): Promise<void> {
    const available = await this.availableBytes()
    if (expectedBytes > available) {
      throw new TempManagerError(
        `No disk space: need ${mb(expectedBytes)}MB but only ${mb(available)}MB available`
      )
    }
    this.tracked.set(filepath, expectedBytes)
    await fs.mkdir(path.dirname(filepath), { recursive: true })
  }

  async cleanup(filepath: string): Promise<void> {
    try {
      await fs.unlink(filepath)
    } catch {
      // file already gone, ok
    }
    this.tracked.delete(filepath)
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([...this.tracked.keys()].map(f => this.cleanup(f)))
  }

  async cleanupStale(): Promise<void> {
    try {
      const files = await fs.readdir(TEMP_DIR)
      await Promise.all(
        files.map(f => fs.unlink(path.join(TEMP_DIR, f)).catch(() => {}))
      )
    } catch {
      // directory doesn't exist, ok
    }
  }

  currentUsageMB(): number {
    const bytes = [...this.tracked.values()].reduce((a, b) => a + b, 0)
    return Math.round(bytes / 1024 / 1024 * 10) / 10
  }
}

export const tempManager = new TempManager()
