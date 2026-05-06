# build desktop
script_dir=`pwd`

cd $script_dir
rm -rf ../client/out/*

rm -rf ./out/*.deb
rm -rf ./out/*.zip

cd ../client
# linux
npm run desktop:make
# windows
npm run desktop:make:win
cd $script_dir
mv ../client/out/make/deb/x64/*.deb ./out/
mv ../client/out/make/zip/win32/x64/*.zip ./out/

# build android
cd $script_dir
rm -f ../client/built-apk/memorains-release.apk
rm -f ./out/memorains-release.apk
cd ../client
npm run mobile:sign:android
cd $script_dir
mv ../client/built-apk/memorains-release.apk ./out/

