import { MonetaryAmount } from '../value-objects/monetary-amount';
import { RevenueMetrics, RevenueMetricsInvariantError } from '../value-objects/revenue-metrics';

describe('RevenueMetrics', () => {
  describe('creation', () => {
    it('should create valid revenue metrics', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const arr = MonetaryAmount.create(120000, 'USD');
      const metrics = RevenueMetrics.create({ mrr, arr });
      expect(metrics.getMRR()).toEqual(mrr);
      expect(metrics.getARR()).toEqual(arr);
    });

    it('should accept null values', () => {
      const metrics = RevenueMetrics.create({});
      expect(metrics.getMRR()).toBeNull();
      expect(metrics.getARR()).toBeNull();
      expect(metrics.getACV()).toBeNull();
      expect(metrics.getTCV()).toBeNull();
    });

    it('should reject mixed currencies', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const arr = MonetaryAmount.create(120000, 'EUR');
      expect(() => RevenueMetrics.create({ mrr, arr })).toThrow(RevenueMetricsInvariantError);
      expect(() => RevenueMetrics.create({ mrr, arr })).toThrow('All revenue metrics must use the same currency');
    });

    it('should enforce currency consistency across all fields', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const arr = MonetaryAmount.create(120000, 'USD');
      const acv = MonetaryAmount.create(150000, 'USD');
      const tcv = MonetaryAmount.create(200000, 'USD');
      const metrics = RevenueMetrics.create({ mrr, arr, acv, tcv });
      expect(metrics.getCurrency()).toBe('USD');
    });
  });

  describe('value object equality', () => {
    it('should consider equal metrics as equal', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const arr = MonetaryAmount.create(120000, 'USD');
      const a = RevenueMetrics.create({ mrr, arr });
      const b = RevenueMetrics.create({ mrr, arr });
      expect(a.equals(b)).toBe(true);
    });

    it('should consider different metrics as not equal', () => {
      const mrr1 = MonetaryAmount.create(10000, 'USD');
      const arr1 = MonetaryAmount.create(120000, 'USD');
      const mrr2 = MonetaryAmount.create(15000, 'USD');
      const arr2 = MonetaryAmount.create(180000, 'USD');
      const a = RevenueMetrics.create({ mrr: mrr1, arr: arr1 });
      const b = RevenueMetrics.create({ mrr: mrr2, arr: arr2 });
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should identify recurring revenue', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const metrics = RevenueMetrics.create({ mrr });
      expect(metrics.hasRecurringRevenue()).toBe(true);
    });

    it('should identify no recurring revenue', () => {
      const acv = MonetaryAmount.create(150000, 'USD');
      const metrics = RevenueMetrics.create({ acv });
      expect(metrics.hasRecurringRevenue()).toBe(false);
    });

    it('should return currency when metrics exist', () => {
      const mrr = MonetaryAmount.create(10000, 'USD');
      const metrics = RevenueMetrics.create({ mrr });
      expect(metrics.getCurrency()).toBe('USD');
    });

    it('should return null currency when no metrics exist', () => {
      const metrics = RevenueMetrics.create({});
      expect(metrics.getCurrency()).toBeNull();
    });
  });
});