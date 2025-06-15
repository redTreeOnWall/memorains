import {
  DocApplication,
  DocServerManager,
  UserServer,
} from "../interface/Interface";
import { log } from "../utils/utils";
import { DocServerManagerImp } from "./DocServerManagerImp";
import { UserServerImp } from "./UserServerImp";

export class DocApplicationImp implements DocApplication {
  docServerManager: DocServerManager = new DocServerManagerImp(this);

  userServer: UserServer = new UserServerImp(this);

  async init() {
    // TODO
    log("app start init");
    await this.userServer.init();
    await this.docServerManager.init();
    log("app initd!");
  }
}
