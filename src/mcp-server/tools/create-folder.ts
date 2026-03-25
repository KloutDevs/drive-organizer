import { DriveClient } from '../drive-client.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface CreateFolderArgs {
  name: string
  parentId?: string
}

export async function execute(args: unknown, userId: string): Promise<ToolResult> {
  const { name, parentId } = args as CreateFolderArgs

  if (!name) {
    return { content: [{ type: 'text', text: 'Error: folder name is required' }], isError: true }
  }

  const client = await DriveClient.forUser(userId)
  const drive = client.getDrive()

  const metadata: Record<string, unknown> = {
    name: name.trim().slice(0, 255),
    mimeType: 'application/vnd.google-apps.folder',
  }

  if (parentId) {
    metadata['parents'] = [parentId]
  }

  const response = await drive.files.create({
    requestBody: metadata,
    fields: 'id, name, parents',
  })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        id: response.data.id,
        name: response.data.name,
        parents: response.data.parents ?? [],
      }, null, 2),
    }],
  }
}
