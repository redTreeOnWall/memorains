"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserServerImp = exports.getJwtMiddleware = void 0;
const express_1 = __importDefault(require("express"));
const utils_1 = require("../utils/utils");
const DataBaseManagerImp_1 = require("./DataBaseManagerImp");
const cors_1 = __importDefault(require("cors"));
const jwtUtils_1 = require("../utils/jwtUtils");
const DataEntity_1 = require("../interface/DataEntity");
const moment_1 = __importDefault(require("moment"));
const js_base64_1 = require("js-base64");
const checkUserIdAndPassword = (userName, password) => typeof userName !== "string" ||
    typeof password !== "string" ||
    userName.length >= 128 ||
    userName.length <= 1 ||
    password.length >= 128 ||
    password.length <= 5;
class UserError extends Error {
    constructor(code = "500", message = "Error") {
        super(message);
        this.code = code;
    }
}
const handleError = (error, req, res) => {
    res.status(Number.parseInt(error.code));
    res.json({ code: error.code, errorMes: error.message });
};
const getJwtMiddleware = (excludePathList = []) => {
    const excludePathSet = new Set(excludePathList);
    const jwtMiddleware = async (req, res, next) => {
        const path = req.path;
        if (!path) {
            res.status(404);
            res.end();
            return;
        }
        const needVerifyToken = !excludePathSet.has(path);
        const auth = req.headers["authorization"];
        if (typeof auth !== "string") {
            if (needVerifyToken) {
                handleError(new UserError("401"), req, res);
                return;
            }
            else {
                next();
                return;
            }
        }
        try {
            const token = await (0, jwtUtils_1.asyncVerify)(auth);
            req.token = token;
        }
        catch (e) {
            if (needVerifyToken) {
                handleError(new UserError("401"), req, res);
                return;
            }
            else {
                req.token = undefined;
                return;
            }
        }
        next();
    };
    return jwtMiddleware;
};
exports.getJwtMiddleware = getJwtMiddleware;
class UserServerImp {
    constructor(app) {
        this.app = app;
        this.database = new DataBaseManagerImp_1.DataBaseManagerImp();
    }
    async init() {
        // TODO
        await this.database.init(true, 10);
        await this.createHttpServer();
    }
    async createHttpServer() {
        return new Promise((resolve) => {
            const httpServer = (0, express_1.default)();
            const port = 8000;
            // TODO
            const errorMes = { success: false };
            const successMes = { success: true };
            const signUpPath = "/doc/server/sign-up";
            const signInPath = "/doc/server/sign-in";
            const docInfoPath = "/doc/server/getPublicDoc";
            // TODO add midway to check token
            // FIXME only in dev
            httpServer.use((0, cors_1.default)());
            httpServer.use(express_1.default.json());
            httpServer.use((0, exports.getJwtMiddleware)([signUpPath, signInPath, docInfoPath]));
            httpServer.get("/doc/server/hello", (_, res) => {
                res.send("Hello World!");
            });
            httpServer.post(signUpPath, async (req, res) => {
                // TODO Use e-mail or phone number to verify
                // TODO Invite code
                const body = req.body;
                if (!body) {
                    res.send(errorMes);
                    return;
                }
                const { userName, password } = req.body;
                if (checkUserIdAndPassword(userName, password)) {
                    res.send(errorMes);
                    return;
                }
                if (userName === undefined || password === undefined) {
                    return;
                }
                const existUser = await this.database.getUserById(userName);
                if (existUser.length > 0) {
                    res.send({ ...errorMes, errorMes: "User id existed" });
                    return;
                }
                const salt = (0, utils_1.genRandomString)();
                const passHash = (0, utils_1.getSaltedPassword)(password, salt);
                const success = await this.database.addUser({
                    id: userName,
                    password: passHash,
                    salt,
                    wrong_pass_word_count: 0,
                    last_login_time: (0, utils_1.toMysqlDate)(new Date()),
                });
                if (success) {
                    (0, utils_1.log)(`New user ${userName}`);
                    res.send(successMes);
                }
                else {
                    res.send(errorMes);
                }
            });
            const signingInUsers = new Set();
            httpServer.post(signInPath, async (req, res) => {
                const body = req.body;
                if (!body) {
                    res.send(errorMes);
                    return;
                }
                const { userName, password } = req.body;
                if (checkUserIdAndPassword(userName, password)) {
                    res.send(errorMes);
                    return;
                }
                if (userName === undefined || password === undefined) {
                    res.send(errorMes);
                    return;
                }
                if (signingInUsers.has(userName)) {
                    res.send({ ...errorMes, errorMessage: "Too frequency!!" });
                    return;
                }
                signingInUsers.add(userName);
                try {
                    const existUser = (await this.database.getUserById(userName))[0];
                    if (!existUser) {
                        signingInUsers.delete(userName);
                        res.send(errorMes);
                        return;
                    }
                    const waitMinutes = 10;
                    const unLockTime = (0, moment_1.default)(existUser.last_login_time).valueOf() +
                        waitMinutes * 60 * 1000;
                    const lastLoginInShortTime = Date.now() < unLockTime;
                    if (existUser.wrong_pass_word_count >= 5 && lastLoginInShortTime) {
                        signingInUsers.delete(userName);
                        res.send({
                            ...errorMes,
                            errorMessage: `Your account have been locked because of failed to sign in more than 5 times. You can try again after ${Math.ceil((unLockTime - Date.now()) / (1000 * 60))} minutes.`,
                        });
                        return;
                    }
                    const salt = existUser.salt;
                    const passHash = (0, utils_1.getSaltedPassword)(password, salt);
                    const passwordCorrect = passHash === existUser.password;
                    if (passwordCorrect) {
                        const payload = {
                            userId: userName,
                            lastLoginTime: Date.now(),
                            expiresIn: 7 * 24 * 60 * 60,
                        };
                        const authorization = await (0, jwtUtils_1.asyncSign)(payload, payload.expiresIn);
                        const mes = {
                            success: true,
                            data: {
                                authorization,
                            },
                        };
                        res.send(mes);
                        await this.database.updateUserWrongPasswordCount(userName, 0);
                        (0, utils_1.log)(`user ${userName} success to sign in.`);
                    }
                    else {
                        await this.database.updateUserWrongPasswordCount(userName, 
                        // Clear wrong_pass_word_count if wait for while to login
                        lastLoginInShortTime ? existUser.wrong_pass_word_count + 1 : 1);
                        (0, utils_1.log)(`user ${userName} failed to sign in.`);
                        res.send(errorMes);
                    }
                }
                catch (e) {
                    res.send(errorMes);
                }
                signingInUsers.delete(userName);
            });
            httpServer.post("/doc/server/create-doc", async (req, res) => {
                const userId = req.token?.userId;
                if (!userId) {
                    res.end();
                    return;
                }
                const newDoc = req.body?.newDoc;
                const doc_type = req.body?.docType ?? 0;
                const state = newDoc?.state
                    ? js_base64_1.Base64.toUint8Array(newDoc.state).buffer
                    : null;
                const createTime = (0, utils_1.toMysqlDate)(new Date());
                const id = (0, utils_1.uuid)();
                const doc = {
                    ...newDoc,
                    id,
                    title: newDoc?.title ?? `New Document ${createTime}`,
                    create_date: newDoc?.create_date ?? createTime,
                    last_modify_date: createTime,
                    user_id: userId,
                    state,
                    is_public: 0,
                    commit_id: (0, utils_1.randomInt)(),
                    doc_type,
                };
                const suc = await this.database.createDocument(doc);
                if (suc) {
                    const createSucMessage = {
                        success: true,
                        data: {
                            newDocId: id,
                        },
                    };
                    res.send(createSucMessage);
                }
                else {
                    res.send(errorMes);
                }
            });
            // ask to open doc
            httpServer.post("/doc/server/docRoomInfo", async (req, res) => {
                const docId = req.body?.docID;
                if (!docId) {
                    res.end();
                    return;
                }
                const userId = req.token?.userId;
                if (!userId) {
                    return;
                }
                const doc = await this.database.getDocument(docId, false);
                if (!doc) {
                    const mes = {
                        success: false,
                        errorMessage: "Can not find the document!",
                    };
                    res.status(404);
                    res.send(mes);
                    return;
                }
                // TODO Check doc's owner;
                let canOpenThisDoc = false;
                const isCreator = doc.user_id === userId;
                let errorStatus = 500;
                if (isCreator) {
                    canOpenThisDoc = true;
                }
                else {
                    const maxPrivilege = await this.database.getMaxPrivilege(docId, {
                        userId,
                        groupId: undefined,
                    });
                    if (maxPrivilege === null) {
                        errorStatus = 500;
                    }
                    if (maxPrivilege === DataEntity_1.PrivilegeEnum.none) {
                        errorStatus = 403;
                    }
                    canOpenThisDoc = true;
                }
                if (!canOpenThisDoc) {
                    const mes = {
                        success: false,
                        errorMessage: "You have no permission to open this document!",
                    };
                    res.status(errorStatus);
                    res.send(mes);
                    return;
                }
                if (doc.encrypt_salt) {
                    const response = {
                        success: true,
                        data: {
                            encrypted: true,
                            docInfo: doc,
                        },
                    };
                    res.send(response);
                    return;
                }
                // TODO for public document;
                const roomInfo = await this.app.docServerManager.requestOpenDoc(docId);
                if (roomInfo) {
                    const roomToken = await (0, jwtUtils_1.asyncSign)({
                        docId: doc.id,
                        userId,
                    }, 24 * 60 * 60);
                    const response = {
                        success: true,
                        data: {
                            encrypted: false,
                            roomInfo,
                            roomToken,
                        },
                    };
                    res.send(response);
                }
                else {
                    res.send(errorMes);
                }
            });
            httpServer.post("/doc/server/deleteDoc", async (req, res) => {
                const docId = req.body?.docID;
                const userId = req.token?.userId;
                if (!docId || !userId) {
                    res.end();
                    return;
                }
                const success = await this.database.deleteDoc(docId, userId);
                if (success) {
                    res.send(successMes);
                }
                else {
                    res.send(errorMes);
                }
            });
            httpServer.post("/doc/server/docList", async (req, res) => {
                const userId = req.token?.userId;
                if (userId) {
                    const data = await this.database.getAllDoc(userId);
                    if (data) {
                        const message = {
                            success: true,
                            data: {
                                docList: data,
                            },
                        };
                        res.send(message);
                    }
                    else {
                        res.send(errorMes);
                    }
                }
            });
            httpServer.post("/doc/server/updateDocName", async (req, res) => {
                const docId = req.body?.docID;
                const newName = req.body?.newName;
                const userId = req.token?.userId;
                if (!docId || !newName || !userId) {
                    res.end();
                    return;
                }
                const success = await this.database.updateNameOfDocument(docId, newName, userId);
                if (success) {
                    res.send(successMes);
                }
                else {
                    res.send(errorMes);
                }
            });
            httpServer.post("/doc/server/shareDoc", async (req, res) => {
                const userId = req.token?.userId;
                const { docID, userName, privilege } = req.body;
                const sendError = (description) => {
                    const error = {
                        success: false,
                        errorMessage: description,
                    };
                    res.send(error);
                };
                if (!(0, utils_1.isString)(docID) ||
                    !(0, utils_1.isString)(userName) ||
                    !(0, utils_1.isNumber)(privilege) ||
                    !(privilege in DataEntity_1.PrivilegeEnum)) {
                    sendError();
                    return;
                }
                if (userId === userName) {
                    sendError("You can not share to your self!");
                    return;
                }
                const userExist = (await this.database.getUserById(userName))?.length;
                if (!userExist) {
                    sendError("User is not existed!");
                    return;
                }
                const doc = await this.database.getDocument(docID, false);
                if (!doc) {
                    sendError("Document is not existed");
                    return;
                }
                // TODO use privilege data
                const isOwner = doc.user_id === userId;
                if (!isOwner) {
                    sendError("You are not the owner of the document!");
                    return;
                }
                const success = await this.database.updatePrivilegeForDoc(docID, userName, "user", privilege);
                if (!success) {
                    sendError();
                    return;
                }
                res.send(successMes);
            });
            // TODO
            // httpServer.post("/doc/server/privilegeListOfDoc", async (req, res) => {
            //   const userId = req.token.userId;
            //   const maxPrivilege = this.database.getMaxPrivilege(docId, condition);
            // });
            //
            const docData2Base64 = (docOrigin) => {
                const state = docOrigin.state === null
                    ? null
                    : js_base64_1.Base64.fromUint8Array(new Uint8Array(docOrigin.state));
                const doc = {
                    ...docOrigin,
                    state,
                };
                return doc;
            };
            httpServer.post("/doc/server/docInfo", async (req, res) => {
                const userId = req.token.userId;
                const { docID, needState } = req.body;
                if (!(0, utils_1.isString)(docID)) {
                    res.status(404);
                    res.end();
                    return;
                }
                const responseMes = {};
                const existDoc = await this.database.getDocument(docID, false);
                if (existDoc) {
                    let userCanReadDoc = false;
                    if (existDoc.user_id === userId ||
                        existDoc.is_public > DataEntity_1.DocumentPublic.private) {
                        userCanReadDoc = true;
                    }
                    else {
                        const maxPrivilege = await this.database.getMaxPrivilege(docID, {
                            userId,
                            groupId: undefined,
                        });
                        if (maxPrivilege !== null && maxPrivilege > DataEntity_1.PrivilegeEnum.none) {
                            userCanReadDoc = true;
                        }
                    }
                    if (userCanReadDoc) {
                        const docOrigin = await this.database.getDocument(docID, !!needState);
                        if (docOrigin) {
                            const doc = docData2Base64(docOrigin);
                            responseMes.success = true;
                            responseMes.data = {
                                doc,
                            };
                        }
                    }
                }
                res.send(responseMes);
            });
            httpServer.post("/doc/server/getPublicDoc", async (req, res) => {
                const { docID, needState } = req.body;
                if (!(0, utils_1.isString)(docID)) {
                    res.status(404);
                    res.end();
                    return;
                }
                const responseMes = {};
                const docOrigin = await this.database.getDocument(docID, !!needState, true);
                if (docOrigin && docOrigin.is_public > DataEntity_1.DocumentPublic.private) {
                    const doc = docData2Base64(docOrigin);
                    responseMes.success = true;
                    responseMes.data = {
                        doc,
                    };
                }
                res.send(responseMes);
            });
            // Synchronize document
            httpServer.post("/doc/server/sync-doc", async (req, res) => {
                // query id
                // check user , create a copy of doc if different users (generate new doc id);
                // merge data
                // response merged data
                const userId = req.token?.userId;
                if (!userId) {
                    res.end();
                    return;
                }
                const data = req.body;
                // TODO check data
            });
            httpServer.post("/doc/server/updateDocState", async (req, res) => {
                const userId = req.token?.userId;
                const data = req.body;
                if (!userId || !data?.docId || typeof data.stateBase64 !== "string") {
                    res.status(500);
                    res.end();
                    return;
                }
                const { docId, stateBase64 } = data;
                const existDoc = await this.database.getDocument(docId);
                if (!existDoc || existDoc.user_id !== userId) {
                    // TODO check privilege
                    res.status(404);
                    res.end();
                    return;
                }
                const binary = js_base64_1.Base64.toUint8Array(stateBase64);
                const success = await this.database.updateStateOfDocument(docId, binary);
                const response = { success };
                res.send(response);
            });
            // TODO update other properties
            httpServer.listen(port, () => {
                (0, utils_1.log)(`Http server listening on port ${port}`);
                resolve(true);
            });
            httpServer.on("error", () => {
                throw new Error("Http server error");
            });
        });
    }
    async logIn(userId) {
        // TODO
        return false;
    }
    async checkUserAuth(jwt) {
        // TODO
        return false;
    }
    async addDoc() {
        // TODO
        return "";
    }
    async openDoc(docId) {
        // TODO
        return null;
    }
}
exports.UserServerImp = UserServerImp;
