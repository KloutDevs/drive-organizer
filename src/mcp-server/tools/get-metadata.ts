import { DriveClient, DRIVE_FILE_FIELDS } from '../drive-client.js'

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

interface GetMetadataArgs {
  fileId: string
}

export async function execute(args: unknown, userId: string): Promise<ToolResult> {
  const { fileId } = args as GetMetadataArgs

  if (!fileId) {
    return { content: [{ type: 'text', text: 'Error: fileId is required' }], isError: true }
  }

  const client = await DriveClient.forUser(userId)
  const drive = client.getDrive()

  const response = await drive.files.get({ fileId, fields: DRIVE_FILE_FIELDS })

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(response.data, null, 2),
    }],
  }
}
