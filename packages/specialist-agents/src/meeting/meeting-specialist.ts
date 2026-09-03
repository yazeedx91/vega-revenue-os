import { BaseSpecialist } from '../base-specialist';
import type { AgentImplementationRuntime } from '@projectx/ai-runtime';
import type { AIExecutionRequest, ExecutionOutcome } from '@projectx/shared';

export interface MeetingRequest {
  readonly attendees?: { email?: string; role?: string }[];
  readonly durationMinutes?: 30 | 60 | 90;
  readonly timeWindow?: { start?: string; end?: string };
}

export class MeetingSpecialist extends BaseSpecialist {
  readonly implementationKey = 'specialist.meeting.v1' as const;
  readonly capabilities = ['meeting_scheduling', 'calendar_coordination'] as const;
  readonly riskCategory = 'scheduling';

  protected async executeCore(request: AIExecutionRequest, _runtime: AgentImplementationRuntime): Promise<ExecutionOutcome> {
    const target = (request.context.target ?? {}) as MeetingRequest;
    const attendees = target.attendees ?? [];
    const duration = target.durationMinutes ?? 30;

    const validAttendees = attendees.filter((a) => a.email && a.email.includes('@'));
    if (validAttendees.length === 0) {
      throw new Error('At least one valid attendee email is required for meeting scheduling');
    }

    return {
      summary: `Meeting scheduling request prepared for ${validAttendees.length} attendee(s), duration ${duration} minutes. Calendar availability and booking deferred to Slice 12.`,
      decisions: [{ duration, attendeeCount: validAttendees.length }],
      actions: [
        { type: 'schedule_meeting', duration, attendees: validAttendees.map((a) => a.email) },
        { type: 'request_tool', toolCategory: 'calendar', slice: 12 },
      ],
      evidence: [
        { timeWindow: target.timeWindow, attendees: validAttendees },
      ],
    };
  }
}
