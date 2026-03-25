# MCP Server Decision

## Research Summary

We evaluated existing MCP servers for Google Drive before building our own.

### Options Found

| Server | Status | Language | move_file | create_folder | get_file_metadata | list_files |
|--------|--------|----------|-----------|---------------|-------------------|------------|
| `@modelcontextprotocol/server-gdrive` | **DEPRECATED** (archived) | Node.js | ❌ | ❌ | ❌ | partial |
| `taylorwilsdon/google_workspace_mcp` | Active, 1.9k stars | **Python** | partial | ✅ | ❌ explicit | ✅ |
| `piotr-agier/google-drive-mcp` | Partially maintained, 84 stars | Node.js | ✅ | ✅ | ❌ | ✅ |
| `felores/gdrive-mcp-server` | Minimal | Node.js | ❌ | ❌ | ❌ | ❌ |

### Decision: Build Custom MCP Server

**Reasons:**

1. **Language mismatch**: The best maintained option (`google_workspace_mcp`) is Python. Our entire stack is Node.js 20+ TypeScript — mixing runtimes adds operational overhead.

2. **Missing `get_file_metadata`**: No existing server exposes a dedicated metadata tool with all the Drive fields we need (`imageMediaMetadata`, `videoMediaMetadata`, `thumbnailLink`, `md5Checksum`). These fields are critical for our zero-download analysis strategy.

3. **Zero-download enforcement**: We need the MCP server to be tightly coupled with `TempManager` to enforce the 200MB disk limit. An external server can't participate in this guarantee.

4. **Full control over tool signatures**: Our `list_files` needs to support pagination, MIME filtering, and always request the full field set required by our analyzers. External servers have their own field selection.

5. **`@modelcontextprotocol/sdk` in Node.js is trivial to use**: Implementing the 5 required tools takes ~300 lines of TypeScript. Not worth a Python dependency.

### Tools We Build

- `list_files` — paginated, filterable, returns full Drive metadata
- `move_file` — removes current parents, adds new parent, validates existence
- `rename_file` — validates for invalid characters
- `create_folder` — creates `application/vnd.google-apps.folder`, returns ID
- `get_metadata` — full metadata including image/video media metadata

### References

- [MCP Servers Archived - gdrive](https://github.com/modelcontextprotocol/servers-archived/tree/main/src/gdrive)
- [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)
- [piotr-agier/google-drive-mcp](https://github.com/piotr-agier/google-drive-mcp)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
