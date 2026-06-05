# build web
script_dir=`pwd`
cd $script_dir
cd ../client
npm run build
cd $script_dir
rm -rf ./package
rm -rf ./out/package.tar.gz
mkdir -p package/client
mkdir -p package/server
cp -r ../client/dist ./package/client/
cp -r ../server/src ./package/server/
cp -r ../server/build ./package/server/
cp -r ../server/DB ./package/server/
cp -r ../server/package.json ./package/server/
cp -r ../server/package-lock.json ./package/server/
cp -r ../server/tsconfig.json ./package/server/
cp -r ../server/README.md ./package/server/
cp -r ../server/.npmrc ./package/server/

# Pre-install production dependencies so the container doesn't need npm at runtime
cd ./package/server && npm ci --only=production && cd $script_dir

cp -r ../docker-compose.yml ./package/
cp -r ../nginx.conf ./package/
cp -r ../mariadb-conf ./package/

# Hash the package contents for SW cache busting
hash=$(find ./package -type f ! -name 'sw.js' -exec sha256sum {} + | sort -k2 | sha256sum | cut -c1-8)
sed -i "s/PACKAGE_HASH/${hash}/" ./package/client/dist/sw.js
echo "PACKAGE_HASH = ${hash}"

tar -zcvf ./out/package.tar.gz ./package
# tar -zxvf ./package.tar.gz
rm -rf ./package



# tar -zxvf ./package.tar.gz

# # cd $script_dir/package/server
# # 
# # npm i
# 
# cd $script_dir/package
# 
# podman-compose up -d
