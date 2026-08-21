import { DatabaseSync } from 'node:sqlite';

class Database {
  private db: DatabaseSync;
  constructor(path: string) { this.db = new DatabaseSync(path); }
  static async load(url: string) { return new Database(process.env.VERIFY_DB!); }
  async execute(sql: string, params: unknown[] = []) {
    const st = this.db.prepare(sql);
    const r = st.run(...(params as never[]));
    return { rowsAffected: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
  }
  async select(sql: string, params: unknown[] = []) {
    return this.db.prepare(sql).all(...(params as never[]));
  }
  async close() { this.db.close(); return true; }
}
export default Database;
