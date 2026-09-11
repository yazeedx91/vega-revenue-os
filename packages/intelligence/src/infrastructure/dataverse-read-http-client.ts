export interface DataversePage { value: unknown[]; nextLink?: string; }
export interface IDataverseReadHttpClient { get(token: string, organizationUrl: string, path: string): Promise<DataversePage>; }

export class DataverseReadError extends Error {
  constructor(readonly status: number, readonly retryAfterSeconds?: number) { super('Dynamics read request failed'); this.name = 'DataverseReadError'; }
}

export class FetchDataverseReadHttpClient implements IDataverseReadHttpClient {
  constructor(private readonly fetchFn: typeof fetch = fetch) {}
  async get(token: string, organizationUrl: string, path: string): Promise<DataversePage> {
    const base = new URL(organizationUrl);
    const target = new URL(path, `${base.origin}/api/data/v9.2/`);
    if (target.origin !== base.origin || target.protocol !== 'https:') throw new DataverseReadError(400);
    let response: Response;
    try { response = await this.fetchFn(target, { method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'odata-maxversion': '4.0', 'odata-version': '4.0' } }); }
    catch { throw new DataverseReadError(503); }
    const retryAfter = Number(response.headers.get('retry-after'));
    if (!response.ok) throw new DataverseReadError(response.status, Number.isFinite(retryAfter) ? retryAfter : undefined);
    let body: unknown;
    try { body = await response.json(); } catch { throw new DataverseReadError(502); }
    if (!body || typeof body !== 'object' || !Array.isArray((body as any).value)) throw new DataverseReadError(502);
    const nextLink = (body as any)['@odata.nextLink'];
    if (nextLink !== undefined && typeof nextLink !== 'string') throw new DataverseReadError(502);
    return { value: (body as any).value, nextLink };
  }
}
