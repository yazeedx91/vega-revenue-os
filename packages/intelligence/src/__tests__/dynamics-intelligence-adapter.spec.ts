import { randomUUID } from 'crypto';
import { asCorrelationId, asTenantId } from '@projectx/shared';
import { DataverseReadError, FetchDataverseReadHttpClient } from '../infrastructure/dataverse-read-http-client';
import { StaticWorkspaceDynamicsAuthorityResolver } from '../infrastructure/dynamics-authority-resolver';
import { DynamicsIntelligenceAdapter } from '../infrastructure/dynamics-intelligence-adapter';

const token = randomUUID();
const secret = randomUUID();
const clientIdRef = randomUUID();
const clientSecretRef = randomUUID();
const ctx = { tenantId: asTenantId('tenant-a'), workspaceId: 'workspace-a', correlationId: asCorrelationId('dynamics-test') };
let requests: Array<{ method: string; url: string; authorization: string | null }> = [];
let status = 200;
let malformed = false;
let page = 0;

async function dataverseFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const headers = new Headers(init?.headers);
  requests.push({ method: init?.method ?? 'GET', url, authorization: headers.get('authorization') });
  if (status !== 200) return new Response(JSON.stringify({ error: { message: 'provider secret detail' } }), { status, headers: { 'retry-after': '17' } });
  if (headers.get('authorization') !== `Bearer ${token}`) return new Response(null, { status: 401 });
  if (malformed) return new Response('{bad json', { status: 200 });
  const isContacts = url.includes('/contacts?');
  const value = isContacts
    ? [{ contactid: '70000000-0000-4000-8000-000000000001', _parentcustomerid_value: '71000000-0000-4000-8000-000000000001', fullname: 'External Contact', jobtitle: 'Director', emailaddress1: 'external@example.test', telephone1: '+15550000000' }]
    : [{ accountid: `71000000-0000-4000-8000-00000000000${page + 1}`, name: `External Account ${page + 1}`, websiteurl: 'example.test', industrycode: 'manufacturing', numberofemployees: 200, revenue: 1000000 }];
  page += 1;
  return new Response(JSON.stringify({ value, ...(page < 3 && !isContacts ? { '@odata.nextLink': `https://org-a.example.test/api/data/v9.2/accounts?$skiptoken=${page}` } : {}) }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function adapter(accessToken = token) {
  return new DynamicsIntelligenceAdapter({
    authorityResolver: new StaticWorkspaceDynamicsAuthorityResolver([{ tenantId: 'tenant-a', workspaceId: 'workspace-a', organizationUrl: 'https://org-a.example.test', entraTenantId: 'entra-a', clientIdSecretReference: clientIdRef, clientSecretReference: clientSecretRef }]),
    secretsProvider: { getSecret: async (name: string) => name === clientIdRef ? randomUUID() : secret, getCertificate: async () => Buffer.alloc(0) },
    tokenProviderFactory: { create: () => ({ getAccessToken: async () => accessToken }) },
    httpClient: new FetchDataverseReadHttpClient(dataverseFetch as typeof fetch),
  });
}

beforeEach(() => { requests = []; status = 200; malformed = false; page = 0; });

describe('DynamicsIntelligenceAdapter read-only Dataverse integration', () => {
  it('uses explicit bounded account projection and deterministic pagination', async () => {
    const found = await adapter().findAccounts(ctx, { name: 'External', limit: 3 });
    expect(found).toHaveLength(3);
    expect(requests).toHaveLength(3);
    expect(requests[0].url).toContain('$select=accountid,name,websiteurl,industrycode,numberofemployees,revenue,modifiedon');
    expect(requests[0].url).toContain('$top=3');
    expect(found[0].raw).toEqual({ provider: 'dynamics365', source: 'dataverse' });
  });

  it('reads only projected contacts for a bounded account identifier', async () => {
    const contacts = await adapter().findContacts(ctx, '71000000-0000-4000-8000-000000000001');
    expect(contacts[0]).toMatchObject({ providerContactId: '70000000-0000-4000-8000-000000000001', accountId: '71000000-0000-4000-8000-000000000001' });
    expect(requests[0].url).toContain('$select=contactid,_parentcustomerid_value,fullname,jobtitle,emailaddress1,telephone1,modifiedon');
  });

  it('denies cross-workspace and cross-tenant configuration access', async () => {
    await expect(adapter().findAccounts({ ...ctx, workspaceId: 'workspace-b' }, { limit: 1 })).rejects.toThrow('Dynamics access denied');
    await expect(adapter().findAccounts({ ...ctx, tenantId: asTenantId('tenant-b') }, { limit: 1 })).rejects.toThrow('Dynamics access denied');
  });

  it('prevents arbitrary organization URL override', async () => {
    await adapter().findAccounts(ctx, { domain: 'attacker.example', limit: 1 });
    expect(requests[0].url).toMatch(/^https:\/\/org-a\.example\.test\//);
  });

  it('sanitizes token, 4xx, 5xx, and throttling failures', async () => {
    await expect(adapter(randomUUID()).findAccounts(ctx, { limit: 1 })).rejects.toThrow('Dynamics read failed');
    for (const code of [403, 429, 503]) {
      status = code;
      const error = await adapter().findAccounts(ctx, { limit: 1 }).catch((value) => value as Error);
      expect(error.message).toBe('Dynamics read failed');
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain('provider secret detail');
    }
  });

  it('preserves Retry-After at the transport boundary without automatic retry', async () => {
    status = 429;
    const transport = new FetchDataverseReadHttpClient(dataverseFetch as typeof fetch);
    const error = await transport.get(token, 'https://org-a.example.test', 'accounts?$select=accountid').catch((value) => value as DataverseReadError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 17 });
    expect(requests).toHaveLength(1);
  });

  it('fails closed on malformed JSON or invalid projected schema', async () => {
    malformed = true;
    await expect(adapter().findAccounts(ctx, { limit: 1 })).rejects.toThrow('Dynamics read failed');
    malformed = false;
    const invalid = new DynamicsIntelligenceAdapter({ ...(adapter() as any).config, httpClient: { get: async () => ({ value: [{ accountid: 'id', name: 'x'.repeat(501) }] }) } });
    await expect(invalid.findAccounts(ctx, { limit: 1 })).rejects.toThrow('Dynamics response schema invalid');
  });

  it('emits GET only and never POST, PATCH, PUT, or DELETE', async () => {
    await adapter().findAccounts(ctx, { limit: 2 });
    await adapter().findContacts(ctx, '71000000-0000-4000-8000-000000000001');
    expect(new Set(requests.map((request) => request.method))).toEqual(new Set(['GET']));
    expect(requests.some((request) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method))).toBe(false);
  });
});
