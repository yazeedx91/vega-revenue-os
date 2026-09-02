# Business Processes

## Process A: Create Revenue Mission

- **Trigger**: Customer defines a business objective
- **Inputs**: Objective, target ICP, budget, timeframe, constraints
- **Actors**: Revenue Manager, Administrator
- **AI responsibilities**: Suggest ICP refinement, estimate required actions
- **Human responsibilities**: Approve mission parameters and autonomy level
- **Business rules**: Mission must have measurable objective and allowed action list
- **Outputs**: Approved mission record
- **Exceptions**: Invalid objective, missing ICP, insufficient budget
- **Escalation**: To Revenue Manager if AI cannot resolve objective

## Process B: Discover Target Companies

- **Trigger**: Mission is approved
- **Inputs**: ICP, territory, data sources
- **Actors**: AI Discovery Agent
- **AI responsibilities**: Search public and proprietary sources for matching companies
- **Human responsibilities**: Review and override results
- **Business rules**: Hard filters must be satisfied; negative signals disqualify
- **Outputs**: List of discovered companies with confidence scores

## Process C: Research Company

- **Trigger**: Company passes discovery filters
- **Inputs**: Company identifier, research sources
- **Actors**: AI Research Agent
- **AI responsibilities**: Gather company context, news, signals, and technology stack
- **Human responsibilities**: Review low-confidence research
- **Business rules**: Cite sources; flag missing evidence
- **Outputs**: Company intelligence report

## Process D: Evaluate Company

- **Trigger**: Research complete
- **Inputs**: Company intelligence, ICP criteria
- **Actors**: AI Scoring Agent
- **AI responsibilities**: Score fit against ICP
- **Human responsibilities**: Review borderline scores
- **Business rules**: Hard filters are enforced; confidence threshold must be met
- **Outputs**: Company score and qualification status

## Process E: Detect Buying Signals

- **Trigger**: Company scored above threshold
- **Inputs**: Research data, historical signals
- **Actors**: AI Signal Agent
- **AI responsibilities**: Identify and score buying signals
- **Human responsibilities**: Validate high-priority signals
- **Business rules**: Each signal requires evidence and confidence
- **Outputs**: Buying signal set

## Process F: Identify Decision Makers

- **Trigger**: Buying signals detected
- **Inputs**: Company data, contact sources
- **Actors**: AI Contact Agent
- **AI responsibilities**: Find and rank relevant decision-makers
- **Human responsibilities**: Approve target contact list
- **Business rules**: No contact attempts without evidence of relevance
- **Outputs**: Target contacts

## Process G: Score Opportunity

- **Trigger**: Decision-makers identified
- **Inputs**: Company, contacts, signals, ICP
- **Actors**: AI Opportunity Agent
- **AI responsibilities**: Combine data into an opportunity score
- **Human responsibilities**: Review scores below threshold
- **Business rules**: Score must explain its components
- **Outputs**: Opportunity score and priority

## Process H: Generate Outreach

- **Trigger**: Opportunity score above outreach threshold
- **Inputs**: Prospect data, messaging rules, templates
- **Actors**: AI Personalization Agent
- **AI responsibilities**: Draft personalized, approved-channel outreach
- **Human responsibilities**: Review and approve high-risk or sensitive outreach
- **Business rules**: Must respect tone, compliance, and opt-out lists
- **Outputs**: Draft outreach message

## Process I: Approve or Autonomously Send Outreach

- **Trigger**: Outreach drafted
- **Inputs**: Draft message, prospect, autonomy level
- **Actors**: AI, Revenue Manager
- **AI responsibilities**: Route to approval or send if within policy
- **Human responsibilities**: Approve, edit, or reject if required
- **Business rules**: Human approval required for high-risk, high-value, or low-confidence outreach
- **Outputs**: Sent message or pending approval

## Process J: Handle Prospect Reply

- **Trigger**: Prospect responds
- **Inputs**: Reply content, conversation history
- **Actors**: AI Conversation Agent
- **AI responsibilities**: Interpret reply, update qualification, respond or escalate
- **Human responsibilities**: Take over if AI is uncertain or request is complex
- **Business rules**: Respect opt-out; do not misrepresent facts
- **Outputs**: Updated conversation and next action

## Process K: Qualify Prospect

- **Trigger**: Sufficient conversation or signal evidence
- **Inputs**: Conversation, research, BANT or equivalent criteria
- **Actors**: AI Qualification Agent
- **AI responsibilities**: Assess qualification against customer-defined rules
- **Human responsibilities**: Confirm or override qualification
- **Business rules**: Disqualify if criteria are not met
- **Outputs**: Qualification status and reason

## Process L: Schedule Meeting

- **Trigger**: Prospect is qualified and agrees to a meeting
- **Inputs**: Prospect, rep availability, meeting provider
- **Actors**: AI Scheduling Agent
- **AI responsibilities**: Propose times, book through meeting provider
- **Human responsibilities**: Approve or reschedule if needed
- **Business rules**: Include required attendees, time zones, and meeting purpose
- **Outputs**: Calendar invite and meeting record

## Process M: Create CRM Opportunity

- **Trigger**: Meeting booked
- **Inputs**: Company, contacts, meeting, qualification notes
- **Actors**: AI CRM Agent
- **AI responsibilities**: Create or update opportunity in Dynamics 365
- **Human responsibilities**: Verify and enrich opportunity
- **Business rules**: Map to normalized domain objects; do not duplicate
- **Outputs**: CRM opportunity record

## Process N: Prepare Sales Brief

- **Trigger**: Meeting scheduled
- **Inputs**: Research, conversation, signals, opportunity
- **Actors**: AI Briefing Agent
- **AI responsibilities**: Compile a concise, cited sales brief
- **Human responsibilities**: Review and add context
- **Business rules**: Cite sources; flag low-confidence claims
- **Outputs**: Sales brief

## Process O: Follow Up

- **Trigger**: Post-meeting or no-show
- **Inputs**: Meeting outcome, prospect context
- **Actors**: AI Follow-Up Agent
- **AI responsibilities**: Send follow-up, nurture, or re-engage message
- **Human responsibilities**: Approve high-value follow-ups
- **Business rules**: Respect prospect preferences and timing
- **Outputs**: Follow-up action

## Process P: Record Outcome

- **Trigger**: Meeting completed or opportunity closed
- **Inputs**: Rep feedback, CRM update, conversation outcome
- **Actors**: Sales Rep, AI
- **AI responsibilities**: Record structured outcome and update models
- **Human responsibilities**: Validate outcome and provide feedback
- **Business rules**: Outcome must be truthful and auditable
- **Outputs**: Outcome record

## Process Q: Evaluate Performance

- **Trigger**: Mission completes or periodically
- **Inputs**: Mission data, outcomes, costs
- **Actors**: Revenue Manager, AI
- **AI responsibilities**: Calculate KPIs, compare to objectives, identify patterns
- **Human responsibilities**: Interpret results and decide next steps
- **Business rules**: Use North Star metrics, not vanity metrics
- **Outputs**: Performance report

## Process R: Improve Strategy

- **Trigger**: Performance evaluation complete
- **Inputs**: Performance report, feedback
- **Actors**: Revenue Manager, AI
- **AI responsibilities**: Suggest ICP, messaging, and process improvements
- **Human responsibilities**: Approve strategy changes
- **Business rules**: Changes require approval if they affect compliance or customer commitments
- **Outputs**: Updated strategy and ICP
