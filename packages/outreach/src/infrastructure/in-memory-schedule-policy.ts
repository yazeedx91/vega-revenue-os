import type { BusinessHoursPolicy } from '@projectx/domain';
import type { ISequenceSchedulePolicy } from '../ports/sequence-schedule-policy.interface';

export class InMemorySequenceSchedulePolicy implements ISequenceSchedulePolicy {
  computeNextDueAt(base: Date, delayMs: number, businessHours?: BusinessHoursPolicy): Date {
    let candidate = new Date(base.getTime() + delayMs);
    if (!businessHours) return candidate;

    const tzOffset = this.timezoneOffsetMs(candidate, businessHours.timezone);
    candidate = new Date(candidate.getTime() + tzOffset);

    for (let safety = 0; safety < 14; safety += 1) {
      const day = candidate.getUTCDay();
      const hour = candidate.getUTCHours();
      const isWorkDay = businessHours.workDays.includes(day);
      const inHours = hour >= businessHours.startHour && hour < businessHours.endHour;
      if (isWorkDay && inHours) {
        return new Date(candidate.getTime() - tzOffset);
      }
      candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
      candidate.setUTCMinutes(0, 0, 0);
      if (!isWorkDay || hour < businessHours.startHour) {
        candidate.setUTCHours(businessHours.startHour, 0, 0, 0);
      }
    }

    return new Date(candidate.getTime() - tzOffset);
  }

  private timezoneOffsetMs(date: Date, timezone: string): number {
    if (timezone === 'UTC') return 0;
    // Naive offset for deterministic tests; real implementation would use Intl.DateTimeFormat.
    const offsets: Record<string, number> = {
      'America/New_York': 4 * 60 * 60 * 1000,
      'America/Chicago': 5 * 60 * 60 * 1000,
      'America/Denver': 6 * 60 * 60 * 1000,
      'America/Los_Angeles': 7 * 60 * 60 * 1000,
      'Europe/London': 0,
      'Europe/Paris': -1 * 60 * 60 * 1000,
      'Asia/Dubai': -4 * 60 * 60 * 1000,
      'Asia/Tokyo': -9 * 60 * 60 * 1000,
    };
    return offsets[timezone] ?? 0;
  }
}
