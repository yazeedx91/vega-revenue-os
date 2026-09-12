import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { Client } from 'pg';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { randomBytes } from 'crypto';

interface PgRole {
  rolname: string;
  rolcanlogin: boolean;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value === undefined && fallback === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? fallback!;
}

function requireApproval(): void {
  if (process.env.PRODUCTION_BOOTSTRAP_APPROVED !== 'true') {
    throw new Error('PRODUCTION_BOOTSTRAP_APPROVED must be set to "true"');
  }
}

function refuseLocalHost(host: string): void {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower === '127.0.0.1' || lower === '::1' || lower.startsWith('localhost:')) {
    throw new Error(`Refusing to bootstrap against a local target: ${host}`);
  }
}

function listMigrations(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function applyMigration(client: Client, filename: string, sql: string): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

function generatePassword(): string {
  return randomBytes(48).toString('base64url');
}

function quotePgLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildConnectionString(
  host: string,
  port: string,
  database: string,
  user: string,
  password: string,
): string {
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}?sslmode=require`;
}

async function main(): Promise<void> {
  requireApproval();

  const migrationsDir = process.env.MIGRATIONS_DIR ?? '/migrations';
  const pgHost = env('PGHOST');
  const pgPort = env('PGPORT', '5432');
  const pgAdminUser = env('PGADMINUSER');
  const pgAdminPassword = env('PGADMINPASSWORD');
  const pgDatabase = env('PGDATABASE', 'projectx');
  const keyVaultUrl = env('AZURE_KEY_VAULT_URL');
  const migrationClientId = env('AZURE_CLIENT_ID');

  refuseLocalHost(pgHost);

  const adminClient = new Client({
    host: pgHost,
    port: Number(pgPort),
    user: pgAdminUser,
    password: pgAdminPassword,
    database: pgDatabase,
    ssl: true,
  });
  await adminClient.connect();

  try {
    await ensureMigrationsTable(adminClient);
    const files = listMigrations(migrationsDir);

    for (const file of files) {
      const existing = await adminClient.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
      if (existing.rowCount && existing.rowCount > 0) {
        console.log(JSON.stringify({ level: 'info', code: 'MIGRATION_SKIPPED', file }));
        continue;
      }

      const sql = readFileSync(resolve(migrationsDir, file), 'utf-8');
      await applyMigration(adminClient, file, sql);
      console.log(JSON.stringify({ level: 'info', code: 'MIGRATION_APPLIED', file }));
    }

    const applied = await adminClient.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY filename');
    const appliedSet = new Set(applied.rows.map((r) => r.filename));
    const missing = files.filter((f) => !appliedSet.has(f));
    if (missing.length > 0) {
      throw new Error(`Migrations not recorded: ${missing.join(', ')}`);
    }
    if (applied.rows.length !== files.length) {
      throw new Error(`schema_migrations count mismatch: expected ${files.length}, got ${applied.rows.length}`);
    }

    const roleResult = await adminClient.query<PgRole>(
      `SELECT rolname, rolcanlogin, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication
       FROM pg_roles WHERE rolname = 'projectx_app'`,
    );
    if (roleResult.rowCount === 0) {
      throw new Error('Role projectx_app does not exist');
    }

    const role = roleResult.rows[0];
    if (!role.rolcanlogin) throw new Error('projectx_app must have LOGIN');
    if (role.rolsuper) throw new Error('projectx_app must be NOSUPERUSER');
    if (role.rolbypassrls) throw new Error('projectx_app must be NOBYPASSRLS');
    if (role.rolcreatedb) throw new Error('projectx_app must be NOCREATEDB');
    if (role.rolcreaterole) throw new Error('projectx_app must be NOCREATEROLE');
    if (role.rolreplication) throw new Error('projectx_app must be NOREPLICATION');

    const appPassword = generatePassword();
    await adminClient.query(`ALTER ROLE projectx_app WITH LOGIN PASSWORD ${quotePgLiteral(appPassword)}`);

    const databaseUrl = buildConnectionString(pgHost, pgPort, pgDatabase, 'projectx_app', appPassword);

    const credential = new DefaultAzureCredential({ managedIdentityClientId: migrationClientId });
    const secretClient = new SecretClient(keyVaultUrl, credential);
    await secretClient.setSecret('database-url', databaseUrl);

    console.log(
      JSON.stringify({
        level: 'info',
        code: 'BOOTSTRAP_COMPLETE',
        migrations: files.length,
        secret: 'database-url',
      }),
    );
  } finally {
    await adminClient.end();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ level: 'error', code: 'BOOTSTRAP_FAILED', error: err instanceof Error ? err.message : 'unknown' }));
  process.exit(1);
});
