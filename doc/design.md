### TODO
* [x] Simple local demo
* [x] Simple local and server demo
* [x] User and doc management
* [x] Store in the remote DB
* [x] Store in the local DB
* [x] Merge local and remote
  * [ ] ~~Copy local document to remote when the network available.~~
  * [x] Merge data of remote and local
  * [ ] ~~Use hash of state or **commit id of last modify**?~~
* [x] Use docker to start server dev instance
  * [x] DB
  * [x] Use one npm command to start docker
* [x] docker package
* [ ] check and create the database in docker automatically.
* [ ] ~~Store image pictures in the database~~
  * [ ] indexedDB 
    * Create a new store to save pictures' data
    * Each picture have an uuid (or hash)
    * A picture will be linked to a document
    * When picture was deleted, all pictures link to the doc should deleted.
  * [ ] ~~MariaDB~~
    * [ ] New table to store pictures
* [x] multiple-process architecture
* [ ] UI details
  * [ ] User info Menu
    * [ ] Change password
    * [ ] Change Avatar
  * [x] Cooperators list
  * [x] Cursor of cooperators
* [x] Doc owner checking when open docs and edit docs
  * [x] check in user server (http)
  * [x] check in doc server (websocket)
* [ ] Share to other user
  * [x] Editor
  * [ ] View 
  * [ ] Show privilege and in the document list
* [ ] Share to group
* [ ] Ask privilege
* [ ] Public Document (Edit/ View)
  * [ ] Public doc that can be view by no login users
  * [ ] User info and document list page
* [ ] User Group
* [ ] invite code
* [ ] Server status visible dashboard
* [ ] token
  * [x] Access token
  * [ ] Auth token
* [ ] document GC
* [ ] Remove Or implement interface
* [ ] Package and version (big package + small update)
* [ ] wechat integration
* [ ] Sign up by phone number or email
* [ ] client
  * [ ] IOS client
  * [ ] Android Client
  * [ ] Electron client
* [ ] protocol buffer
* [ ] ~~java or c++ implement in server~~ (Nodejs is fine)
* [ ] client refactor to multiple modules
* [ ] Whiteboard support
  * [ ] ~~tldraw integration~~
  * [ ] Excalidraw integration
  * [ ] Multiple pages
* [ ] Automatically checking for http params

# Bugs To Fix
* [x] Navigate to login page when JWT is lost or expired
* [ ] CSS not work in the safari browser
* [ ] Refresh when disconnected
    * [x] Need to reconnect or show a refreshing button after disconnected.
    * [ ] Auto refreshing
* [ ] User disconnected, but he/she still in the room in the server (check user status use ping message)
* [ ] canvas cooperators can not delete object
* [ ] canvas can not draw long path when cooperating
* [ ] cursor of the quill editor

# Thing to do before open to public 
* [-] Special host name and disclaimer.
* [ ] TODO list or calender demo.
* [ ] 

### Flow
``` plantuml

actor u as "User"
participant c as "Client"
participant http as "User Server"
participant ws as "Doc Server"
database db as "Data Base"

== Log In ==
u -> http: log in 
http -> http: check users id and password
http -> u: send JWT (access token) to user
u -> u: store JWT in local

=== create document ===
u -> c: new document
c -> http: check token log in
c -> http: create
http -> db: new doc
http -> c: success

=== open document ===
u -> c: open document
c -> http: ask opening a doc
http -> http: checking the user's authority 
http -> http: find the best doc server
http -> c: response the host of the doc server
c -> ws: connect to doc server by websocket 
ws -> db: load document state. TODO: split DB  
ws -> ws: create document room
ws -> c: doc ready fot cooperating
ws -> c: send doc state data

=== update document ===
u -> c: edit
c -> c: update doc in client
c -> ws: send update content
ws -> ws: update doc in server
ws -> db: save update data after 30 second

```
---
### Architecture
``` plantuml
actor ua as "user A"
actor ub as "user B"
node ng as "nginx"
node us as "user server"
database db as "database" {
  file document
  file users
}

rectangle dss as "doc server cluster" {
  node "doc server instance 1" {
    rectangle ds1 as "doc room 1"
    rectangle ds2 as "doc room 2"
    rectangle "more rooms ...."
  }

  node "doc server instance 2" {
    rectangle "doc room 11"
    rectangle "doc room 22"
    rectangle "more rooms ....."
  }

  note top of "doc server instance 1"
    Each instance is a process, the  number of the instance
    is "core number of CPU" * 2.

    There will be manay rooms in each doc server instance,
    When the instance is filled with room, the instance 
    alert and block new rooms to be created.

    The doc server instance will synchronize status of self
    to the main/user server (rooms number, user number, data
    updating FPS...)
  endnote
}

ua -- ng
ub -- ng

ng -- us: https
ng -- dss: websocket

us --- dss: main-child processes pipe

us -- db
dss -- db

```

### Server Interface

``` plantuml
interface DocApplication {
  docServerManager: DocServerManager;

  userServer: UserServer;
}

interface DataBaseManager {
  exec: (sql: string) => Promise<void>;
}

interface DocRoomInfo {
  host: string;
}

interface UserServer {
  app: DocApplication;

  database: DataBaseManager;

  logIn: (userId: string) => Promise<boolean>;

  checkUserAuth: (jwt: string) => Promise<boolean>;

  /**
   * @returns doc id
   */
  addDoc: () => Promise<string>;

  /**
   * @returns return RooInfo when open success, or null when no permission
   */
  openDoc: (docId: string) => Promise<DocRoomInfo | null>;
}

interface DocServerManager {
  app: DocApplication;

  /**
   * Map<serverId, server status>
   */
  serverMap: Map<string, DocServerStatus>;

  getBestDocServerByDocId: (docId: string) => Promise<DocRoomInfo | null>;
}

interface DocServerStatus {
  id: string;

  host: string;

  port: string;

  rooms: DocRoomInfo[];
}

interface DocServer {
  id: string;

  host: string;

  port: string;

  database: DataBaseManager;

  ws: WebSocketServer;

  rooms: Map<string, DocRoom>;
}

interface DocRoom {
  users: Set<OnlineUser>;

  server: DocServer;

  userIn: (newUser: OnlineUser) => void;

  userLeave: (user: OnlineUser) => void;

  updateDoc: (data: Uint8Array) => void;

  close: () => Promise<void>;
  saveDoc: () => Promise<void>;
}

interface OnlineUser {
  userId: string;

  sendMessage: () => void;

  onMessage: (message: string) => void;

  close: () => Promise<void>;
}

DocApplication ..> UserServer
DocApplication ..> DocServerManager

DocServerManager *.. DocServerStatus
DocServerStatus .. DocServer

note right of DocServer
DocServer will synchronize status to 
DocServerManager use message bus

endnote

DocServer *.. DocRoom
DocRoom *.. OnlineUser

UserServer ..> DataBaseManager
DocServer ..> DataBaseManager

```


### JWT Token Flow
``` plantuml

|client|
start
: user log in;
|user server|
: generate the **Auth Token** and send to client;
|client|
: save the **Auth Token** in the local storage;
: request the **Access Token** by **Auth Token**;
|user server|
if (**Auth Token** expired) then (yes)
  : 401 error;
  stop
endif
: generate **Access Token**;
|client|
: save the **Access Token** in memory;
: open document by **Access Token**;
|doc server|
: check the access token;
if (token expired?) then (yes)
  : 403 error;
  stop
endif
: start document room instance;
: start websocket server;
|client|
: show document content;
stop

```


```
mysqldump --no-data --skip-comments -u reno -p document > document.sql

ps -ef | grep "node build" | grep -v grep | awk '{print $2}' | xargs kill -9

```


## encryption design
- One secret or many?
    - Use the global secret
    - Each document have a secret
- Secret in server?
    - ~~Will save in server's memory when editing doc~~
    - E2EE
- Secret save in local?
    - User can decide, if saved, user need not to input before editing

### Steps
- [x] Create document from a dialog window, user can chose the encryption type of document
- [x] The encrypted document will encrypted and only be save in local (firstly)
- [x] Before the encrypted document editing, ask input secret if secret did not saved
- [x] Save the document to remote manually, add a [sync to remote] button in the document page
- [ ] Solve the conflict between the local and server when save the doc to server
- [ ] user friendly UI and help.
- [ ] ask save password every time input it
