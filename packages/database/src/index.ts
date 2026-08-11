import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export interface Database {
  pool: Pool;
  db: NodePgDatabase<typeof schema>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });

  const db = drizzle(pool, { schema });
  return { pool, db };
}

export async function checkDatabase(pool: Database['pool']): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export { schema };
