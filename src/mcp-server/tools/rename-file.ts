import { DriveClient } from '../drive-client.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface RenameFileArgs {
  fileId: string
  newName: string
}

const INVALID_CHARS = /[/\\:*?"<>|]/g

export async function execute(args: unknown, userId: string): Promise<ToolResult> {
  const { fileId, newName } = args as RenameFileArgs

  if (!fileId || !newName) {
    return { content: [{ type: 'text', text: 'Error: fileId and newName are required' }], isError: true }
  }

  if (INVALID_CHARS.test(newName)) {
    return {
      content: [{ type: 'text', text: `Error: newName contains invalid characters. Avoid: / \\ : * ? " < > |` }],
      isError: true,
    }
  }

  const sanitized = newName.trim().slice(0, 255)
  if (!sanitized) {
    return { content: [{ type: 'text', text: 'Error: newName cannot be empty after trimming' }], isError: true }
  }

  const client = await DriveClient.forUser(userId)
  const drive = client.getDrive()

  const fileRes = await drive.files.get({ fileId, fields: 'id, name' })
  const oldName = fileRes.data.name

  await drive.files.update({ fileId, requestBody: { name: sanitized }, fields: 'id, name' })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ success: true, fileId, oldName, newName: sanitized }, null, 2),
    }],
  }
}
