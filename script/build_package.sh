script_dir=`pwd`

# cd $script_dir/package
# podman-compose down || echo "\n===down podman===\n"
# 
# podman network rm package_reno_note_app_network



cd $script_dir
cd ../client
npm run build
cd $script_dir
rm -rf ./package
rm -rf ./package.tar.gz
mkdir -p package/client
mkdir -p package/server
cp -r ../client/dist/* ./package/client/
cp -r ../server/src ./package/server/
cp -r ../server/build ./package/server/
cp -r ../server/DB ./package/server/
cp -r ../server/package.json ./package/server/
cp -r ../server/package-lock.json ./package/server/
cp -r ../server/tsconfig.json ./package/server/
cp -r ../server/README.md ./package/server/
cp -r ../server/.npmrc ./package/server/
cp -r ../docker-compose.yml ./package/
cp -r ../nginx.conf ./package/
cp -r ../mariadb-conf ./package/
tar -zcvf package.tar.gz ./package
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
