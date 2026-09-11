import { applyMigration, type MigrationClient } from '../../../../infra/database/migrations/run';

class FakeClient implements MigrationClient {
  readonly calls: Array<{ sql: string; params?: unknown[] }> = [];
  schema = new Set<string>();
  migrations = new Set<string>();
  failMigration = false;
  failBookkeeping = false;
  failRollback = false;
  private pendingSchema = new Set<string>();
  private pendingMigrations = new Set<string>();

  async query(sql: string, params?: unknown[]): Promise<{ rowCount: number }> {
    this.calls.push({ sql, params });
    if (sql === 'BEGIN') {
      this.pendingSchema = new Set(this.schema);
      this.pendingMigrations = new Set(this.migrations);
    } else if (sql === 'COMMIT') {
      this.schema = this.pendingSchema;
      this.migrations = this.pendingMigrations;
    } else if (sql === 'ROLLBACK') {
      if (this.failRollback) throw new Error('rollback failed');
    } else if (sql.startsWith('INSERT INTO schema_migrations')) {
      if (this.failBookkeeping) throw new Error('bookkeeping failed');
      this.pendingMigrations.add(params![0] as string);
    } else {
      if (this.failMigration) throw new Error('migration failed');
      if (this.pendingSchema.has(sql)) throw new Error('schema already applied');
      this.pendingSchema.add(sql);
    }
    return { rowCount: 1 };
  }
}

describe('atomic migration runner', () => {
  it('commits migration SQL and bookkeeping together on success', async () => {
    const client = new FakeClient();
    await applyMigration(client, '001.sql', 'CREATE TABLE test');
    expect(client.schema.has('CREATE TABLE test')).toBe(true);
    expect(client.migrations.has('001.sql')).toBe(true);
    expect(client.calls.map((call) => call.sql)).toEqual(['BEGIN', 'CREATE TABLE test', 'INSERT INTO schema_migrations (filename) VALUES ($1)', 'COMMIT']);
  });

  it('rolls back migration SQL failure and reruns cleanly', async () => {
    const client = new FakeClient();
    client.failMigration = true;
    await expect(applyMigration(client, '001.sql', 'CREATE TABLE test')).rejects.toThrow('migration failed');
    expect(client.schema.size).toBe(0);
    expect(client.migrations.size).toBe(0);
    client.failMigration = false;
    await expect(applyMigration(client, '001.sql', 'CREATE TABLE test')).resolves.toBeUndefined();
  });

  it('rolls back migration SQL when bookkeeping fails and reruns cleanly', async () => {
    const client = new FakeClient();
    client.failBookkeeping = true;
    await expect(applyMigration(client, '001.sql', 'CREATE TABLE test')).rejects.toThrow('bookkeeping failed');
    expect(client.schema.size).toBe(0);
    expect(client.migrations.size).toBe(0);
    client.failBookkeeping = false;
    await expect(applyMigration(client, '001.sql', 'CREATE TABLE test')).resolves.toBeUndefined();
  });

  it('preserves the original failure when rollback also fails', async () => {
    const client = new FakeClient();
    client.failMigration = true;
    client.failRollback = true;
    await expect(applyMigration(client, '001.sql', 'CREATE TABLE test')).rejects.toThrow('migration failed');
  });
});
