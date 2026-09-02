import type { TenantContext } from '@projectx/domain';
import type { IntentClassification } from '@projectx/domain';

export interface IIntentClassifier {
  classify(ctx: TenantContext, content: string, channel: string): Promise<IntentClassification>;
}
