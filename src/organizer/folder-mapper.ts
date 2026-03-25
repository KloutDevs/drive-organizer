import { drive_v3 } from 'googleapis'

type DriveInstance = ReturnType<typeof import('googleapis').google.drive>

export interface FolderNode {
  id: string
  name: string
  children: Map<string, FolderNode>
}

export class FolderMapper {
  private cache = new Map<string, string>() // "parentId/name" → folderId
  private drive: DriveInstance

  constructor(drive: DriveInstance) {
    this.drive = drive
  }

  /**
   * Ensures a folder path exists, creating folders as needed.
   * Returns the ID of the final folder.
   *
   * path: ['2024', 'Personal', 'Vacaciones']
   * parentId: root Drive folder ID or undefined for root
   */
  async ensurePath(pathParts: string[], parentId?: string): Promise<string> {
    let currentParentId = parentId ?? 'root'

    for (const part of pathParts) {
      const cacheKey = `${currentParentId}/${part}`

      if (this.cache.has(cacheKey)) {
        currentParentId = this.cache.get(cacheKey)!
        continue
      }

      // Check if folder already exists
      const existing = await this.findFolder(part, currentParentId)
      if (existing) {
        this.cache.set(cacheKey, existing)
        currentParentId = existing
        continue
      }

      // Create the folder
      const created = await this.createFolder(part, currentParentId)
      this.cache.set(cacheKey, created)
      currentParentId = created
    }

    return currentParentId
  }

  private async findFolder(name: string, parentId: string): Promise<string | null> {
    const response = await this.drive.files.list({
      q: `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
      pageSize: 1,
    })

    const files = response.data.files ?? []
    return files.length > 0 ? files[0].id! : null
  }

  private async createFolder(name: string, parentId: string): Promise<string> {
    const response = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      },
      fields: 'id',
    })
    return response.data.id!
  }

  clearCache(): void {
    this.cache.clear()
  }
}
