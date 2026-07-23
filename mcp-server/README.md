# potato box MCP Server

This package exposes a running potato box desktop app to Model Context Protocol clients. It does not scan project directories itself. Every tool calls the authenticated desktop API at `http://127.0.0.1:19828/api/v1`, preserving the app's project registry, retrieval behavior, and file allow-list.

## Requirements

- Node.js 20 or newer
- potato box desktop app running
- Settings -> API + MCP -> Enable local HTTP API
- Settings -> API + MCP -> Enable MCP access
- `POTATO_BOX_API_TOKEN` set to the configured API token

Authentication cannot be disabled. Do not place the token in command-line arguments or commit it to an MCP configuration repository.

## Build and Test

```bash
npm ci
npm run build
npm test
```

## Run

```bash
POTATO_BOX_API_TOKEN=your-token node dist/index.js
```

Optional environment variable:

- `POTATO_BOX_API_BASE_URL`: override the default loopback API URL. Use only a trusted endpoint.

Example client configuration:

```json
{
  "mcpServers": {
    "potato-box": {
      "command": "node",
      "args": ["/absolute/path/to/potato-box/mcp-server/dist/index.js"],
      "env": {
        "POTATO_BOX_API_TOKEN": "replace-with-your-token"
      }
    }
  }
}
```

## Tools

- `potato_box_status`: API and current-project health.
- `potato_box_projects`: known public project summaries.
- `potato_box_files`: allowed files for a UUID project ID or `current`.
- `potato_box_read_file`: an allowed project-relative text file.
- `potato_box_reviews`: filtered review items through the dedicated endpoint.
- `potato_box_search`: keyword/vector retrieval through the app backend.
- `potato_box_graph`: knowledge graph data through the app backend.
- `potato_box_rescan_sources`: trigger the configured source-watch rescan.

Project filesystem paths are not valid `project_id` values. Use a UUID returned by `potato_box_projects` or the `current` alias.

## Security Model

- The default endpoint is loopback-only.
- Every non-health request requires the configured token.
- MCP access can be disabled independently in the app.
- Tokens are sent in headers, never query strings.
- Internal `.potato-box` and legacy state files are excluded from general file reads.
- Read paths are project-relative and checked against the selected registered project.
- The projects response does not expose filesystem paths.

See the repository [threat model](../docs/THREAT_MODEL.md) and [security policy](../SECURITY.md).
