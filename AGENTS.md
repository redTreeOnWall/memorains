# Memorains Note — Agent Instructions

## Build & Run Commands

### Client (React + Vite)

```bash
cd client
npm install                  # also copies Excalidraw fonts to public/
npm run dev                  # Vite dev server, http://localhost:5173
npm run build                # tsc + vite build + sw-version.js
npm run lint                 # ESLint check
npm run lint:fix             # ESLint auto-fix
```

### Server (Express + WS, CommonJS target)

```bash
cd server
npm install
npm run build                # tsc → build/
npm run server               # node build/index.js (requires running DB)
npm run dev                  # podman-compose up -d + tsc --watch + node (IS_DEV=true)
```

### Desktop (Electron)

```bash
cd client
npm run desktop:dev          # tsc electron/ + electron . --no-sandbox
npm run desktop:package      # electron-forge package
npm run desktop:make         # electron-forge make (all platforms)
npm run desktop:make:win     # cross-compile for Windows
```

### Mobile (Capacitor — Android)

```bash
cd client
npm run mobile:build         # VITE_BUILD_CAPACITOR=true vite build
npm run mobile:open:android  # build + sync + open in Android Studio
npm run mobile:sign:android  # signed release APK → built-apk/memorains-release.apk
```

The signing keystore lives at `client/memorains.keystore`. `client/scripts/build-android-release.sh` copies it into the Capacitor-managed `android/` dir before building.

### Production Package

```bash
cd script
bash build_package.sh        # → package.tar.gz (client/dist + server + DB schema + nginx + docker-compose)
```

### Deploy

```bash
tar -zxvf package.tar.gz
cd package
mkdir -p ~/certificate       # place cert.pem + cert.key
podman compose up -d
# browse: https://<host>/doc/client/
```

### Build Scripts (`script/`)

| Script | Purpose |
|--------|---------|
| `build_web_package.sh` | Production deploy tarball (`out/package.tar.gz`: client/dist + server/ + DB + nginx + docker-compose) |
| `build_client_package.sh` | Desktop (.deb + .zip) and Android .apk → `out/` |
| `build_all.sh` | Runs both of the above in sequence |
| `sync_interface.sh` | Copies `HttpMessage.ts` + `DataEntity.ts` from `server/src/interface/` to `client/src/interface/` (does **not** sync `UserServerMessage.ts` — that file must be synced manually) |

**Note:** All scripts must be run from the `script/` directory (they use `` script_dir=`pwd` `` rather than `$(dirname "$0")`).

---

## Architecture

### Server: Multi-Process Model

The server spawns **N child processes** (one per CPU core × 2, or 2 in dev), each running `DocServerImp.ts` on a different WebSocket port (8081+). The **main process** hosts:

- `DocApplicationImp` — entry point, initializes `DocServerManagerImp` and `UserServerImp`
- `DocServerManagerImp` — manages child processes via `child_process.fork()`, routes document-open requests to the least-loaded child, cleans up zero-user rooms
- `UserServerImp` — Express HTTP server on port 8000 (auth, CRUD, document room token issuance)
- `DataBaseManagerImp` — MariaDB pool (host: `reno_note_mariadb` in prod, `127.0.0.1` in dev)

**Key flow for opening a document:**

1. Client → `POST /doc/server/docRoomInfo` (with JWT)
2. `UserServerImp` checks permissions, calls `DocServerManagerImp.requestOpenDoc(docId)`
3. `DocServerManagerImp` picks the least-loaded child process, sends `M2C_OpenMessageRequest` via IPC
4. Child process loads the document state from MariaDB into a Yjs `Y.Doc`, returns room password + port
5. Server issues a short-lived JWT (`roomToken`) scoped to docId+userId
6. Client opens WebSocket to `wss://host/doc/websocket/<docId>/<userId>/<password>/<roomToken>`

### Client: Editor Abstraction

Three editor types share a common wrapper:

- **QuillEditor** — rich text (URL path `/document`)
- **ExcalidrawCanvas** — infinite canvas (`/canvas`)
- **TodoListEditor** — task manager (`/todo`)

Every editor is wrapped by `CommonEditor`, which provides:
- Document title bar, save/sync status indicators, offline/reconnect banners
- User presence indicators (colored circles per collaborator)
- Sidebar (`SideList`) navigation between documents
- Keyboard shortcut management (`ShortcutManager`)

**Core data flow in the client:**

```
NoteDocument          ← Yjs Doc (source of truth)
    ↓
MessageBridge         ← WebSocket (sends/receives Yjs updates + cursors)
    ↓
CommonEditor          ← UI wrapper (title, status, reconnect)
    ↓
QuillEditor / ExcalidrawCanvas / TodoListEditor  ← binding layer
```

- `NoteDocument` owns the `Y.Doc` and coordinates local persistence (IndexedDB) with remote sync
- `MessageBridge` owns the WebSocket lifecycle, handles reconnection with exponential backoff (max 5 retries), and relays `ServerMessage` to listeners
- Editor-specific components bind a Yjs type (e.g., `ydoc.getText("quill")`) to the UI via framework-specific adapters (`y-quill` for Quill)

### Offline & Sync Strategy

- All documents are stored in IndexedDB (`client/src/DB/IndexedDB.ts`) — the `document` object store mirrors `DocumentEntity`
- On open: local data loads first for instant render; then the WebSocket syncs diffs via Yjs state vectors
- Edits are always written to the local Yjs Doc immediately; if online they're also sent via WebSocket
- If offline, `ensureConnected()` triggers lazy reconnect — on reconnect, client sends its state vector and server replies with the diff
- Auto-save to IndexedDB is throttled (5s debounce) and triggered after every local edit
- The `autoSaveToLocal` setting controls whether saving requires manual trigger (Ctrl+S)

### Server-Side Yjs & Collaboration

- Each `OnLineDocument` wraps a `Y.Doc` that is the server-side source of truth for a document
- Updates are broadcast to all connectors in the room (except the origin)
- State is persisted to MariaDB every 30 seconds via `Y.encodeStateAsUpdate()`
- Server assigns a monotonically increasing `commit_id` to track document versions
- `DocServerImp` acts as a relay — it doesn't interpret document content, only routes Yjs binary updates

### Shared Interfaces

Interface files under `client/src/interface/` and `server/src/interface/` are **kept in sync** (currently identical). The script `script/sync_interface.sh` handles this. Key types:

| File | Purpose |
|------|---------|
| `DataEntity.ts` | `DocumentEntity`, `UserEntity`, `DocType` enum, `PrivilegeEnum`, `DocumentPublic` |
| `UserServerMessage.ts` | WebSocket message types (`ClientMessageType`/`ServerMessageType`) |
| `HttpMessage.ts` | REST API request/response types |
| `Interface.ts` | Server-side only — `DocApplication`, `DocServerManager`, `UserServer` interfaces |
| `ProcessMessage.ts` | Server-side only — IPC message types between main & child processes |

### Routing (Client)

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `HomePage` | Welcome, login/signup, offline mode entry |
| `/login` | `LoginPage` | Username/password auth |
| `/sign-up` | `SignUpPage` | User registration |
| `/my-doc` | `MyDocs` | Document list with search, create, delete |
| `/document?docId=X` | `QuillEditor` | Rich text document |
| `/canvas?docId=X` | `ExcalidrawCanvas` | Canvas drawing document |
| `/todo?docId=X` | `TodoListEditor` | Todo list document |

### Database Schema

MariaDB tables (created via `server/DB/document.sql` on first run if missing):

- **`user`** — `id`, `password` (salted hash), `salt`, `wrong_pass_word_count`, `last_login_time`
- **`document`** — `id`, `title`, `user_id`, `create_date`, `last_modify_date`, `state` (LONGBLOB — Yjs encoded), `is_public`, `commit_id`, `doc_type`, `encrypt_salt`
- **`doc_privilege`** — `doc_id`, `user_id`, `group_id`, `privilege` (sharing/permissions)

### Infrastructure (docker-compose)

Three services on a bridge network (`reno_note_app_network`):

- **reno_note_mariadb** — MariaDB, data persisted via named volume
- **reno_note_nodejs** — Node.js Alpine, mounts `./server` as working dir, runs `node build/index.js`
- **reno_note_nginx** — Nginx reverse proxy, serves `client/dist` at `/doc/client`, proxies `/doc/server` to `reno_note_nodejs:8000`, handles WebSocket upgrade for `/doc/websocket/port_XXXX`

The nginx config uses a Podman-specific DNS resolver (`10.89.0.1`). Docker users may need to change it to `127.0.0.11`.

### Environment Variables

- `IS_DEV=true` — enables CORS, auto-creates tables, spawns 2 child processes instead of per-CPU
- `SECRET` — JWT signing secret (auto-generated random string if not set)
- `NODE_ENV=production` — set in docker-compose for the Node.js container
- `VITE_BUILD_ELECTRON=true` — Electron target build
- `VITE_BUILD_CAPACITOR=true` — Capacitor (mobile) target build

---

## Commit Conventions

1. Run `npm run build` in the affected package; ensure zero errors
2. Bump `version` in `client/package.json` and/or `server/package.json`:
   - **Patch** (`0.8.x`): bug fixes, minor UI tweaks
   - **Minor** (`0.x.0`): new features, significant changes
   - **Major** (`x.0.0`): breaking changes
3. **Never commit/push automatically.** Only commit and push when explicitly commanded.
4. Add `Co-authored-by: pi` to every commit message.

---

## Key Technical Notes

- **Yjs GC is enabled** (`gc: true`) in `NoteDocument`. The server's Yjs Doc also uses default GC behavior. This means deleted content is periodically pruned from the document state.
- **Encrypted documents**: When `encrypt_salt` is present on a document, the client decrypts/encrypts locally via Web Crypto API. The server stores only ciphertext and does not open the doc in a WebSocket room — it returns the encrypted state directly via the HTTP API.
- **Password hashing**: Uses a custom salted hash (`getSaltedPassword` in `utils.ts`), not bcrypt.
- **No test framework** is currently configured. Both `client` and `server` have placeholder `test` scripts that return an error.
- **Static IP assumptions**: The nginx resolver and database hostname are hardcoded. Changes to the container runtime may require updates to `nginx.conf` (resolver) and `DataBaseManagerImp.ts` (DB host).
- **Mobile builds disable PWA/service worker** — the app loads local files with `./` base path. The API host is set via `localStorage.setItem("memo_note_host", "your-server.com")`.
- **Client `postinstall`** copies Excalidraw fonts into `public/excalidraw_assets/fonts/`.
