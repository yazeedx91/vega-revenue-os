import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';

export interface MigrationClient {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

export async function applyMigration(client: MigrationClient, filename: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
    }
    throw error;
  }
}

export async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = readdirSync(resolve(__dirname))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (existing.rowCount && existing.rowCount > 0) {
        console.log(`Skipping ${file}`);
        continue;
      }

      const sql = readFileSync(resolve(__dirname, file), 'utf-8');
      await applyMigration(client, file, sql);
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Migration failed', err);
    process.exit(1);
  });
}
