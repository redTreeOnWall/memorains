"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataBaseManager = void 0;
// TODO use postgre
const mariadb_1 = __importDefault(require("mariadb"));
class DataBaseManager {
    constructor() {
        this.pool = null;
    }
    async getConnection() {
        if (!this.pool) {
            throw "no data base pool";
        }
        return await this.pool.getConnection();
    }
    async checkAndCreateTable() {
        // const conn = this.getPool().getConnection()
    }
    async init() {
        this.pool = mariadb_1.default.createPool({
            host: "localhost",
            user: "reno",
            password: "123456",
            connectionLimit: 10,
            database: "document",
        });
        await this.checkAndCreateTable();
    }
    async createDocument(document) {
        try {
            const conn = await this.getConnection();
            // TODO use DAO
            const { id, title, user_id, create_date, last_modify_date } = document;
            const res = await conn.query("INSERT INTO document (id, title, user_id, create_date, last_modify_date) VALUES (?, ?, ?, ?, ?)", [id, title, user_id, create_date, last_modify_date]);
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
    async getDocument(docId, readState = false) {
        try {
            const conn = await this.getConnection();
            const res = await conn.query(`select id, title, user_id ${readState ? ", state" : ""} from document where id=?`, [docId]);
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
    async updateStateOfDocument(docId, state) {
        try {
            const buf = Buffer.from(state);
            const conn = await this.getConnection();
            await conn.query("update document set state = ? where id = ?", [buf, docId]);
            conn.end();
        }
        catch (e) {
            console.error(e);
            return null;
        }
    }
    async getAllDoc(userId) {
        try {
            const conn = await this.getConnection();
            const rows = await conn.query("select id from document where user_id = ?", [userId]);
            conn.end();
            return rows;
        }
        catch (e) {
            console.error(e);
        }
    }
}
exports.DataBaseManager = DataBaseManager;
