# Memorains
Memorains is a note software built on web technologies, integrating rich text editing canvas drawing. It supports both online and offline use, as well as multi - user and multi - device collaboration, greatly enhancing content creation and collaboration efficiency.

This project included code of client and server. With the help of this project, you can build your own controllable note-taking system.

Here is the [online demo](https://note.lirunlong.com/doc/client/).

## Current features
- Two types of note:
    - Rich text editor(Based on [quill](https://github.com/slab/quill))
    - Infinite canvas (Based on [excalidraw](https://github.com/excalidraw/excalidraw)) 
- Conflict free (Based on [yjs](https://github.com/yjs/yjs))
- Multi-devices/users collaboration
- Both online & offline supported 
- Multiple platform client
    - Web browser
    - Desktop
        - Linux
        - Windows
        - Macos
    - Mobile devices
        - Android
        - IOS

## How to build and deploy
### Build and upload application package
Build client.
```
cd client
npm install
npm run build
```

Build package.
```
cd script
bash build_package.sh
```
A package named package.tar.gz will be built.

Uploading this file to your server.

### Prepare you SSL certificate
Create an folder named `certificate` in server's home path.
``` shell 
mkdir ~/certificate
```
Put your nginx SSL certificate into this folder.
```
# ls ~/certificate/
# cert.key  cert.pem
```

### Run application
Run the application use podman.
```
tar -zxvf package.tar.gz
cd  package
podman compose up -d
```
you can also run this use `docker compose`

### ~~Database~~
~~If you are running this application for first time, you need to init the database.
First, copy the sql file which is in the this git project path `/server/DB/document.sql` to the server.
Then, exec the sql file in the mariadb docker container:~~
```
# docker exec -i mariadb-db mariadb -u doc -p123455 document < ./document.sql
```
~~All the necessary tables will be created.~~

### Open in the browser
Open link in the browser: https://$your-host/doc/client/


## Others
### Third-party open source libraries
- [quill](https://github.com/slab/quill)
- [excalidraw](https://github.com/excalidraw/excalidraw)
- [material-ui](https://github.com/mui/material-ui)
- [yjs](https://github.com/yjs/yjs)
