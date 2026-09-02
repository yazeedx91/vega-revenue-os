import type { BusinessHoursPolicy } from '@projectx/domain';

export interface ISequenceSchedulePolicy {
  computeNextDueAt(base: Date, delayMs: number, businessHours?: BusinessHoursPolicy): Date;
}
