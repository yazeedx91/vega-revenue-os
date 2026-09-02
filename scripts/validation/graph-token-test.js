/**
 * Validates that Graph credentials in the environment can acquire an Entra
 * access token with the Mail.Send application permission.
 *
 * Usage:
 *   $env:GRAPH_TENANT_ID="..."
 *   $env:GRAPH_CLIENT_ID="..."
 *   $env:GRAPH_CLIENT_SECRET="..."
 *   node scripts/validation/graph-token-test.js
 */
const { ConfidentialClientApplication } = require('@azure/msal-node');

const tenantId = process.env.GRAPH_TENANT_ID;
const clientId = process.env.GRAPH_CLIENT_ID;
const clientSecret = process.env.GRAPH_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  console.error('Missing one or more required environment variables: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET');
  process.exit(1);
}

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  const json = Buffer.from(payload, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function main() {
  const clientApp = new ConfidentialClientApplication({
    auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}`, clientSecret },
  });

  const result = await clientApp.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });

  if (!result?.accessToken) {
    console.error('Token acquisition succeeded but no accessToken was returned.');
    process.exit(1);
  }

  const payload = decodeJwtPayload(result.accessToken);
  const roles = payload.roles || [];
  const hasMailSend = roles.includes('Mail.Send');

  console.log('Token acquired successfully');
  console.log(`App display name: ${payload.app_displayname || 'N/A'}`);
  console.log(`App ID: ${payload.appid || 'N/A'}`);
  console.log(`Mail.Send permission present: ${hasMailSend}`);

  if (!hasMailSend) {
    console.error('ERROR: Mail.Send application role is missing. Grant and admin-consent it before sending email.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Token acquisition failed:', err.message || err);
  process.exit(1);
});
