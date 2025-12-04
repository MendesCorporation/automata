import pg from 'pg';
import { config } from '../config/index.js';

const { Pool } = pg;

export class DatabaseClient {
  private pool: pg.Pool;

  constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
    });
  }

  async query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
    const client = await this.pool.connect();
    try {
      return await client.query<T>(text, params);
    } finally {
      client.release();
    }
  }

  async getClient(): Promise<pg.PoolClient> {
    return await this.pool.connect();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export const db = new DatabaseClient();
