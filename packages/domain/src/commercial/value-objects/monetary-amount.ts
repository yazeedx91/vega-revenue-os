import { ValueObject } from '../../value-object/value-object';

export type CurrencyCode = string & { readonly __brand: 'CurrencyCode' };

export class MonetaryAmountInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MonetaryAmountInvariantError';
  }
}

export class MonetaryAmount extends ValueObject {
  private readonly amount: number;
  private readonly currency: CurrencyCode;

  private constructor(amount: number, currency: CurrencyCode) {
    super();
    this.amount = amount;
    this.currency = currency;
  }

  static create(amount: number, currency: string): MonetaryAmount {
    if (!Number.isFinite(amount)) {
      throw new MonetaryAmountInvariantError('Amount must be a finite number');
    }
    if (amount < 0) {
      throw new MonetaryAmountInvariantError('Amount cannot be negative');
    }
    if (!currency || currency.trim().length === 0) {
      throw new MonetaryAmountInvariantError('Currency code is required');
    }
    if (currency.length !== 3) {
      throw new MonetaryAmountInvariantError('Currency code must be 3 characters (ISO 4217)');
    }
    return new MonetaryAmount(amount, currency as CurrencyCode);
  }

  getAmount(): number {
    return this.amount;
  }

  getCurrency(): CurrencyCode {
    return this.currency;
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  isPositive(): boolean {
    return this.amount > 0;
  }

  protected getEqualityComponents(): unknown[] {
    return [this.amount, this.currency];
  }

  static add(a: MonetaryAmount, b: MonetaryAmount): MonetaryAmount {
    if (a.currency !== b.currency) {
      throw new MonetaryAmountInvariantError('Cannot add amounts with different currencies');
    }
    return MonetaryAmount.create(a.amount + b.amount, a.currency);
  }

  static subtract(a: MonetaryAmount, b: MonetaryAmount): MonetaryAmount {
    if (a.currency !== b.currency) {
      throw new MonetaryAmountInvariantError('Cannot subtract amounts with different currencies');
    }
    const result = a.amount - b.amount;
    if (result < 0) {
      throw new MonetaryAmountInvariantError('Subtraction result cannot be negative');
    }
    return MonetaryAmount.create(result, a.currency);
  }
}