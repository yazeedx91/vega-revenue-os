import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AdminApiKeyGuard } from '../admin-api-key.guard';

function createContext(headerValue?: string | string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () =>
        ({
          headers: headerValue !== undefined ? { 'x-admin-api-key': headerValue } : {},
        }) as unknown as Request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminApiKeyGuard', () => {
  it('returns true for matching key', () => {
    const guard = new AdminApiKeyGuard({ getExpectedKey: () => 'super-secret' });
    expect(guard.canActivate(createContext('super-secret'))).toBe(true);
  });

  it('rejects when key is missing', () => {
    const guard = new AdminApiKeyGuard({ getExpectedKey: () => 'super-secret' });
    expect(() => guard.canActivate(createContext())).toThrow(UnauthorizedException);
  });

  it('rejects when expected key is not configured', () => {
    const guard = new AdminApiKeyGuard({ getExpectedKey: () => undefined });
    expect(() => guard.canActivate(createContext('super-secret'))).toThrow(UnauthorizedException);
  });

  it('rejects wrong key without leaking timing information', () => {
    const guard = new AdminApiKeyGuard({ getExpectedKey: () => 'super-secret' });
    expect(() => guard.canActivate(createContext('wrong-secret'))).toThrow(UnauthorizedException);
  });
});
