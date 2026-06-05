FROM debian:bookworm-slim

# Switch to Alibaba Debian mirror for faster downloads in China
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list

# Install all services + build tools for native npm modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    mariadb-server \
    mariadb-client \
    nginx \
    nodejs \
    npm \
    supervisor \
    build-essential \
    libmariadb-dev \
    && rm -rf /var/lib/apt/lists/*

# Create runtime directories
RUN mkdir -p /run/mysqld /var/log/supervisor /app/server /app/client /app/certificate \
    && chown -R mysql:mysql /run/mysqld /var/lib/mysql

# Install Node.js dependencies first (cached layer)
COPY server/package.json server/package-lock.json /app/server/
WORKDIR /app/server
RUN npm install --production

# Copy compiled server code & SQL schema
COPY server/build/ /app/server/build/
COPY server/DB/ /app/server/DB/

# Copy client static files
COPY client/dist/ /app/client/

# Copy config files
COPY nginx.conf /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/supervisord.conf
COPY entrypoint.sh /entrypoint.sh
COPY start-node.sh /start-node.sh
RUN chmod +x /entrypoint.sh /start-node.sh

# Remove default nginx site that conflicts with our config
RUN rm -f /etc/nginx/sites-enabled/default

EXPOSE 80 443

VOLUME ["/var/lib/mysql", "/app/certificate"]

ENTRYPOINT ["/entrypoint.sh"]
