#!/bin/bash
set -e

# Initialize MariaDB data directory if this is the first run
if [ ! -d /var/lib/mysql/mysql ]; then
    echo "[entrypoint] Initializing MariaDB data directory..."
    mariadb-install-db --user=mysql --datadir=/var/lib/mysql
    echo "[entrypoint] MariaDB data directory initialized."
fi

# Start MariaDB temporarily to create database and user
echo "[entrypoint] Starting temporary MariaDB for init..."
mysqld --user=mysql --datadir=/var/lib/mysql --socket=/run/mysqld/mysqld.sock --skip-networking &
MYSQL_PID=$!

# Wait for MariaDB to be ready
for i in $(seq 1 30); do
    if mysqladmin ping --socket=/run/mysqld/mysqld.sock --silent 2>/dev/null; then
        break
    fi
    echo "[entrypoint] Waiting for MariaDB... ($i)"
    sleep 1
done

# Create database and user (idempotent)
mysql --socket=/run/mysqld/mysqld.sock <<-'EOSQL'
    CREATE DATABASE IF NOT EXISTS document;
    CREATE USER IF NOT EXISTS 'doc'@'localhost' IDENTIFIED BY '123456';
    CREATE USER IF NOT EXISTS 'doc'@'127.0.0.1' IDENTIFIED BY '123456';
    GRANT ALL PRIVILEGES ON document.* TO 'doc'@'localhost';
    GRANT ALL PRIVILEGES ON document.* TO 'doc'@'127.0.0.1';
    FLUSH PRIVILEGES;
EOSQL

echo "[entrypoint] Database and user ready."

# Shut down temporary MariaDB
mysqladmin shutdown --socket=/run/mysqld/mysqld.sock 2>/dev/null || true
wait $MYSQL_PID 2>/dev/null || true

echo "[entrypoint] Starting services via supervisord..."
exec /usr/bin/supervisord
