import type { TenantContext } from '@projectx/domain';
import { asCorrelationId, asTenantId, type ToolCallRequest } from '@projectx/shared';
import { HttpToolProvider, type HttpEgressPolicy } from '../providers/http-tool-provider';

const ctx: TenantContext = { tenantId: asTenantId('tenant-1'), correlationId: 'c' };

function req(over: Partial<ToolCallRequest> = {}): ToolCallRequest {
  return {
    toolCallId: 'tc-1',
    toolId: 'http_tool',
    toolVersion: '1.0.0',
    tenantId: asTenantId('tenant-1'),
    correlationId: asCorrelationId('c'),
    authorization: { policyDecisionId: 'p', decision: 'ALLOW', capabilities: [], expiresAt: new Date(Date.now() + 60000) },
    riskCategory: 'LOW',
    input: {},
    timeoutSeconds: 5,
    ...over,
  };
}

const prodPolicy: HttpEgressPolicy = {
  allowedHosts: ['api.example.com'],
  allowedSchemes: ['https'],
  allowPrivateNetwork: false,
  allowRedirects: false,
  routes: { 'example': { baseUrl: 'https://api.example.com/invoke' } },
};

function fakeFetch(status = 200, body: unknown = { ok: true }, headers: Record<string, string> = {}) {
  return jest.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })) as unknown as typeof fetch;
}

describe('HttpToolProvider — SSRF/egress hardening', () => {
  it('rejects when no privileged destination is configured (no arbitrary egress)', async () => {
    const fetchImpl = fakeFetch();
    const p = new HttpToolProvider({ providerId: 'http', policy: prodPolicy, fetchImpl });
    const res = await p.execute(ctx, req());
    expect(res.submitted).toBe(false);
    expect(res.errorCode).toBe('EGRESS_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('agent-supplied destination in input/metadata cannot reach the wire', async () => {
    const fetchImpl = fakeFetch();
    const p = new HttpToolProvider({ providerId: 'http', policy: prodPolicy, fetchImpl });
    // Even if the agent stuffs a URL into input or metadata, it is ignored.
    const res = await p.execute(ctx, req({
      input: { url: 'https://evil.example.com/x' },
      metadata: { baseUrl: 'https://evil.example.com', route: 'nonexistent' },
    }));
    expect(res.submitted).toBe(false);
    expect(res.errorCode).toBe('EGRESS_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks private/loopback/metadata destinations in production', async () => {
    const fetchImpl = fakeFetch();
    const policy: HttpEgressPolicy = {
      ...prodPolicy,
      routes: { 'meta': { baseUrl: 'http://169.254.169.254/latest/meta-data' } },
    };
    const p = new HttpToolProvider({ providerId: 'http', policy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'meta' } }));
    expect(res.submitted).toBe(false);
    expect(res.errorCode).toBe('EGRESS_DENIED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('blocks disallowed scheme (http) in production', async () => {
    const fetchImpl = fakeFetch();
    const policy: HttpEgressPolicy = {
      ...prodPolicy,
      routes: { 'insecure': { baseUrl: 'http://api.example.com/x' } },
    };
    const p = new HttpToolProvider({ providerId: 'http', policy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'insecure' } }));
    expect(res.submitted).toBe(false);
    expect(res.errorCode).toBe('EGRESS_DENIED');
  });

  it('rejects redirect to a non-allowlisted host', async () => {
    const fetchImpl = jest.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'https://evil.example.com/steal' },
    })) as unknown as typeof fetch;
    const policy: HttpEgressPolicy = { ...prodPolicy, allowRedirects: true };
    const p = new HttpToolProvider({ providerId: 'http', policy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'example' } }));
    expect(res.errorCode).toBe('REDIRECT_DENIED');
  });

  it('allows a configured allowlisted route and returns provider outcome', async () => {
    const fetchImpl = fakeFetch(200, { result: 'ok' }, { 'x-request-id': 'req-9' });
    const p = new HttpToolProvider({ providerId: 'http', policy: prodPolicy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'example' } }));
    expect(res.submitted).toBe(true);
    expect(res.resultKnown).toBe(true);
    expect(res.providerRequestId).toBe('req-9');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('test-mode local endpoint is usable when allowPrivateNetwork + http scheme enabled', async () => {
    const fetchImpl = fakeFetch(200, { local: true });
    const testPolicy: HttpEgressPolicy = {
      allowedHosts: ['localhost', '127.0.0.1'],
      allowedSchemes: ['http'],
      allowPrivateNetwork: true,
      allowRedirects: false,
      routes: { 'local': { baseUrl: 'http://127.0.0.1:9/invoke' } },
    };
    const p = new HttpToolProvider({ providerId: 'http', policy: testPolicy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'local' } }));
    expect(res.submitted).toBe(true);
    expect(res.resultKnown).toBe(true);
  });

  it('timeout/abort after submission → ambiguous (submitted, resultKnown=false)', async () => {
    const fetchImpl = jest.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }) as unknown as typeof fetch;
    const p = new HttpToolProvider({ providerId: 'http', policy: prodPolicy, fetchImpl });
    const res = await p.execute(ctx, req({ metadata: { route: 'example' } }));
    expect(res.submitted).toBe(true);
    expect(res.resultKnown).toBe(false);
    expect(res.errorCode).toBe('TIMEOUT');
  });
});
