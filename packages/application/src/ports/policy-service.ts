export type PolicyDecision = 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';

export interface PolicyAction {
  readonly actionType: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly autonomyLevel: number;
}

export interface IPolicyService {
  evaluate(ctx: { tenantId: string & { readonly __brand: 'TenantId' } }, action: PolicyAction): Promise<PolicyDecision>;
}
