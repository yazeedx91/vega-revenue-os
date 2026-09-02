import type { Account, ICPProfile, ICPProfileProps } from '@projectx/domain';

export interface LeadScores {
  icpMatch: number;
  signalScore: number;
  intentScore: number;
  evidenceConfidence: number;
  overall: number;
}

export class ICPScorer {
  score(account: Account, profile: ICPProfile): { score: number; passed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const hard = profile.hardFilters;

    if (hard.industries && hard.industries.length > 0) {
      if (!account.industry || !hard.industries.includes(account.industry)) {
        return { score: 0, passed: false, reasons: [`Industry ${account.industry} not in ${hard.industries.join(', ')}`] };
      }
      reasons.push(`Industry ${account.industry} matches ICP`);
    }

    if (hard.territories && hard.territories.length > 0) {
      const overlap = account.territories.some((t) => hard.territories!.includes(t));
      if (!overlap) {
        return { score: 0, passed: false, reasons: [`Territory ${account.territories.join(', ')} not in ${hard.territories!.join(', ')}`] };
      }
      reasons.push(`Territory matches ICP`);
    }

    if (hard.minEmployees !== undefined && account.employeeCount !== undefined && account.employeeCount < hard.minEmployees) {
      return { score: 0, passed: false, reasons: [`Employee count ${account.employeeCount} below minimum ${hard.minEmployees}`] };
    }

    if (hard.maxEmployees !== undefined && account.employeeCount !== undefined && account.employeeCount > hard.maxEmployees) {
      return { score: 0, passed: false, reasons: [`Employee count ${account.employeeCount} above maximum ${hard.maxEmployees}`] };
    }

    let softScore = 0;
    let softWeight = 0;
    for (const criterion of profile.softCriteria) {
      softWeight += criterion.weight;
      if (account.techStack && this.criterionMatches(criterion, account)) {
        softScore += criterion.weight;
        reasons.push(`Soft criterion "${criterion.criterion}" matched (+${criterion.weight})`);
      }
    }

    const normalizedSoft = softWeight > 0 ? softScore / softWeight : 0.5;
    // Hard filters passed means base score 0.6; soft criteria can raise to 0.95.
    const score = 0.6 + normalizedSoft * 0.35;
    return { score: Math.min(0.95, Math.round(score * 100) / 100), passed: true, reasons };
  }

  private criterionMatches(criterion: ICPProfileProps['softCriteria'][number], account: Account): boolean {
    const term = criterion.criterion.toLowerCase();
    if (term.includes('tech') || term.includes('stack')) {
      return account.techStack.some((t) => term.includes(t.toLowerCase()));
    }
    if (term.includes('growth') && account.employeeCount && account.employeeCount > 50) return true;
    if (term.includes('dynamics') || term.includes('erp')) {
      return account.techStack.some((t) => term.includes(t.toLowerCase()));
    }
    return false;
  }
}

export class SignalScorer {
  score(signals: Array<{ relevance: number; confidence: number; recencyWeight?: number }>): number {
    if (signals.length === 0) return 0;
    let total = 0;
    let weightSum = 0;
    for (const signal of signals) {
      const recency = signal.recencyWeight ?? 1;
      const value = signal.relevance * signal.confidence * recency;
      total += value;
      weightSum += recency;
    }
    const normalized = weightSum > 0 ? total / weightSum : 0;
    return Math.min(1, Math.round(normalized * 100) / 100);
  }
}

export class LeadScorer {
  score(
    icpMatch: number,
    signalScore: number,
    evidenceConfidence: number,
    weights: { icpMatch: number; signal: number; intent: number; evidenceConfidence: number },
  ): LeadScores {
    const intentScore = Math.min(1, (icpMatch + signalScore) / 2);
    const overall =
      weights.icpMatch * icpMatch +
      weights.signal * signalScore +
      weights.intent * intentScore +
      weights.evidenceConfidence * evidenceConfidence;
    return {
      icpMatch,
      signalScore,
      intentScore: Math.round(intentScore * 100) / 100,
      evidenceConfidence,
      overall: Math.min(1, Math.round(overall * 100) / 100),
    };
  }
}

export function computeEvidenceConfidence(evidence: Array<{ confidence: number; isFresh: boolean }>): number {
  if (evidence.length === 0) return 0;
  const values = evidence.map((e) => e.confidence * (e.isFresh ? 1 : 0.7));
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.min(1, Math.round(avg * 100) / 100);
}
