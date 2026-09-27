# Memorains Note — Agent Instructions

Collaborative note-taking app: React+Vite client, Express+WS server, Yjs CRDT, MariaDB.

## Build & Run

| Where | Command | Notes |
|-------|---------|-------|
| `client/` | `npm run dev` | Vite dev server, http://localhost:5173 |
| | `npm run build` | tsc + vite build + sw-version.js |
| | `npm run lint` / `lint:fix` | ESLint; `lint` must exit 0 |
| `server/` | `npm run dev` | app + tsc watch + podman mariadb, all-in-one |
| | `npm run build` | tsc → `build/` (committed, so rebuild after editing src) |

See more in package.json

## Architecture

**The server is multi-process:** a main process forks N `DocServerImp` children
(2 per CPU, 2 in dev), one WebSocket port each. `DocServerImp` relays Yjs binary
updates without interpreting them — document content is understood only by the
client. See `server/src/imp/DocServerManagerImp.ts`.

**Client data flow:** `NoteDocument` (owns the `Y.Doc` + IndexedDB persistence)
→ `MessageBridge` (WS lifecycle/reconnect) → `CommonEditor` (chrome, presence,
shortcuts) → the type's editor. Shared framework lives in `client/src/editor/`.

## Document Types — the main extension point

One folder per type: `client/src/doc-types/plugins/<type>/{index.ts,<Editor>.tsx}`.
`index.ts` default-exports a `DocTypePlugin`; the registry auto-discovers it via
`import.meta.glob`, so adding a type touches **no other file** — not the router,
menus, or list view. Contract: `doc-types/pluginTypes.ts`; discovery + lookup:
`docTypeRegistry.ts`.

## Commit Conventions

1. Bump `client/` and/or `server/` `package.json` version: patch = fix,
   minor = new feature, major = breaking.
2. In the affected package run `npm run lint` **and** `npm run build`; zero errors.
   For server changes, commit the rebuilt `server/build/` too.
3. **Never commit or push unless explicitly told to.**
4. Add `Co-authored-by: pi` to every commit message.

## Testing with Chrome DevTools MCP

- If the dev servers are down, start them in a tmux window named `memorains-dev` (client + server panes), then open http://localhost:5173/doc/client/.
- Test account: `test` / `123456` (sign up if it does not exist in the podman dev DB).
- Prefer log analysis / script execution / DOM queries over screenshots and clicks. Unless you need to get a sense of the visuals or take in the overall state of the interface at a glance.
- When testing, check whether the session is signed in or in offline mode.
