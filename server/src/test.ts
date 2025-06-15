import { DocApplicationImp } from "./imp/DocApplicationImp";
import { DocServerManagerImp } from "./imp/DocServerManagerImp";

const docServerManager = new DocServerManagerImp(new DocApplicationImp());

docServerManager.init();
