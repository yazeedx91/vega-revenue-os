import type { IRepository } from '@projectx/domain';
import type { Mission } from '@projectx/domain';

export interface IMissionRepository extends IRepository<Mission, string> {}
