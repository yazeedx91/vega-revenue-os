import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      if (!key) continue;
      const value = valueParts.join('=').trim();
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore missing env file; tests will skip if services are unreachable.
  }
}

const envPath = resolve(__dirname, '../../../infra/integration/.env');
loadEnvFile(envPath);

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

// Safety guard: ensure live email remains disabled for Phase 14.7c.
if (process.env.OUTREACH_LIVE_EMAIL_ENABLED === 'true') {
  throw new Error(
    'Phase 14.7c E2E tests must not run with OUTREACH_LIVE_EMAIL_ENABLED=true. Aborting.',
  );
}

// Global default to prevent accidental real Graph interactions.
process.env.GRAPH_WEBHOOK_CALLBACK_URL = process.env.GRAPH_WEBHOOK_CALLBACK_URL || '';
process.env.GRAPH_TENANT_ID = process.env.GRAPH_TENANT_ID || '';
process.env.GRAPH_CLIENT_ID = process.env.GRAPH_CLIENT_ID || '';
process.env.GRAPH_CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET || '';

beforeAll(() => {
  // Ensure deterministic test clock expectations are not affected by TZ drift.
  process.env.TZ = 'UTC';
});
