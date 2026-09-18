import { MonetaryAmount, MonetaryAmountInvariantError } from '../value-objects/monetary-amount';

describe('MonetaryAmount', () => {
  describe('creation', () => {
    it('should create valid monetary amount', () => {
      const amount = MonetaryAmount.create(100, 'USD');
      expect(amount.getAmount()).toBe(100);
      expect(amount.getCurrency()).toBe('USD');
    });

    it('should reject negative amounts', () => {
      expect(() => MonetaryAmount.create(-100, 'USD')).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.create(-100, 'USD')).toThrow('Amount cannot be negative');
    });

    it('should reject infinite amounts', () => {
      expect(() => MonetaryAmount.create(Infinity, 'USD')).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.create(Infinity, 'USD')).toThrow('Amount must be a finite number');
    });

    it('should reject NaN amounts', () => {
      expect(() => MonetaryAmount.create(NaN, 'USD')).toThrow(MonetaryAmountInvariantError);
    });

    it('should reject empty currency', () => {
      expect(() => MonetaryAmount.create(100, '')).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.create(100, '')).toThrow('Currency code is required');
    });

    it('should reject currency codes that are not 3 characters', () => {
      expect(() => MonetaryAmount.create(100, 'US')).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.create(100, 'USDD')).toThrow(MonetaryAmountInvariantError);
    });

    it('should accept zero amount', () => {
      const amount = MonetaryAmount.create(0, 'USD');
      expect(amount.getAmount()).toBe(0);
      expect(amount.isZero()).toBe(true);
    });
  });

  describe('operations', () => {
    it('should add amounts with same currency', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(50, 'USD');
      const result = MonetaryAmount.add(a, b);
      expect(result.getAmount()).toBe(150);
      expect(result.getCurrency()).toBe('USD');
    });

    it('should reject adding amounts with different currencies', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(50, 'EUR');
      expect(() => MonetaryAmount.add(a, b)).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.add(a, b)).toThrow('Cannot add amounts with different currencies');
    });

    it('should subtract amounts with same currency', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(50, 'USD');
      const result = MonetaryAmount.subtract(a, b);
      expect(result.getAmount()).toBe(50);
      expect(result.getCurrency()).toBe('USD');
    });

    it('should reject subtracting amounts with different currencies', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(50, 'EUR');
      expect(() => MonetaryAmount.subtract(a, b)).toThrow(MonetaryAmountInvariantError);
    });

    it('should reject subtraction resulting in negative amount', () => {
      const a = MonetaryAmount.create(50, 'USD');
      const b = MonetaryAmount.create(100, 'USD');
      expect(() => MonetaryAmount.subtract(a, b)).toThrow(MonetaryAmountInvariantError);
      expect(() => MonetaryAmount.subtract(a, b)).toThrow('Subtraction result cannot be negative');
    });
  });

  describe('value object equality', () => {
    it('should consider equal amounts as equal', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(100, 'USD');
      expect(a.equals(b)).toBe(true);
    });

    it('should consider different amounts as not equal', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(50, 'USD');
      expect(a.equals(b)).toBe(false);
    });

    it('should consider different currencies as not equal', () => {
      const a = MonetaryAmount.create(100, 'USD');
      const b = MonetaryAmount.create(100, 'EUR');
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should identify zero amounts', () => {
      const zero = MonetaryAmount.create(0, 'USD');
      const positive = MonetaryAmount.create(100, 'USD');
      expect(zero.isZero()).toBe(true);
      expect(positive.isZero()).toBe(false);
    });

    it('should identify positive amounts', () => {
      const zero = MonetaryAmount.create(0, 'USD');
      const positive = MonetaryAmount.create(100, 'USD');
      expect(positive.isPositive()).toBe(true);
      expect(zero.isPositive()).toBe(false);
    });
  });
});