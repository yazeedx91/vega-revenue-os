# State Machines

## Mission State Machine

```mermaid
stateDiagram-v2
    [*] --> Draft: CreateMission
    Draft --> Approved: ApproveMission
    Draft --> Cancelled: CancelMission
    Approved --> Scheduled: ScheduleMission
    Approved --> Planning: StartMission
    Scheduled --> Planning: StartMission
    Planning --> Executing: PlanValid
    Executing --> Paused: PauseMission
    Executing --> AwaitingApproval: HighRiskAction
    Executing --> Blocked: UnresolvableException
    Executing --> Completed: SuccessCriteriaMet
    Executing --> Failed: TimeframeExpired
    Paused --> Executing: ResumeMission
    Paused --> Cancelled: CancelMission
    AwaitingApproval --> Executing: ApprovalGranted
    AwaitingApproval --> Cancelled: ApprovalRejected
    Blocked --> Executing: ExceptionResolved
    Blocked --> Failed: Timeout
    Completed --> Archived: ArchiveMission
    Failed --> Archived: ArchiveMission
    Cancelled --> Archived: ArchiveMission
```

### Allowed Transitions

| From | To | Trigger |
|---|---|---|
| Draft | Approved | Human approval |
| Draft | Cancelled | Human cancellation |
| Approved | Scheduled | Scheduler |
| Approved/Scheduled | Planning | StartMission command |
| Planning | Executing | Plan validation |
| Executing | Paused | Pause command |
| Executing | AwaitingApproval | High-risk action |
| Executing | Blocked | Exception |
| Executing | Completed | Success criteria met |
| Executing | Failed | Timeout or objective unmet |
| Paused | Executing | Resume command |
| Paused | Cancelled | Cancel command |
| AwaitingApproval | Executing | Approval granted |
| AwaitingApproval | Cancelled | Approval rejected |
| Blocked | Executing | Exception resolved |
| Blocked | Failed | Resolution timeout |
| Completed/Failed/Cancelled | Archived | Review complete |

### Forbidden Transitions

- Completed → Executing
- Archived → any state
- Failed → Completed
- Cancelled → Completed
- AwaitingApproval → Planning

## Lead State Machine

```mermaid
stateDiagram-v2
    [*] --> Discovered: CreateLead
    Discovered --> Researching: ResearchCompany
    Researching --> Qualified: QualifyLead
    Researching --> Disqualified: DisqualifyLead
    Qualified --> Contacted: OutreachSent
    Contacted --> Engaged: ProspectReplied
    Engaged --> Qualified: Re-evaluate
    Engaged --> Disqualified: DisqualifyLead
    Qualified --> Converted: ConvertLead
    Converted --> [*]
    Disqualified --> [*]
    Discovered --> Suppressed: AddSuppression
    Researching --> Suppressed: AddSuppression
    Qualified --> Suppressed: AddSuppression
```

### Forbidden Transitions

- Disqualified → Qualified without re-creation
- Converted → Disqualified
- Suppressed → any active state without explicit removal

## Opportunity State Machine

```mermaid
stateDiagram-v2
    [*] --> Identified: CreateOpportunity
    Identified --> Qualified: QualifyOpportunity
    Qualified --> MeetingBooked: MeetingBooked
    MeetingBooked --> SalesHandoff: PrepareBrief
    SalesHandoff --> Open: HandoffAccepted
    Open --> Won: WinOpportunity
    Open --> Lost: LoseOpportunity
    Lost --> Open: Reopen (correction process)
    Won --> [*]
    Lost --> [*]
    Open --> Closed: CloseOpportunity
    Closed --> [*]
```

### Forbidden Transitions

- Won → Lost
- Lost → Won
- Won → Open

## Conversation State Machine

```mermaid
stateDiagram-v2
    [*] --> Initiated: OutreachSent
    Initiated --> Active: ProspectReplied
    Active --> Qualification: EvaluateConversation
    Active --> Closed: CloseConversation
    Qualification --> MeetingRequested: RequestMeeting
    Qualification --> Active: MoreInformationNeeded
    Qualification --> Closed: Disqualified
    MeetingRequested --> MeetingBooked: BookMeeting
    MeetingRequested --> Active: RescheduleOrClarify
    MeetingBooked --> Handoff: PrepareSalesBrief
    Handoff --> Closed: HandoffComplete
    Closed --> [*]
```

### Forbidden Transitions

- Closed → Active without explicit reopen
- MeetingBooked → Initiated

## Meeting State Machine

```mermaid
stateDiagram-v2
    [*] --> Requested: RequestMeeting
    Requested --> Proposed: ProposeTimes
    Proposed --> Scheduled: BookMeeting
    Proposed --> Cancelled: Decline
    Scheduled --> Rescheduled: RescheduleMeeting
    Scheduled --> Completed: CompleteMeeting
    Scheduled --> Cancelled: CancelMeeting
    Scheduled --> NoShow: MarkNoShow
    Rescheduled --> Scheduled: ConfirmNewTime
    Rescheduled --> Cancelled: CancelMeeting
    Completed --> [*]
    Cancelled --> [*]
    NoShow --> Active: Re-engage
```

### Forbidden Transitions

- Completed → Scheduled without correction process
- Cancelled → Scheduled without new request
- Completed → Cancelled

## Agent Execution State Machine

```mermaid
stateDiagram-v2
    [*] --> Created: CreateExecution
    Created --> Queued: Enqueue
    Queued --> Running: StartExecution
    Running --> Waiting: WaitForExternalResult
    Running --> AwaitingApproval: PolicyRequiresApproval
    Running --> Completed: CompleteExecution
    Running --> Failed: FailExecution
    Waiting --> Running: ExternalResultReceived
    Waiting --> Failed: Timeout
    AwaitingApproval --> Running: ApprovalGranted
    AwaitingApproval --> Cancelled: ApprovalRejected
    Running --> Cancelled: CancelExecution
    Queued --> Cancelled: CancelExecution
    Completed --> [*]
    Failed --> [*]
    Cancelled --> [*]
    Failed --> RolledBack: RollbackExecution
    RolledBack --> [*]
```

### Forbidden Transitions

- Completed → Running
- Cancelled → Running
- Failed → Completed
- RolledBack → Running
