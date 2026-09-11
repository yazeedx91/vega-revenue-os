import type { ArgumentsHost } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

function harness() {
  const result: { status?: number; body?: unknown } = {};
  const response = { status: (status: number) => { result.status = status; return response; }, json: (body: unknown) => { result.body = body; } };
  return { result, host: { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost };
}

describe('ApiExceptionFilter', () => {
  it('maps OCC conflicts to sanitized 409', () => {
    const { result, host } = harness();
    const error = new Error('SQL secret ciphertext'); error.name = 'ConcurrencyConflictError';
    new ApiExceptionFilter().catch(error, host);
    expect(result).toEqual({ status: 409, body: { statusCode: 409, message: 'Request could not be completed' } });
  });

  it('does not leak unknown internal failures', () => {
    const { result, host } = harness();
    new ApiExceptionFilter().catch(new Error('password=secret stack trace'), host);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.status).toBe(500);
  });
});
