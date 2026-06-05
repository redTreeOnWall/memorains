#!/bin/bash
set -e

# Build memorains Docker image
# Run from the script/ directory

script_dir=`pwd`
project_dir="$script_dir/.."

echo "=== Building server ==="
cd "$project_dir/server"
npm run build

echo "=== Building client ==="
cd "$project_dir/client"
npm run build

echo "=== Applying service-worker cache hash ==="
hash=$(find "$project_dir/client/dist" -type f ! -name 'sw.js' -exec sha256sum {} + | sort -k2 | sha256sum | cut -c1-8)
sed -i "s/PACKAGE_HASH/${hash}/" "$project_dir/client/dist/sw.js"
echo "PACKAGE_HASH = ${hash}"

echo "=== Building Docker image ==="
cd "$project_dir"
podman build -t memorains:latest .

echo "=== Exporting Docker image ==="
rm -rf "$script_dir/out"
mkdir -p "$script_dir/out"
podman save memorains:latest | gzip > "$script_dir/out/memorains-image.tar.gz"

echo "=== Done ==="
echo "Image exported to script/out/memorains-image.tar.gz"
echo ""
echo "Deploy on server:"
echo "  podman load < memorains-image.tar.gz"
echo "  podman run -d -p 80:80 -p 443:443 \\"
echo "    -v memorains-db:/var/lib/mysql \\"
echo "    -v ~/certificate:/app/certificate \\"
echo "    --name memorains memorains:latest"
