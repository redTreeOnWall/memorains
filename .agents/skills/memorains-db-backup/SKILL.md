---
name: memorains-db-backup
description: Back up the memorains production database and download the dump to the local backups/ directory. Use when the user wants to back up, dump, export, or download the memorains database, or mentions database backup, DB snapshot, or saving the database.
---

# Memorains DB Backup

Back up the remote MariaDB database and download the compressed dump to the local `backups/` directory.

## Prerequisites

- SSH access to the target server — if the user didn't specify which server, ask
- Server must have `podman` running with the `reno_note_mariadb` container

## Determine the target host

If the user already specified a host, use it. Otherwise, ask: "Which server should I back up?"

In all commands below, replace `<HOST>` with the actual hostname.

## Backup Steps

### 1. Dump the database

```bash
ssh <HOST> "podman exec reno_note_mariadb mariadb-dump -u doc -p123456 document > /tmp/memorains_backup_\$(date +%Y%m%d_%H%M%S).sql"
```

### 2. Compress the dump

```bash
ssh <HOST> "ls -t /tmp/memorains_backup_*.sql | head -1 | xargs gzip -f && ls -lh /tmp/memorains_backup_*.sql.gz | tail -1"
```

### 3. Download to local backups/ directory

```bash
scp <HOST>:/tmp/memorains_backup_<TIMESTAMP>.sql.gz <PROJECT_ROOT>/backups/
```

If the download is slow (file may be 50-80MB), add `-o ConnectTimeout=30 -o ServerAliveInterval=15` to the scp command and use a generous timeout.

### 4. Verify integrity

```bash
gzip -t <PROJECT_ROOT>/backups/memorains_backup_<TIMESTAMP>.sql.gz && echo "✅ Backup complete and verified"
```

### 5. Clean up remote temp file

```bash
ssh <HOST> "rm /tmp/memorains_backup_*.sql.gz"
```

## Database Connection Details

| Parameter | Value |
|-----------|-------|
| Container | `reno_note_mariadb` |
| Database | `document` |
| User | `doc` |
| Password | `123456` |

These come from `docker-compose.yml` in the deployed package.

## Output

A timestamped, gzip-compressed SQL dump saved in `<PROJECT_ROOT>/backups/`:

```
backups/memorains_backup_20260628_152430.sql.gz
```

## Restore (if needed)

```bash
gunzip < memorains_backup_<TIMESTAMP>.sql.gz | podman exec -i reno_note_mariadb mariadb -u doc -p123456 document
```
