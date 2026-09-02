import type { IRepository } from '../repository/repository.interface';
import type { Mission } from './mission';
import type { MissionId } from '../types';

export interface IMissionRepository extends IRepository<Mission, MissionId> {}
