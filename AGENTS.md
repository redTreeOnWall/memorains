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
npm run dev                  # Start three dev server in one command:  node app dev server , tsc, dev db server (podman mariadb)
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
bash build_web_package.sh  # → out/package.tar.gz (client/dist + server + DB schema + nginx + docker-compose)
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

Four built-in document types, each implemented as a **self-contained plugin**
under `client/src/doc-types/plugins/<type>/`:

| Type | Editor | URL path | Yjs binding |
|------|--------|----------|-------------|
| `text` | `QuillEditor` | `/document` | `getText("quill")` |
| `canvas` | `ExcalidrawCanvas` | `/canvas` | `getMap("excalidraw_elements")` / `_files` / `_config` |
| `todo` | `TodoListEditor` | `/todo` | `getArray("todolist_items")` |
| `chat` | `ChatEditor` | `/chat` | `getArray("chat_messages")` |

Every editor is wrapped by `CommonEditor`, which provides:
- Document title bar, save/sync status indicators, offline/reconnect banners
- User presence indicators (colored circles per collaborator)
- Sidebar (`SideList`) navigation between documents
- Keyboard shortcut management (`ShortcutManager`)

The shared framework lives in `client/src/editor/` (`CommonEditor.tsx`,
`NoteDocument.ts`, `MessageBridge.ts`) — it is **not** a document type, so it is
deliberately outside `doc-types/`.

**Core data flow in the client:**

```
NoteDocument          ← Yjs Doc (source of truth)
    ↓
MessageBridge         ← WebSocket (sends/receives Yjs updates + cursors)
    ↓
CommonEditor          ← UI wrapper (title, status, reconnect)
    ↓
doc-types/plugins/<type>/  ← binding layer (one folder per document type)
```

- `NoteDocument` owns the `Y.Doc` and coordinates local persistence (IndexedDB) with remote sync
- `MessageBridge` owns the WebSocket lifecycle, handles reconnection with exponential backoff (max 5 retries), and relays `ServerMessage` to listeners
- Editor-specific components bind a Yjs type (e.g., `ydoc.getText("quill")`) to the UI via framework-specific adapters (`y-quill` for Quill)

### Client: Document Type Plugins

All knowledge about a document type lives in one `DocTypePlugin` object, so no
other file branches on `DocType.x`. The registry is
`client/src/doc-types/docTypeRegistry.ts`; contracts are in `pluginTypes.ts`.

**Adding a new document type** = creating one folder:

```
client/src/doc-types/plugins/<type>/
    index.ts        # default-exports a DocTypePlugin
    <Editor>.tsx    # the editor component (optional — see Editor: null)
```

The registry auto-discovers plugins with
`import.meta.glob("./plugins/*/index.ts", { eager: true })` — **no other file
needs editing**. A minimal plugin:

```ts
const plugin: DocTypePlugin = {
  type: DocType.todo,        // enum value persisted in DocumentEntity.doc_type
  id: "todo",                // also the URL path segment
  order: 40,                 // sort position in menus (default 100)
  labelKey: "doc_type_todo", // i18n keys, never literal translations
  createLabelKey: "new_todo_button",
  color: "#2e7d32",
  buttonColor: "success",
  Icon: TaskRoundedIcon,
  Editor: TodoListEditor,
  creatable: true,
  toMarkdown: (yDoc) => "…", // optional; auto-adds the export menu item
};
export default plugin;
```

Key points:

- **`Editor: null` means "known but not implemented"** (e.g. `DocType.mix`).
  Such a type gets no route and is never creatable, so a document of that type
  can never be opened as a different type and silently corrupted. Implement
  `Editor` to switch the type on — nothing else changes.
- **`creatable` is effectively gated by `Editor`**: `getCreatableDocTypePlugins()`
  filters `getRoutableDocTypePlugins()` (i.e. `Editor !== null`) first.
- **`toMarkdown` is the extensibility seam for content projection.** Implementing
  it automatically adds the "Export to Markdown" menu item, and it is the same
  "one string per document" projection a future full-text search index needs.
- **`menuItems` lets a plugin contribute per-document list actions.** The list
  view renders `getDocTypePlugin(doc_type).menuItems` without knowing any
  specific type; `visible?(doc)` gates an item per document.
- **Built lazily.** The registry sits inside an import cycle
  (`registry → plugins/* → editor/CommonEditor → SideList → MyDocs → registry`),
  so the plugin list is constructed on first access, never at module scope.

Runtime registration (for plugins outside the built-in directory — e.g. an
embedding host app) is also supported:

```ts
const dispose = registerPlugin({ /* … */ });
unregisterPlugin(DocType.todo);
reloadPlugins();               // invalidate the cache
```

Routes are generated from `getRoutableDocTypePlugins()`, so a new type's route
exists automatically. `docTypeRoute(type)` maps a type to its path segment and
falls back to the text type for unknown values, so a corrupted or future
`doc_type` never produces a dead link.

**The server never validates `doc_type`** — it stores and returns it verbatim.
Adding a client-side document type therefore requires **no server change** and
no `sync_interface.sh` run (unless you also add an enum member to
`DataEntity.ts`, which is a shared file).

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
| `DataEntity.ts` | `DocumentEntity`, `UserEntity`, `DocType` enum, `PrivilegeEnum`, `DocumentPublic` — note `DocType` is a **shared** enum, so adding a member means editing both copies (via `sync_interface.sh`) |
| `UserServerMessage.ts` | WebSocket message types (`ClientMessageType`/`ServerMessageType`) |
| `HttpMessage.ts` | REST API request/response types |
| `Interface.ts` | Server-side only — `DocApplication`, `DocServerManager`, `UserServer` interfaces |
| `ProcessMessage.ts` | Server-side only — IPC message types between main & child processes |

### Routing (Client)

Static pages:

| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `HomePage` | Welcome, login/signup, offline mode entry |
| `/login` | `LoginPage` | Username/password auth |
| `/sign-up` | `SignUpPage` | User registration |
| `/my-doc` | `MyDocs` | Document list with search, create, delete |

Editor routes are **generated from the doc type registry** — one `<Route>` per
plugin whose `Editor` is non-null, using the plugin's `id` as the path segment:

| Path | Editor | `DocType` |
|------|--------|-----------|
| `/document?docId=X` | `QuillEditor` | `text` |
| `/canvas?docId=X` | `ExcalidrawCanvas` | `canvas` |
| `/todo?docId=X` | `TodoListEditor` | `todo` |
| `/chat?docId=X` | `ChatEditor` | `chat` |

There is no per-type `<Route>` in `index.tsx`, so adding a document type does
not touch the router. Unknown paths fall through to `*`, which redirects to `/`.

Open a document with the shared helper rather than building URLs by hand:

```ts
openDoc(docType, docId, navigate);   // → /<docTypeRoute(docType)>?docId=…
```

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

1. Bump `version` in `client/package.json` and/or `server/package.json`:
   - **Patch** (`0.14.x`): bug fixes, minor UI tweaks
   - **Minor** (`0.x.0`): new features, significant changes
   - **Major** (`x.0.0`): breaking changes
2. Run `npm run lint` and `npm run build` in the affected package; ensure zero errors
3. **Never commit/push automatically.** Only commit and push when explicitly commanded.
4. Add `Co-authored-by: pi` to every commit message.
5. Keep refactors and pure file moves/formatting in **separate commits** from
   behaviour changes, so `git show --stat` stays reviewable.

### Handling uncommitted work safely

This repository often carries **long-lived stashes and unrelated dirty files**.
`git stash` is therefore destructive here — a `pop` can silently restore
someone else's work into your tree.

- **Never wrap read-only checks (`eslint`, `tsc`, tests) in a stash cycle.** If
  there is nothing to stash, `git stash push` is a no-op and the following
  `git stash pop` will eject a **pre-existing** stash. To compare against an
  older revision, use a read-only method instead:

  ```bash
  git show <rev>:path/to/file > /tmp/old.ts   # then diff / lint that copy
  npx eslint --stdin --stdin-filename src/x.ts < /tmp/old.ts
  ```

- Verify the stash state before any stash command: `git stash list`.
- If you do eject a stash by accident, it is recoverable: the commit stays
  reachable via `git fsck --unreachable --no-reflogs`. Restore it with
  `git stash store -m "<original message>" <sha>`, then confirm the tree hash
  matches the original (`git rev-parse 'stash@{0}^{tree}'`).
- Don't commit unrelated dirty files that you did not change.

---

## Testing with Chrome DevTools MCP

If the dev servers are not running , start in a new tmux window in current session (use fixed name: memorains-dev with client pane and server pane ), then open `http://localhost:5173/doc/client/`.

Test account: `test` / `123456`.

If login fails, check the user exists in the podman dev DB, If not, sign up with the account.

When use Chrome dev mcp, less screenshot / clicking, more log analysis/ script running / dom operation.
