import { ValueObject } from '../../value-object/value-object';
import { MonetaryAmount, CurrencyCode } from './monetary-amount';

export class RevenueMetricsInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RevenueMetricsInvariantError';
  }
}

export class RevenueMetrics extends ValueObject {
  private readonly mrr: MonetaryAmount | null;
  private readonly arr: MonetaryAmount | null;
  private readonly acv: MonetaryAmount | null;
  private readonly tcv: MonetaryAmount | null;

  private constructor(props: {
    mrr?: MonetaryAmount | null;
    arr?: MonetaryAmount | null;
    acv?: MonetaryAmount | null;
    tcv?: MonetaryAmount | null;
  }) {
    super();
    this.mrr = props.mrr ?? null;
    this.arr = props.arr ?? null;
    this.acv = props.acv ?? null;
    this.tcv = props.tcv ?? null;
    this.validateCurrencyConsistency();
  }

  private validateCurrencyConsistency(): void {
    const currencies = new Set<CurrencyCode>();
    const amounts = [this.mrr, this.arr, this.acv, this.tcv].filter((a): a is MonetaryAmount => a !== null);
    
    for (const amount of amounts) {
      currencies.add(amount.getCurrency());
    }

    if (currencies.size > 1) {
      throw new RevenueMetricsInvariantError('All revenue metrics must use the same currency');
    }
  }

  static create(props: {
    mrr?: MonetaryAmount | null;
    arr?: MonetaryAmount | null;
    acv?: MonetaryAmount | null;
    tcv?: MonetaryAmount | null;
  }): RevenueMetrics {
    return new RevenueMetrics(props);
  }

  getMRR(): MonetaryAmount | null {
    return this.mrr;
  }

  getARR(): MonetaryAmount | null {
    return this.arr;
  }

  getACV(): MonetaryAmount | null {
    return this.acv;
  }

  getTCV(): MonetaryAmount | null {
    return this.tcv;
  }

  getCurrency(): CurrencyCode | null {
    const amounts = [this.mrr, this.arr, this.acv, this.tcv].filter((a): a is MonetaryAmount => a !== null);
    return amounts.length > 0 ? amounts[0].getCurrency() : null;
  }

  hasRecurringRevenue(): boolean {
    return this.mrr !== null || this.arr !== null;
  }

  protected getEqualityComponents(): unknown[] {
    return [
      this.mrr?.getAmount(),
      this.mrr?.getCurrency(),
      this.arr?.getAmount(),
      this.arr?.getCurrency(),
      this.acv?.getAmount(),
      this.acv?.getCurrency(),
      this.tcv?.getAmount(),
      this.tcv?.getCurrency(),
    ];
  }
}