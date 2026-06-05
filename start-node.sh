#!/bin/bash
# Wait for MariaDB to be ready before starting Node.js
until mysqladmin ping -h 127.0.0.1 --silent 2>/dev/null; do
    echo "[start-node] Waiting for MariaDB..."
    sleep 1
done
echo "[start-node] MariaDB is ready, starting server..."
cd /app/server
exec node build/index.js
