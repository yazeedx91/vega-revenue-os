import type { IAgentImplementation, IAgentImplementationRegistry } from '@projectx/ai-runtime';
import { ResearchSpecialist } from './research/research-specialist';
import { IcpQualificationSpecialist } from './icp-qualification/icp-qualification-specialist';
import { LeadQualificationSpecialist } from './lead-qualification/lead-qualification-specialist';
import { BuyingSignalSpecialist } from './buying-signal/buying-signal-specialist';
import { OutreachStrategistSpecialist } from './outreach-strategist/outreach-strategist-specialist';
import { OutreachWriterSpecialist } from './outreach-writer/outreach-writer-specialist';
import { ConversationSpecialist } from './conversation/conversation-specialist';
import { MeetingSpecialist } from './meeting/meeting-specialist';
import { CrmSpecialist } from './crm/crm-specialist';
import { FollowUpNurtureSpecialist } from './follow-up-nurture/follow-up-nurture-specialist';
import { ComplianceSafetySpecialist } from './compliance-safety/compliance-safety-specialist';

export class SpecialistImplementationRegistry implements IAgentImplementationRegistry {
  private readonly implementations = new Map<string, IAgentImplementation>();

  constructor() {
    const specialists: IAgentImplementation[] = [
      new ResearchSpecialist(),
      new IcpQualificationSpecialist(),
      new LeadQualificationSpecialist(),
      new BuyingSignalSpecialist(),
      new OutreachStrategistSpecialist(),
      new OutreachWriterSpecialist(),
      new ConversationSpecialist(),
      new MeetingSpecialist(),
      new CrmSpecialist(),
      new FollowUpNurtureSpecialist(),
      new ComplianceSafetySpecialist(),
    ];
    for (const impl of specialists) {
      this.implementations.set(impl.implementationKey, impl);
    }
  }

  resolve(implementationKey: string): IAgentImplementation | null {
    return this.implementations.get(implementationKey) ?? null;
  }
}
