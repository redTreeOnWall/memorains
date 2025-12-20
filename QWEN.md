# Memorains Note - Project Documentation

## Project Overview

**Memorains** is a comprehensive note-taking application that integrates rich text editing with canvas drawing capabilities. It supports both online and offline use, as well as multi-user and multi-device collaboration.

### Core Technologies

**Client (Frontend):**
- **Framework:** React 18 with TypeScript
- **Build Tool:** Vite
- **Rich Text Editor:** Quill (with extensions for tables, cursors, image compression, markdown shortcuts)
- **Canvas Drawing:** Excalidraw
- **Collaboration:** Yjs (CRDT-based conflict-free synchronization)
- **UI Library:** Material-UI (MUI) v6
- **Desktop App:** Electron
- **Routing:** React Router v6

**Server (Backend):**
- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** MariaDB
- **Real-time Communication:** WebSocket (ws)
- **Authentication:** JSON Web Tokens (JWT)

**Infrastructure:**
- **Containerization:** Podman/Docker
- **Web Server:** Nginx (reverse proxy + SSL termination)
- **Database:** MariaDB

### Architecture

The project follows a **client-server architecture** with real-time collaboration:

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Web Browser   │         │   Nginx (HTTPS)  │         │   MariaDB    │
│   Desktop App   │◄───────►│   Reverse Proxy  │◄───────►│   Database   │
│   Mobile App    │         └──────────────────┘         └──────────────┘
└─────────────────┘                   │
                                      │
                                      ▼
                            ┌──────────────────┐
                            │  Node.js Server  │
                            │  (Express + WS)  │
                            └──────────────────┘
```

**Key Features:**
- Three note types: Rich text editor, Infinite canvas, and Todo list editor
- Conflict-free collaboration using Yjs CRDT
- Multi-device/user real-time sync
- Online & offline support
- Cross-platform clients: Web, Desktop (Linux/Windows/macOS), Mobile (Android/iOS)

### Todo List Editor Features
The TodoListEditor (`client/src/editor/TodoListEditor.tsx`) provides:
- Task creation and management
- Task completion tracking
- Deadline setting with visual indicators (overdue, urgent, upcoming)
- Real-time collaborative editing via Yjs
- Clear completed tasks functionality
- Edit and delete individual tasks
- Sort by completion status

---

## Building and Running

### Prerequisites

- **Podman** or **Docker** (for containerized deployment)
- **Node.js** (for development)
- **SSL Certificate** (for HTTPS)

### Development Setup

#### Client Development

```bash
cd client
npm install
npm run dev
```

This starts a Vite dev server at `http://localhost:5173` (or similar).

#### Server Development

```bash
cd server
npm install
npm run build      # Compile TypeScript
npm run server     # Start server (requires running database)
```

For full development with containers:
```bash
cd server
npm run dev        # Starts containers + TypeScript watch mode
```

### Production Deployment

#### 1. Build Application Package

```bash
cd script
bash build_package.sh
```

This creates `package.tar.gz` containing:
- Compiled client (`client/dist`)
- Server source + build (`server/src`, `server/build`)
- Database schema (`server/DB`)
- Docker/Podman compose files
- Nginx configuration

#### 2. Prepare SSL Certificate

On the server:
```bash
mkdir ~/certificate
# Place your SSL certificate and key here:
# ~/certificate/cert.pem
# ~/certificate/cert.key
```

#### 3. Deploy and Run

```bash
tar -zxvf package.tar.gz
cd package
podman compose up -d
# or: docker compose up -d
```

#### 4. Access Application

Open in browser: `https://your-host/doc/client/`

---

## Development Conventions

### Code Style

**TypeScript:**
- Strict mode enabled (`"strict": true`)
- ES2020 target for server
- CommonJS module system for server
- ESM for client

**Linting:**
- ESLint configured for both client and server
- Prettier for code formatting
- Pre-commit hooks recommended

**Client Structure:**
```
client/src/
├── components/     # Reusable UI components
├── const/          # Constants and configurations
├── DB/             # Database/local storage utilities
├── editor/         # Editor components
│   ├── CommonEditor.tsx          # Base editor interface
│   ├── QuillEditor.tsx           # Rich text editor
│   ├── ExcalidrawEditor.tsx      # Canvas drawing editor
│   └── TodoListEditor.tsx        # Task management editor
├── hooks/          # Custom React hooks
├── interface/      # TypeScript interfaces/types
├── internationnalization/  # i18n support
├── pages/          # Route pages
└── utils/          # Utility functions
```

**Server Structure:**
```
server/src/
├── build/          # Compiled JavaScript output
├── DB/             # Database schema and migrations
├── src/            # TypeScript source files
└── post-test/      # Test utilities
```

### Testing

**Client:**
- No formal test framework currently configured
- Desktop testing: `npm run desktop:test` (placeholder)

**Server:**
- No test framework currently configured
- `npm run test` returns error placeholder

### Build Process

**Client Build:**
1. TypeScript compilation
2. Vite bundling
3. Excalidraw assets copy (fonts)
4. Version management (sw-version.js)

**Server Build:**
1. TypeScript compilation to `build/` directory
2. Output is executable Node.js code

**Package Build:**
1. Build client assets
2. Copy server source + compiled code
3. Include database schema
4. Include infrastructure configs (docker-compose, nginx)
5. Create tarball

### Environment Variables

**Server:**
- `NODE_ENV=production` (in docker-compose)
- `IS_DEV=true` (for development mode)

**Database (docker-compose):**
- `MYSQL_ROOT_PASSWORD=123456`
- `MYSQL_DATABASE=document`
- `MYSQL_USER=doc`
- `MYSQL_PASSWORD=123456`

### Networking

**Docker Network:**
- Bridge network: `reno_note_app_network`
- Services communicate via container names:
  - `reno_note_mariadb`
  - `reno_note_nodejs`
  - `reno_note_nginx`

**Ports:**
- **80**: HTTP (nginx)
- **443**: HTTPS (nginx with SSL)
- **8000**: Node.js server (internal)
- **Dynamic WebSocket ports**: Range 8000-8999 (proxied via nginx)

**WebSocket Proxy:**
- Nginx routes `/doc/websocket/port_XXXX/*` to Node.js on port `XXXX`
- Supports long-lived connections (1800s timeout)

---

## Key Dependencies

### Client
- `@excalidraw/excalidraw`: Canvas drawing
- `quill`: Rich text editor
- `yjs`: CRDT for collaboration
- `y-quill`: Quill binding for Yjs
- `@mui/material`: UI components
- `react-router-dom`: Routing
- `electron`: Desktop app framework

### Server
- `express`: Web framework
- `ws`: WebSocket server
- `mariadb`: Database driver
- `jsonwebtoken`: Authentication
- `yjs`: CRDT support

---

## Third-Party Licenses

See `third-party-license/` directory for detailed license information.

**Main libraries:**
- [quill](https://github.com/slab/quill) - Rich text editor
- [excalidraw](https://github.com/excalidraw/excalidraw) - Canvas drawing
- [material-ui](https://github.com/mui/material-ui) - UI components (used in all editors)
- [yjs](https://github.com/yjs/yjs) - CRDT for collaboration (used in all editors)

---

## Notes for Future Development

1. **Database Initialization**: The README mentions database initialization is no longer needed (commented out). Verify if migrations are handled automatically.

2. **Electron Desktop App**: Client has Electron configuration (`forge.config.cjs`, `electron/` directory) for desktop builds. Use `npm run desktop:package` or `desktop:make` for platform-specific builds.

3. **Mobile Support**: While mentioned in features, mobile implementation details are not visible in the current structure. May require separate mobile app or PWA setup.

4. **Testing**: Both client and server lack formal test suites. Consider adding Jest/Vitest for client and Jest/Mocha for server.

5. **Security**: Current setup uses hardcoded credentials in docker-compose. For production, use environment variables or secrets management.

6. **SSL**: Certificate must be manually placed in `~/certificate/` on the server. Consider automated certificate management (Let's Encrypt).

7. **Offline Support**: Yjs provides offline capabilities, but implementation details should be verified for data persistence.

8. **Multi-platform Builds**: Desktop app supports Linux/Windows/macOS via Electron Forge. Use `desktop:make:win` for Windows cross-compilation.

---

## Quick Reference Commands

```bash
# Development
cd client && npm run dev
cd server && npm run build && npm run server

# Production Build
cd script && bash build_package.sh

# Deployment
tar -zxvf package.tar.gz && cd package && podman compose up -d

# Desktop App
cd client && npm run desktop:dev
cd client && npm run desktop:package
cd client && npm run desktop:make

# Server Management
cd server && npm run build
cd server && npm run dev  # with containers
```

---

## Project Metadata

- **Version**: Client v0.8.65, Server v1.0.0
- **License**: MIT
- **Repository**: https://github.com/redTreeOnWall/memorains
- **Demo**: https://note.lirunlong.com/doc/client/
