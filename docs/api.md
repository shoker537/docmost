# API keys and REST API in Community Edition

This fork implements personal JWT bearer API keys without an enterprise license.
The routes and request fields follow the public
[Docmost API reference](https://docmost.com/api-docs) and
[API key guide](https://docmost.com/docs/user-guide/api). The upstream reference
also lists enterprise-only features that CE has not implemented; API keys do not
enable those features.

## Create and manage keys

Open **Settings → Account → API keys**, choose **Create API Key**, and select a
name and expiry: 30, 60, 90 or 365 days, a custom local date/time, or no expiration.
Custom dates are sent to the server as UTC timestamps. The token is shown once;
copy it before dismissing the dialog. Lists contain only key metadata. Tokens are
never persisted in the database, browser storage or query/mutation caches.

Owners and administrators can open **Settings → Workspace → API management** to
view, rename and revoke keys owned by anyone in their workspace. The page also
offers **Restrict API access to workspace administrators**. When enabled, member
keys stop working immediately, and members cannot create new keys. Members can
still inspect and revoke their existing keys through a browser session.

Each request loads the key record and the owner's current account and permissions.
Revocation, expiry, user deactivation/deletion and role changes take effect on
subsequent requests. A key cannot cross into another workspace or bypass page,
space or workspace permissions. Changing `APP_SECRET` invalidates all existing
keys. Keep `APP_SECRET` stable across instances and restarts.

The existing `api_keys` migration supplies the storage; this feature does not
require an additional database migration.

## Use the REST API

Set your instance URL and token in your shell, then pass the key in the
Authorization header. Use HTTPS for remote access.

```bash
export DOCMOST_URL='https://docs.example.com'
read -rs DOCMOST_API_KEY
export DOCMOST_API_KEY

curl --fail-with-body "$DOCMOST_URL/api/users/me" \
  -H "Authorization: Bearer $DOCMOST_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{}'
```

An explicit Authorization header takes precedence over a browser session cookie.
API keys are accepted only as bearer credentials. They cannot be used as browser
sessions, websocket/collaboration credentials, or to manage keys or sessions.
Key management, logout, password changes and collaboration-token issuance require
an interactive browser session. This prevents API credentials from minting new
credentials with a different lifetime.

Docmost's API uses **POST** for most operations, including reads. Do not substitute
GET/PUT/DELETE for documented POST routes. The same existing controllers serve the
web client and API requests, so content updates, permissions, events and realtime
notifications share one implementation.

Typical available resource groups:

| Resource               | Example routes under `/api`                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| Current user/workspace | `/users/me`, `/workspace/info`, `/workspace/members`                                           |
| Pages                  | `/pages/info`, `/pages/create`, `/pages/update`, `/pages/delete`, `/pages/restore`             |
| Navigation/history     | `/pages/sidebar-pages`, `/pages/breadcrumbs`, `/pages/history`                                 |
| Spaces/members         | `/spaces`, `/spaces/info`, `/spaces/create`, `/spaces/members`                                 |
| Groups/members         | `/groups`, `/groups/create`, `/groups/members`, `/groups/members/add`                          |
| Search                 | `/search`, `/search/suggest`                                                                   |
| Comments               | `/comments`, `/comments/create`, `/comments/update`, `/comments/delete`                        |
| Public sharing         | `/shares/create`, `/shares/for-page`, `/shares/update`, `/shares/delete`                       |
| Labels                 | `/labels`, `/pages/labels`, `/pages/labels/add`                                                |
| Bases                  | `/bases/info`, `/bases/properties/create`, `/bases/rows`, `/bases/rows/create`, `/bases/views` |
| Other core resources   | `/favorites`, `/notifications`, `/pages/watch`, `/spaces/watch`                                |
| Files/import/export    | `/files/upload`, `/files/info`, `/pages/import`, `/pages/export`, `/spaces/export`             |

Use the public API reference for each route's complete payload. Features such as
AI, templates, enterprise page permissions, MFA, PDF export and audit-log storage
remain subject to their own availability. File downloads use GET and import/upload
operations use the documented multipart fields instead of JSON.

### Create a page with Markdown

```bash
curl --fail-with-body "$DOCMOST_URL/api/pages/create" \
  -H "Authorization: Bearer $DOCMOST_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"spaceId":"SPACE_UUID","title":"API example","content":"# Hello\nCreated through the API.","format":"markdown"}'
```

Use the returned `data.id` as `pageId` in `/pages/info` and `/pages/update`.
Updating content supports `operation: "append"`, `"prepend"` or `"replace"` and
`format: "markdown"`, `"html"` or `"json"`. JSON content uses ProseMirror JSON.

### Responses and pagination

JSON responses retain the existing envelope:

```json
{ "data": {}, "success": true, "status": 200 }
```

List endpoints return `data.items` and `data.meta`. Send `limit` (1–100, default
20), then pass `data.meta.nextCursor` as `cursor` or `prevCursor` as `beforeCursor`.
Pagination cursors are opaque: do not construct them or reuse them with different
filters. Raw file/download responses are exceptions to the JSON envelope.

Invalid, revoked, expired or disabled-account keys return 401. Insufficient user
permissions or administrator-only API access return 403. Resource-level checks may
use 404 to avoid disclosing inaccessible resources.

## Key management endpoints

These documented routes are available through an authenticated browser session
(HTTP-only `authToken` cookie), not through an API key:

| POST route             | JSON body                                               | Result in `data`                                                               |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/api/api-keys`        | `{ "limit": 20, "cursor": "...", "adminView": false }`  | Cursor-paginated key metadata; `adminView: true` requires an admin             |
| `/api/api-keys/create` | `{ "name": "CI", "expiresAt": "2030-01-01T00:00:00Z" }` | Key metadata and a one-time `token` string; omit `expiresAt` for no expiration |
| `/api/api-keys/update` | `{ "apiKeyId": "UUID", "name": "New name" }`            | Updated metadata                                                               |
| `/api/api-keys/revoke` | `{ "apiKeyId": "UUID" }`                                | Empty result; the key is soft-deleted and cannot authenticate again            |

Members can manage only their own keys. Administrators can rename/revoke any key
in their workspace, but can create keys only for themselves. The list includes
`creator` summaries and never returns a token. Creation responses include
`Cache-Control: no-store`. Browser-session expiry does not shorten API-key expiry;
no-expiration keys have no JWT `exp` claim.

## Implementation and compatibility

Server code is fork-authored in `apps/server/src/ce/api-key`; the fixed enterprise
import used by the core JWT strategy forwards to it through a one-line adapter.
Client code is in `apps/client/src/ce/api-key`, with the existing `@/ee/api-key`
call sites forwarded through CE adapters. No enterprise implementation is loaded
or copied. API contracts were checked against the public OpenAPI 1.1.0 schema
served by the API reference on 2026-10-28.
