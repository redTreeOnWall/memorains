---
name: memorains-deploy
description: Deploy memorains to production servers. Use when the user wants to deploy, ship, push, or release memorains, or mentions putting it on the server/VPS/production.
---

# Memorains Deploy

Deploy the memorains project to one or more production servers.

## Step 0: Determine where to deploy

**If the user already specified which host(s) to deploy to**, use them.

**Otherwise, ask:** "Which server(s) should I deploy to?"

For each host, discover the project root and package directory by inspecting the running containers. Run this on the server:

```bash
ssh <HOST> "podman inspect reno_note_nodejs --format '{{range .Mounts}}{{if eq .Destination \"/app/server\"}}{{.Source}}{{end}}{{end}}'"
```

This returns the mount source path like `/root/app/note/package/server`. Strip the trailing `/server` to get the package directory, and strip `/package` to get the project root where `package.tar.gz` should be uploaded.

For example, `/root/app/note/package/server` → package dir: `/root/app/note/package`, project root: `/root/app/note`.

If no containers are running, ask the user for the project root path.

## Prerequisites

- SSH access to the target servers must work (key-based auth)
- Servers must have `podman` and `podman-compose` installed

## Deploy Steps

Execute these steps in order for each server. Wait for each step to complete before starting the next.

The project root is the directory containing this skill: walk up from `.agents/skills/memorains-deploy/` to the repository root. All local paths below are relative to that project root.

### 1. Build the web package locally

```bash
cd <PROJECT_ROOT>/script && bash build_web_package.sh
```

This produces `out/package.tar.gz`. If the package was already built recently and no code changes were made, skip this step.

### 2. Upload to the server

```bash
scp <PROJECT_ROOT>/script/out/package.tar.gz <HOST>:<PROJECT_ROOT>/
```

### 3. Stop and remove existing containers

```bash
ssh <HOST> "cd <PACKAGE_DIR> && podman-compose down 2>&1 || true"
```

The `|| true` handles the case where no containers are currently running.

### 4. Clean and extract the new package

```bash
ssh <HOST> "rm -rf <PACKAGE_DIR> && cd <PROJECT_ROOT> && tar -zxf package.tar.gz"
```

### 5. Start the new containers

```bash
ssh <HOST> "cd <PACKAGE_DIR> && podman-compose up -d"
```

### 6. Verify deployment

```bash
ssh <HOST> "podman ps --filter name=reno_note --format '{{.Names}} {{.Status}}'"
```

All three containers (`reno_note_mariadb`, `reno_note_nodejs`, `reno_note_nginx`) should show as **Up**.

## What gets deployed

| Container | Purpose |
|-----------|---------|
| `reno_note_mariadb` | MariaDB database (data persisted via named volume) |
| `reno_note_nodejs` | Express + WebSocket server (Node.js Alpine) |
| `reno_note_nginx` | Nginx reverse proxy (ports 80/443) |
