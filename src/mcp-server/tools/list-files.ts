import { DriveClient, DRIVE_FILE_FIELDS } from '../drive-client.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface ListFilesArgs {
  folderId?: string
  mimeType?: string
  nameContains?: string
  pageSize?: number
  pageToken?: string
  includeTrash?: boolean
}

export async function execute(args: unknown, userId: string): Promise<ToolResult> {
  const {
    folderId,
    mimeType,
    nameContains,
    pageSize = 100,
    pageToken,
    includeTrash = false,
  } = args as ListFilesArgs

  const client = await DriveClient.forUser(userId)
  const drive = client.getDrive()

  const queryParts: string[] = []
  if (folderId) queryParts.push(`'${folderId}' in parents`)
  if (mimeType) queryParts.push(`mimeType = '${mimeType}'`)
  if (nameContains) queryParts.push(`name contains '${nameContains}'`)
  if (!includeTrash) queryParts.push('trashed = false')

  const q = queryParts.length > 0 ? queryParts.join(' and ') : undefined

  const response = await drive.files.list({
    q,
    pageSize: Math.min(pageSize, 1000),
    pageToken,
    fields: `nextPageToken, files(${DRIVE_FILE_FIELDS})`,
  })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        files: response.data.files ?? [],
        nextPageToken: response.data.nextPageToken ?? null,
        count: (response.data.files ?? []).length,
      }, null, 2),
    }],
  }
}
