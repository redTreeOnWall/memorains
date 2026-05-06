script_dir=`pwd`
cd $script_dir

rm -rf ./out
mkdir ./out

bash ./build_web_package.sh

cd $script_dir
bash ./build_client_package.sh
