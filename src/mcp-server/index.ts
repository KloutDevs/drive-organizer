import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import * as dotenv from 'dotenv'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '../../.env') })

import * as listFiles from './tools/list-files.js'
import * as moveFile from './tools/move-file.js'
import * as renameFile from './tools/rename-file.js'
import * as createFolder from './tools/create-folder.js'
import * as getMetadata from './tools/get-metadata.js'

const userId = process.argv[2] ?? process.env.USER_ID ?? ''
if (!userId) {
  console.error('Error: userId required. Pass as argument: node src/mcp-server/index.ts <userId>')
  process.exit(1)
}

const server = new Server(
  { name: 'drive-organizer', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_files',
      description: 'List files in Google Drive with optional filters',
      inputSchema: {
        type: 'object',
        properties: {
          folderId: { type: 'string', description: 'Folder ID to list. Omit for root.' },
          mimeType: { type: 'string', description: 'Filter by MIME type (e.g. image/jpeg)' },
          nameContains: { type: 'string', description: 'Filter files whose name contains this string' },
          pageSize: { type: 'number', description: 'Max files to return (1-1000, default 100)' },
          pageToken: { type: 'string', description: 'Pagination token from previous response' },
          includeTrash: { type: 'boolean', description: 'Include trashed files (default false)' },
        },
      },
    },
    {
      name: 'move_file',
      description: 'Move a file to a different folder in Google Drive',
      inputSchema: {
        type: 'object',
        required: ['fileId', 'targetFolderId'],
        properties: {
          fileId: { type: 'string', description: 'ID of the file to move' },
          targetFolderId: { type: 'string', description: 'ID of the destination folder' },
        },
      },
    },
    {
      name: 'rename_file',
      description: 'Rename a file in Google Drive',
      inputSchema: {
        type: 'object',
        required: ['fileId', 'newName'],
        properties: {
          fileId: { type: 'string', description: 'ID of the file to rename' },
          newName: { type: 'string', description: 'New name for the file (including extension)' },
        },
      },
    },
    {
      name: 'create_folder',
      description: 'Create a new folder in Google Drive',
      inputSchema: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', description: 'Folder name' },
          parentId: { type: 'string', description: 'Parent folder ID. Omit to create in root.' },
        },
      },
    },
    {
      name: 'get_metadata',
      description: 'Get full metadata for a file, including image/video media metadata',
      inputSchema: {
        type: 'object',
        required: ['fileId'],
        properties: {
          fileId: { type: 'string', description: 'ID of the file' },
        },
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'list_files':
        return await listFiles.execute(args, userId) as unknown as CallToolResult
      case 'move_file':
        return await moveFile.execute(args, userId) as unknown as CallToolResult
      case 'rename_file':
        return await renameFile.execute(args, userId) as unknown as CallToolResult
      case 'create_folder':
        return await createFolder.execute(args, userId) as unknown as CallToolResult
      case 'get_metadata':
        return await getMetadata.execute(args, userId) as unknown as CallToolResult
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      content: [{ type: 'text', text: `Error executing ${name}: ${message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[mcp] drive-organizer server started for user: ${userId}`)
