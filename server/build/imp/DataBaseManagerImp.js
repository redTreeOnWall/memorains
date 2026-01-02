"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataBaseManagerImp = void 0;
const mariadb_1 = __importDefault(require("mariadb"));
const consts_1 = require("../consts/consts");
const DataEntity_1 = require("../interface/DataEntity");
const utils_1 = require("../utils/utils");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// TODO Auto release connection.
class DataBaseManagerImp {
    constructor() {
        this.pool = null;
    }
    async getAutoCloseConnection(action) {
        let conn = null;
        try {
            conn = await this.getConnection();
            return await action(conn);
        }
        finally {
            conn?.end();
        }
    }
    async checkDataBase() {
        return await this.getAutoCloseConnection(async (conn) => {
            const tables = await conn.query(`SHOW TABLES`);
            // TODO check every table
            if (tables.length === 0) {
                console.log("no table found in database, creating tables");
                const sqlFilePath = path.join(process.cwd(), "DB/document.sql");
                const sql = await fs.promises.readFile(sqlFilePath, {
                    encoding: "utf8",
                });
                const statements = sql
                    .split(";")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0);
                // Execute each SQL statement
                for (const statement of statements) {
                    await conn.query(statement);
                    console.log(`Executed: ${statement.slice(0, 50)}...`);
                }
            }
            else {
                console.log("tables existed.");
            }
        });
    }
    async init(autoCreateTables, connectionLimit = 2, dataBaseInfo = {}) {
        // TODO inject data base info from init params
        const host = process.env.IS_DEV === "true" ? "127.0.0.1" : "reno_note_mariadb";
        this.pool = mariadb_1.default.createPool({
            host,
            user: "doc",
            password: "123456",
            connectionLimit,
            database: "document",
            dateStrings: true,
        });
        // TODO check status
        // TODO AUTO create and check data base
        if (autoCreateTables) {
            await this.checkDataBase();
        }
    }
    async getConnection() {
        if (!this.pool) {
            throw "no data base pool";
        }
        // FIXME Handle to many connections error
        return await this.pool.getConnection();
    }
    async getUserById(id) {
        return await this.getAutoCloseConnection(async (conn) => {
            try {
                const rows = await conn.query("select * from user where id = ? limit 1", [id]);
                return rows;
            }
            catch (e) {
                return [];
            }
        });
    }
    async updateUserWrongPasswordCount(userId, newCount) {
        return await this.getAutoCloseConnection(async (conn) => {
            try {
                const time = (0, utils_1.toMysqlDate)(new Date());
                await conn.query("update user set wrong_pass_word_count = ?, last_login_time = ? where id = ? ", [newCount, time, userId]);
            }
            catch (e) {
                console.error("Failed to update wrong_pass count!");
                return;
            }
        });
    }
    async addUser(user) {
        const conn = await this.getConnection();
        const res = await conn.query("INSERT INTO user (id, password, salt) VALUES (?, ?, ?)", [user.id, user.password, user.salt]);
        conn.end();
        if (res.affectedRows === 1) {
            return true;
        }
        else {
            return false;
        }
    }
    async getUpdateOfDocument(docId) {
        const conn = await this.getConnection();
        const rows = await conn.query("select * from document_update where doc_id = ?", [docId]);
        conn.end();
    }
    async createDocument(document) {
        try {
            const conn = await this.getConnection();
            // TODO use DAO
            const { id, title, user_id, create_date, last_modify_date, commit_id, doc_type, encrypt_salt, state, } = document;
            const res = await conn.query("INSERT INTO document (id, title, user_id, create_date, last_modify_date, commit_id, doc_type, encrypt_salt, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
                id,
                title,
                user_id,
                create_date,
                last_modify_date,
                commit_id,
                doc_type,
                encrypt_salt ?? null,
                state ? Buffer.from(state) : null,
            ]);
            conn.end();
            if (res.affectedRows === 1) {
                return true;
            }
            else {
                return false;
            }
        }
        catch (e) {
            console.error(e);
            return false;
        }
    }
    async getDocument(docId, readState = false, onlyPublic = false) {
        try {
            const conn = await this.getConnection();
            const res = await conn.query(`select id, title, create_date, last_modify_date, user_id, is_public, doc_type, encrypt_salt, commit_id ${readState ? ", state" : ""} from document where id=? ${onlyPublic ? "AND is_public > 0" : " "} limit 1`, [docId]);
            conn.end();
            if (res.length === 1) {
                const data = res[0];
                return data;
            }
            else {
                return null;
            }
        }
        catch (e) {
            console.error(e);
            return null;
        }
    }
    async updateStateOfDocument(docId, state, commitId = (0, utils_1.randomInt)()) {
        try {
            const buf = Buffer.from(state);
            const conn = await this.getConnection();
            const time = (0, utils_1.toMysqlDate)(new Date());
            await conn.query("update document set state = ?, commit_id = ?, last_modify_date = ? where id = ?", [buf, commitId, time, docId]);
            conn.end();
            return true;
        }
        catch (e) {
            console.error(e);
            return false;
        }
    }
    async getAllDoc(userId) {
        try {
            const conn = await this.getConnection();
            // TODO documents with privilege
            const sql = `
        SELECT
          d.id,
          d.title,
          d.user_id,
          d.create_date,
          d.last_modify_date,
          d.commit_id,
          d.doc_type,
          d.encrypt_salt,
          dp.privilege 
        FROM
          document d
        LEFT JOIN
          doc_privilege dp ON d.id = dp.doc_id
        WHERE
          d.user_id = ?
          OR dp.user_id = ?
        ORDER BY
          d.create_date DESC
        LIMIT 100;
       `;
            const rows = await conn.query(sql, [userId, userId]);
            conn.end();
            return rows;
        }
        catch (e) {
            console.error(e);
            return null;
        }
    }
    async deleteDoc(id, userId) {
        // TODO use update
        try {
            return await this.getAutoCloseConnection(async (conn) => {
                const res = await conn.query("delete from document where id = ? and user_id = ?", [id, userId]);
                return res.affectedRows > 0;
            });
        }
        catch (e) {
            return false;
        }
    }
    async updateNameOfDocument(docId, newName, userId) {
        try {
            return await this.getAutoCloseConnection(async (conn) => {
                const time = (0, utils_1.toMysqlDate)(new Date());
                await conn.query("update document set title = ?, last_modify_date = ? where id = ? and user_id = ?", [newName, time, docId, userId]);
                return true;
            });
        }
        catch (e) {
            return false;
        }
    }
    async getPrivilegeListOfDoc(docId) {
        return this.getAutoCloseConnection(async (conn) => {
            try {
                const sql = `select doc_id, user_id, group_id, private from doc_privilege where doc_id = ? limit ${consts_1.maxPrivilegeCount}`;
                const res = (await conn.query(sql, [docId]));
                return res;
            }
            catch (e) {
                console.error(e);
                return [];
            }
        });
    }
    async getMaxPrivilege(docId, condition) {
        return this.getAutoCloseConnection(async (conn) => {
            const { userId, groupId } = condition;
            const conditions = [];
            const values = [docId];
            if (userId) {
                conditions.push("user_id = ?");
                values.push(userId);
            }
            if (groupId) {
                conditions.push("group_id_id = ?");
                values.push(groupId);
            }
            if (conditions.length === 0) {
                return DataEntity_1.PrivilegeEnum.none;
            }
            // TODO creator is also the owner
            // FIXME where group in select group where user_id = '{groupId}';
            const sql = `select privilege from doc_privilege where doc_id = ? and (${conditions[0]} ${conditions[1] ? " or " : ""} ${conditions[1] ?? ""}) limit ${consts_1.maxPrivilegeCount}`;
            try {
                const res = (await conn.query(sql, values));
                let maxPrivilege = 0;
                res.forEach((privilege) => {
                    if (privilege.privilege > maxPrivilege) {
                        maxPrivilege = privilege.privilege;
                    }
                });
                return maxPrivilege;
            }
            catch (e) {
                console.error(e);
                return null;
            }
        });
    }
    async updatePrivilegeForDoc(docId, userOrGroupId, idType, privilege) {
        return await this.getAutoCloseConnection(async (conn) => {
            try {
                const querySql = [
                    `select privilege from doc_privilege where doc_id = ? and user_id = ?  limit 1 for update`,
                    [docId, userOrGroupId],
                ];
                const updateSql = [
                    `update doc_privilege set privilege = ? where doc_id = ? and user_id = ?`,
                    [privilege, docId, userOrGroupId],
                ];
                const addSql = [
                    `insert into doc_privilege (doc_id, user_id, privilege) values (?, ?, ?)`,
                    [docId, userOrGroupId, privilege],
                ];
                await conn.beginTransaction();
                try {
                    const queryRes = (await conn.query(querySql[0], querySql[1]));
                    if (queryRes.length === undefined) {
                        throw "error";
                    }
                    if (queryRes.length > 0) {
                        await conn.query(updateSql[0], updateSql[1]);
                    }
                    else {
                        await conn.query(addSql[0], addSql[1]);
                    }
                    await conn.commit();
                    return true;
                }
                catch (e) {
                    console.error(e);
                    await conn.rollback();
                    return false;
                }
            }
            catch (e) {
                console.error(e);
                return false;
            }
        });
    }
    async updateDocPublic(docId, isPublic) {
        return this.getAutoCloseConnection(async (conn) => {
            try {
                const sql = `update document set is_public = ? where id = ?`;
                await conn.query(sql, [isPublic, docId]);
                return true;
            }
            catch (e) {
                return false;
            }
        });
    }
}
exports.DataBaseManagerImp = DataBaseManagerImp;
