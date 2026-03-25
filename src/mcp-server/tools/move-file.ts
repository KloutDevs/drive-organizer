import { DriveClient } from '../drive-client.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface MoveFileArgs {
  fileId: string
  targetFolderId: string
}

export async function execute(args: unknown, userId: string): Promise<ToolResult> {
  const { fileId, targetFolderId } = args as MoveFileArgs

  if (!fileId || !targetFolderId) {
    return { content: [{ type: 'text', text: 'Error: fileId and targetFolderId are required' }], isError: true }
  }

  const client = await DriveClient.forUser(userId)
  const drive = client.getDrive()

  // Get current parents
  const fileRes = await drive.files.get({ fileId, fields: 'id, name, parents' })
  const currentParents = fileRes.data.parents ?? []

  // Verify target folder exists
  const folderRes = await drive.files.get({ fileId: targetFolderId, fields: 'id, name, mimeType' })
  if (folderRes.data.mimeType !== 'application/vnd.google-apps.folder') {
    return { content: [{ type: 'text', text: `Error: ${targetFolderId} is not a folder` }], isError: true }
  }

  // Move: remove all current parents, add new one
  await drive.files.update({
    fileId,
    addParents: targetFolderId,
    removeParents: currentParents.join(','),
    fields: 'id, name, parents',
  })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        fileId,
        fileName: fileRes.data.name,
        movedTo: { id: targetFolderId, name: folderRes.data.name },
      }, null, 2),
    }],
  }
}
