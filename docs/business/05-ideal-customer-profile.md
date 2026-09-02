# Ideal Customer Profile

## ICP Framework Design

The ICP is **configurable per tenant**. No hardcoded ICP exists in the architecture. Saudi manufacturing is only an initial example configuration.

## Configurable Criteria

### Firmographic Filters

- Geography (country, region, city)
- Industry and sub-industry
- Employee count
- Revenue
- Number of locations
- Number of facilities
- Growth stage
- Business model

### Technology Stack

- Current ERP
- Current CRM
- Other business systems
- Cloud or on-premise indicators

### Signals

- Expansion signals
- Hiring signals
- Funding signals
- Digital transformation signals
- ERP migration signals
- Buying signals
- Negative signals
- Disqualifiers

### Customer-Defined Custom Criteria

- Custom firmographic fields
- Custom signal definitions
- Custom evidence requirements
- Custom confidence thresholds

## Filter Types

### Hard Filters

Criteria that must be true for a company to be considered. If a hard filter fails, the company is disqualified regardless of other signals.

### Soft Criteria

Criteria that improve a company's score but do not disqualify it if absent.

### Positive Signals

Evidence that increases fit score:

- Hiring for ERP roles
- Announced expansion
- Digital transformation initiatives
- Funding or acquisition
- Current ERP is legacy or end-of-life

### Negative Signals

Evidence that decreases fit score:

- Recent negative news
- Hiring freezes
- Moving away from Microsoft ecosystem
- Recent implementation of a competing ERP

### Disqualifiers

Hard reasons to exclude a company:

- No relevant business need
- Competitor
- Blacklisted domain
- Do-not-contact list
- Out of territory

### Required Evidence

The ICP requires evidence for each criterion:

- Source of the data
- Date of the signal
- Confidence in the signal
- Link to the source

### Confidence Thresholds

- **Minimum score to consider**: configurable per tenant
- **Minimum score to outreach**: higher threshold
- **Minimum score to qualify as opportunity**: highest threshold
