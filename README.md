# drive-organizer

Intelligently organizes your Google Drive using a custom MCP server and Claude AI for content analysis.

## How it works

1. Lists all files in your Drive (or a specific folder)
2. Analyzes each file using Claude AI:
   - **Images/Videos**: Uses thumbnail URLs — zero bytes downloaded
   - **Google Docs/Sheets/Slides**: Exports as plain text in memory — zero bytes downloaded
   - **Plain text**: Streams up to 8KB in memory — zero bytes downloaded
   - **PDFs**: Downloads up to 512KB to a temp file — deleted immediately after analysis
3. Classifies files into a folder hierarchy (year/category/subcategory)
4. Moves and renames files in Drive

## Zero-download principle

This system **never keeps files on disk**. Peak disk usage is capped at 200MB at all times.
PDF temp files are deleted immediately after analysis, even on error.

## Setup

### Prerequisites

- Node.js 20+
- Redis running locally (`redis-server`)
- Google Cloud project with Drive API enabled

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → Enable **Google Drive API**
3. Create OAuth 2.0 credentials (Web Application)
4. Add `http://localhost:3000/oauth/callback` as an authorized redirect URI
5. Copy Client ID and Client Secret

### Installation

```bash
cd drive-organizer
cp .env.example .env
# Edit .env with your credentials
npm install
```

### Connect a user

```bash
# Terminal 1: start the OAuth server
npm run oauth-server

# Terminal 2: connect your user
npm run connect-drive -- my_user
# Follow the URL shown in the terminal
```

### Organize your Drive

```bash
# Dry run first (recommended)
npm run organize -- --userId=my_user --dry-run

# Organize for real
npm run organize -- --userId=my_user

# Organize a specific folder
npm run organize -- --userId=my_user --folderId=<folderId> --dry-run
```

## Folder structure created

```
My Drive/
├── 2024/
│   ├── Personal/
│   │   ├── Vacaciones/
│   │   ├── Familia/
│   │   └── Eventos/
│   ├── Trabajo/
│   │   └── ProjectName/
│   └── Documentos/
│       ├── contrato/
│       ├── factura/
│       └── informe/
├── Capturas/
├── Educacion/
├── _Duplicados/
└── _Revisar/         ← files with low confidence (<40%)
```

## Progress output

```
[1/847] foto_playa.jpg                → url_only          → 2022/Personal/Vacaciones       disk: 0.0MB
[2/847] reunion.mp4                   → url_only          → 2023/Trabajo/Reuniones         disk: 0.0MB
[3/847] contrato.pdf                  → partial_download  → 2021/Documentos/contratos      disk: 0.4MB
[3/847] contrato.pdf                  → cleanup           → disk released                  disk: 0.0MB
```

## Use with Claude Code (MCP)

```bash
# Copy .claude/mcp.json to your project and configure env vars
# Then in Claude Code:
```

- "List all files in the root of Drive for my_user"
- "Analyze and organize the Photos folder in dry-run mode for my_user"
- "Show the report from the last analysis"
- "How much disk space did the process use?"

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | required |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | required |
| `REDIRECT_URI` | OAuth callback URL | `http://localhost:3000/oauth/callback` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `ENCRYPTION_KEY` | 32-char key for token encryption | required |
| `ANTHROPIC_API_KEY` | Anthropic API key | required |
| `PORT` | OAuth server port | `3000` |
| `MAX_DISK_MB` | Maximum disk usage in MB | `200` |
| `MAX_PDF_PARTIAL_KB` | Max PDF bytes to download | `512` |
| `MAX_TEXT_STREAM_KB` | Max text stream bytes | `8` |

## Architecture

See [docs/mcp-decision.md](docs/mcp-decision.md) for the MCP server decision and evaluation of existing options.
