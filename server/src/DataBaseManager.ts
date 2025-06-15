// TODO use postgre
import mariadb from "mariadb";
import { DocumentEntity } from "./interface/DataEntity";
export class DataBaseManager {
  private pool: mariadb.Pool | null = null;

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
    this.pool = mariadb.createPool({
      host: "localhost",
      user: "reno",
      password: "123456",
      connectionLimit: 10,
      database: "document",
    });

    await this.checkAndCreateTable();
  }

  async createDocument(document: DocumentEntity) {
    try {
      const conn = await this.getConnection();
      // TODO use DAO
      const { id, title, user_id, create_date, last_modify_date } = document;
      const res = await conn.query(
        "INSERT INTO document (id, title, user_id, create_date, last_modify_date) VALUES (?, ?, ?, ?, ?)",
        [id, title, user_id, create_date, last_modify_date]
      );
      conn.end();
      if (res.affectedRows === 1) {
        return true;
      } else {
        return false;
      }
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async getDocument(docId: string, readState = false) {
    try {
      const conn = await this.getConnection();
      const res = await conn.query(
        `select id, title, user_id ${
          readState ? ", state" : ""
        } from document where id=?`,
        [docId]
      );
      conn.end();
      if (res.length === 1) {
        const data = res[0];
        return data as DocumentEntity;
      } else {
        return null;
      }
    } catch (e) {
      console.error(e);

      return null;
    }
  }

  async updateStateOfDocument(docId: string, state: Uint8Array) {
    try {
      const buf = Buffer.from(state);
      const conn = await this.getConnection();
      await conn.query(
        "update document set state = ? where id = ?",
        [buf, docId]
      );
      conn.end();
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async getAllDoc(userId: string) {
    try {
      const conn = await this.getConnection();
      const rows = await conn.query(
        "select id from document where user_id = ?",
        [userId]
      );
      conn.end();
      return rows;
    } catch (e) {
      console.error(e);
    }
  }
}
