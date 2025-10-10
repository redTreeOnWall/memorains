import mariadb from "mariadb";
import { maxPrivilegeCount } from "../consts/consts";
import {
  DocPrivilegeEntity,
  DocumentEntity,
  DocumentPublic,
  PrivilegeEnum,
  UserEntity,
} from "../interface/DataEntity";
import { DataBaseManager } from "../interface/Interface";
import { randomInt, toMysqlDate } from "../utils/utils";
import * as fs from "fs";
import * as path from "path";

// TODO Auto release connection.

export class DataBaseManagerImp implements DataBaseManager {
  private pool: mariadb.Pool | null = null;

  private async getAutoCloseConnection<T = void>(
    action: (conn: mariadb.PoolConnection) => Promise<T>
  ) {
    let conn: mariadb.PoolConnection | null = null;
    try {
      conn = await this.getConnection();
      return await action(conn);
    } finally {
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
      } else {
        console.log("tables existed.");
      }
    });
  }

  async init(
    autoCreateTables?: boolean,
    connectionLimit = 2,
    dataBaseInfo = {}
  ) {
    // TODO inject data base info from init params
    const host =
      process.env.IS_DEV === "true" ? "127.0.0.1" : "reno_note_mariadb";
    this.pool = mariadb.createPool({
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

  private async getConnection() {
    if (!this.pool) {
      throw "no data base pool";
    }

    // FIXME Handle to many connections error
    return await this.pool.getConnection();
  }

  async getUserById(id: string) {
    return await this.getAutoCloseConnection(async (conn) => {
      try {
        const rows = await conn.query(
          "select * from user where id = ? limit 1",
          [id]
        );
        return rows as UserEntity[];
      } catch (e) {
        return [];
      }
    });
  }

  async updateUserWrongPasswordCount(userId: string, newCount: number) {
    return await this.getAutoCloseConnection(async (conn) => {
      try {
        const time = toMysqlDate(new Date());
        await conn.query(
          "update user set wrong_pass_word_count = ?, last_login_time = ? where id = ? ",
          [newCount, time, userId]
        );
      } catch (e) {
        console.error("Failed to update wrong_pass count!");
        return;
      }
    });
  }

  async addUser(user: UserEntity) {
    const conn = await this.getConnection();
    const res = await conn.query(
      "INSERT INTO user (id, password, salt) VALUES (?, ?, ?)",
      [user.id, user.password, user.salt]
    );
    conn.end();

    if (res.affectedRows === 1) {
      return true;
    } else {
      return false;
    }
  }

  async getUpdateOfDocument(docId: string) {
    const conn = await this.getConnection();
    const rows = await conn.query(
      "select * from document_update where doc_id = ?",
      [docId]
    );
    conn.end();
  }

  async createDocument(document: DocumentEntity) {
    try {
      const conn = await this.getConnection();
      // TODO use DAO
      const {
        id,
        title,
        user_id,
        create_date,
        last_modify_date,
        commit_id,
        doc_type,
        encrypt_salt,
        state,
      } = document;
      const res = await conn.query(
        "INSERT INTO document (id, title, user_id, create_date, last_modify_date, commit_id, doc_type, encrypt_salt, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          id,
          title,
          user_id,
          create_date,
          last_modify_date,
          commit_id,
          doc_type,
          encrypt_salt ?? null,
          state ? Buffer.from(state) : null,
        ]
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

  async getDocument(docId: string, readState = false, onlyPublic = false) {
    try {
      const conn = await this.getConnection();
      const res = await conn.query(
        `select id, title, create_date, last_modify_date, user_id, is_public, doc_type, encrypt_salt, commit_id ${
          readState ? ", state" : ""
        } from document where id=? ${onlyPublic ? "AND is_public > 0" : " "} limit 1`,
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

  async updateStateOfDocument(
    docId: string,
    state: Uint8Array,
    commitId: number = randomInt()
  ) {
    try {
      const buf = Buffer.from(state);
      const conn = await this.getConnection();
      await conn.query(
        "update document set state = ?, commit_id = ? where id = ?",
        [buf, commitId, docId]
      );
      conn.end();
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async getAllDoc(userId: string) {
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
      return rows as (DocumentEntity & { privilege: PrivilegeEnum })[];
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  async deleteDoc(id: string, userId: string) {
    // TODO use update
    try {
      return await this.getAutoCloseConnection(async (conn) => {
        const res = await conn.query(
          "delete from document where id = ? and user_id = ?",
          [id, userId]
        );
        return res.affectedRows > 0;
      });
    } catch (e) {
      return false;
    }
  }

  async updateNameOfDocument(docId: string, newName: string, userId: string) {
    try {
      return await this.getAutoCloseConnection(async (conn) => {
        await conn.query(
          "update document set title = ? where id = ? and user_id = ?",
          [newName, docId, userId]
        );
        return true;
      });
    } catch (e) {
      return false;
    }
  }

  async getPrivilegeListOfDoc(docId: string) {
    return this.getAutoCloseConnection(async (conn) => {
      try {
        const sql = `select doc_id, user_id, group_id, private from doc_privilege where doc_id = ? limit ${maxPrivilegeCount}`;

        const res = (await conn.query(sql, [docId])) as DocPrivilegeEntity[];
        return res;
      } catch (e) {
        console.error(e);
        return [];
      }
    });
  }

  async getMaxPrivilege(
    docId: string,
    condition:
      | { userId: string; groupId: undefined }
      | { groupId: string; userId: undefined }
      | { userId: string; groupId: string }
  ) {
    return this.getAutoCloseConnection(async (conn) => {
      const { userId, groupId } = condition;
      const conditions: string[] = [];
      const values: string[] = [docId];
      if (userId) {
        conditions.push("user_id = ?");
        values.push(userId);
      }

      if (groupId) {
        conditions.push("group_id_id = ?");
        values.push(groupId);
      }

      if (conditions.length === 0) {
        return PrivilegeEnum.none;
      }

      // TODO creator is also the owner
      // FIXME where group in select group where user_id = '{groupId}';
      const sql = `select privilege from doc_privilege where doc_id = ? and (${
        conditions[0]
      } ${conditions[1] ? " or " : ""} ${
        conditions[1] ?? ""
      }) limit ${maxPrivilegeCount}`;

      try {
        const res = (await conn.query(sql, values)) as DocPrivilegeEntity[];
        let maxPrivilege = 0;
        res.forEach((privilege) => {
          if (privilege.privilege > maxPrivilege) {
            maxPrivilege = privilege.privilege;
          }
        });
        return maxPrivilege as PrivilegeEnum;
      } catch (e) {
        console.error(e);
        return null;
      }
    });
  }

  async updatePrivilegeForDoc(
    docId: string,
    userOrGroupId: string,
    idType: "user",
    privilege: PrivilegeEnum
  ) {
    return await this.getAutoCloseConnection(async (conn) => {
      try {
        const querySql = [
          `select privilege from doc_privilege where doc_id = ? and user_id = ?  limit 1 for update`,
          [docId, userOrGroupId],
        ] as const;

        const updateSql = [
          `update doc_privilege set privilege = ? where doc_id = ? and user_id = ?`,
          [privilege, docId, userOrGroupId],
        ] as const;

        const addSql = [
          `insert into doc_privilege (doc_id, user_id, privilege) values (?, ?, ?)`,
          [docId, userOrGroupId, privilege],
        ] as const;

        await conn.beginTransaction();

        try {
          const queryRes = (await conn.query(
            querySql[0],
            querySql[1]
          )) as DocPrivilegeEntity[];
          if (queryRes.length === undefined) {
            throw "error";
          }

          if (queryRes.length > 0) {
            await conn.query(updateSql[0], updateSql[1]);
          } else {
            await conn.query(addSql[0], addSql[1]);
          }
          await conn.commit();
          return true;
        } catch (e) {
          console.error(e);
          await conn.rollback();
          return false;
        }
      } catch (e) {
        console.error(e);
        return false;
      }
    });
  }

  async updateDocPublic(docId: string, isPublic: DocumentPublic) {
    return this.getAutoCloseConnection<boolean>(async (conn) => {
      try {
        const sql = `update document set is_public = ? where id = ?`;
        await conn.query(sql, [isPublic, docId])
        return true;
      } catch (e) {
        return false;
      }
    })
  }
}
