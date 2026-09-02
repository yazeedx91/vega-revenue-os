import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'crypto';

export interface AdminApiKeyGuardConfig {
  getExpectedKey: () => string | undefined;
}

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: AdminApiKeyGuardConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = this.extractKey(request);
    const expected = this.config.getExpectedKey();

    if (!expected || !provided) {
      throw new UnauthorizedException('Admin API key is required');
    }

    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      // Intentionally perform a constant-time comparison against a dummy
      // buffer of the same length to avoid leaking length information.
      timingSafeEqual(providedBuffer, Buffer.alloc(providedBuffer.length));
      throw new UnauthorizedException('Invalid admin API key');
    }

    if (!timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw new UnauthorizedException('Invalid admin API key');
    }

    return true;
  }

  private extractKey(request: Request): string | undefined {
    const header = request.headers['x-admin-api-key'];
    if (typeof header === 'string') {
      return header;
    }
    if (Array.isArray(header) && header.length > 0) {
      return header[0];
    }
    return undefined;
  }
}
