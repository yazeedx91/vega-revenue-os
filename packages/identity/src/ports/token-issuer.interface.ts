import type { AuthenticatedUser } from './identity-provider.interface';

export interface TokenIssuer {
  /**
   * Issues a tenant-scoped ProjectX access token for the given authenticated user.
   */
  issue(user: AuthenticatedUser): Promise<string>;
  /**
   * Verifies a ProjectX access token and returns the authenticated user.
   */
  verify(token: string): Promise<AuthenticatedUser | null>;
}
