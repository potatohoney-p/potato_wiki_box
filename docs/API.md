# Local API Reference

potato box can expose a loopback-only HTTP API for local automation and the bundled MCP server.

## Enable and Authenticate

Enable **Settings -> API + MCP**, then configure a token. The base URL is:

```text
http://127.0.0.1:19828/api/v1
```

Every endpoint except `GET /health` requires one of these headers:

```http
Authorization: Bearer pbx_your_token
X-Potato-Box-Token: pbx_your_token
```

Tokens in query strings are rejected. The `POTATO_BOX_API_TOKEN` environment variable overrides the token stored by the app. Keep the token out of logs, shell history, and shared configuration.

## Project Identifiers

`GET /projects` returns stable project UUIDs. Project endpoints accept a UUID or the literal `current`; filesystem paths and arbitrary names are not accepted.

```bash
curl -H "Authorization: Bearer $POTATO_BOX_API_TOKEN" \
  http://127.0.0.1:19828/api/v1/projects
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, version, enablement, and authentication status; no token required |
| `GET` | `/projects` | Registered projects and the current project |
| `GET` | `/projects/{id}/files` | Public project tree under `wiki`, `sources`, or `all` |
| `GET` | `/projects/{id}/files/content` | UTF-8 text content from an allowed project path |
| `GET` | `/projects/{id}/reviews` | Sanitized review items |
| `POST` | `/projects/{id}/search` | Shared keyword and optional vector retrieval |
| `GET` | `/projects/{id}/graph` | Wikilink graph nodes and edges |
| `POST` | `/projects/{id}/sources/rescan` | Source Watch rescan and queue update |

### Files

`GET /projects/{id}/files` accepts:

- `root=wiki|sources|all` (default `wiki`)
- `recursive=false` to return one level only
- `maxFiles=1..10000` (default `2000`)

`GET /projects/{id}/files/content?path=wiki/index.md` returns text-like files only, with a 2 MiB response limit. Internal state, absolute paths, traversal segments, binary files, and symlink escapes are rejected.

### Reviews

`GET /projects/{id}/reviews` accepts:

- `status=unresolved|resolved|all` (default `unresolved`)
- `type=<review-type>`
- `limit=1..1000` (default `200`)

Only the public review fields and closed action options are returned.

### Search

```bash
curl -X POST \
  -H "Authorization: Bearer $POTATO_BOX_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"retrieval evaluation","topK":10,"includeContent":false}' \
  http://127.0.0.1:19828/api/v1/projects/current/search
```

The JSON body supports `query` (required), `topK` (`1..50`), `includeContent`, and an optional finite `queryEmbedding` array. When an embedding provider is enabled, the server can generate the query embedding and combine keyword and LanceDB results.

### Graph

`GET /projects/{id}/graph` accepts `q`, `nodeType`, and `limit=1..1000` (default `200`). Edges are returned only when both endpoint nodes survive the filters.

## Responses and Limits

Successful responses include `"ok": true`. Errors use:

```json
{ "ok": false, "error": "Human-readable message" }
```

Relevant status codes include `400` invalid input, `401` invalid or missing token, `403` disallowed path, `404` unknown resource, `413` size/count limit, `415` unsupported content, `429` rate limit, `500` internal failure, and `503` API disabled. Request bodies are limited to 1 MiB, at most 64 requests are processed concurrently, and non-health traffic is limited to 120 requests per one-second window.

## CORS

The API binds only to `127.0.0.1`. Browser-origin requests are rejected except for potato box's production WebView and local Vite development origins. Use a local process, the bundled MCP server, or the browser clipper's dedicated authenticated endpoint.
