## Compile
``` shell
./node_modules/typescript/bin/tsc -w
```

## Start DEV Server

``` shell
npm install
npm run dev
npm run server
```

## Production (Docker)

The project root contains a `Dockerfile` that bundles MariaDB + nginx + Node.js into a single image.

```bash
# From project root:
podman build -t memorains:latest .

podman run -d \
  -p 80:80 -p 443:443 \
  -v memorains-db:/var/lib/mysql \
  -v ~/certificate:/app/certificate \
  --name memorains \
  memorains:latest
```

Tables are auto-created on first run. DB and user are initialized by the entrypoint script.

