/**
 * Runs a Snyk code or dependency scan and writes the JSON report to disk.
 * Exits with Snyk's exit code so CI can fail on findings, but always writes
 * the report file when the scan produces output.
 *
 * Usage:
 *   node scripts/security/snyk-scan.js code
 *   node scripts/security/snyk-scan.js deps
 *
 * Requires SNYK_TOKEN to be set in the environment.
 */
const { spawnSync } = require('child_process');
const { writeFileSync } = require('fs');
const path = require('path');

const scanType = process.argv[2];
if (!['code', 'deps'].includes(scanType)) {
  console.error('Usage: node scripts/security/snyk-scan.js <code|deps>');
  process.exit(1);
}

if (!process.env.SNYK_TOKEN) {
  console.error('SNYK_TOKEN is required. Set it in the environment or CI secret store.');
  process.exit(1);
}

const reportFile = scanType === 'code' ? 'snyk-code-report.json' : 'snyk-deps-report.json';
const args =
  scanType === 'code'
    ? ['exec', 'snyk', 'code', 'test', '--json']
    : ['exec', 'snyk', 'test', '--severity-threshold=medium', '--json'];

console.log(`Running: pnpm ${args.join(' ')}`);
const result = spawnSync('pnpm', args, {
  cwd: path.resolve(__dirname, '../..'),
  encoding: 'utf8',
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
});

if (result.stdout) {
  writeFileSync(path.resolve(process.cwd(), reportFile), result.stdout, 'utf8');
  console.log(`Wrote ${reportFile}`);
}

if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.status ?? 1);
