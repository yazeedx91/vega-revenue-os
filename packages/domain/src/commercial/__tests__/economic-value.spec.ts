import { MonetaryAmount } from '../value-objects/monetary-amount';
import { Probability } from '../value-objects/probability';
import { EconomicValueInputs } from '../value-objects/economic-value';

describe('EconomicValueInputs', () => {
  describe('creation', () => {
    it('should create valid economic value inputs', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const inputs = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
      });
      expect(inputs.getPotentialContractValue()).toEqual(potentialValue);
      expect(inputs.getProbabilityOfSuccess()).toEqual(probability);
    });

    it('should accept optional fields', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const retentionValue = MonetaryAmount.create(50000, 'USD');
      const expansionPotential = MonetaryAmount.create(20000, 'USD');
      const inputs = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
        retentionValue,
        expansionPotential,
      });
      expect(inputs.getRetentionValue()).toEqual(retentionValue);
      expect(inputs.getExpansionPotential()).toEqual(expansionPotential);
    });

    it('should reject mixed currencies', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const retentionValue = MonetaryAmount.create(50000, 'EUR');
      expect(() =>
        EconomicValueInputs.create({
          potentialContractValue: potentialValue,
          probabilityOfSuccess: probability,
          retentionValue,
        }),
      ).toThrow('All monetary values must use the same currency');
    });

    it('should reject invalid risk adjustment below 0', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      expect(() =>
        EconomicValueInputs.create({
          potentialContractValue: potentialValue,
          probabilityOfSuccess: probability,
          deliveryRiskAdjustment: -0.1,
        }),
      ).toThrow('Delivery risk adjustment must be between 0 and 1');
    });

    it('should reject invalid risk adjustment above 1', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      expect(() =>
        EconomicValueInputs.create({
          potentialContractValue: potentialValue,
          probabilityOfSuccess: probability,
          deliveryRiskAdjustment: 1.5,
        }),
      ).toThrow('Delivery risk adjustment must be between 0 and 1');
    });

    it('should accept valid risk adjustment', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const inputs = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
        deliveryRiskAdjustment: 0.3,
      });
      expect(inputs.getDeliveryRiskAdjustment()).toBe(0.3);
    });
  });

  describe('value object equality', () => {
    it('should consider equal inputs as equal', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const a = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
      });
      const b = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
      });
      expect(a.equals(b)).toBe(true);
    });

    it('should consider different inputs as not equal', () => {
      const potentialValue1 = MonetaryAmount.create(100000, 'USD');
      const probability1 = Probability.create(0.5);
      const potentialValue2 = MonetaryAmount.create(150000, 'USD');
      const probability2 = Probability.create(0.75);
      const a = EconomicValueInputs.create({
        potentialContractValue: potentialValue1,
        probabilityOfSuccess: probability1,
      });
      const b = EconomicValueInputs.create({
        potentialContractValue: potentialValue2,
        probabilityOfSuccess: probability2,
      });
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should return currency from potential contract value', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const inputs = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
      });
      expect(inputs.getCurrency()).toBe('USD');
    });

    it('should return null for optional fields when not provided', () => {
      const potentialValue = MonetaryAmount.create(100000, 'USD');
      const probability = Probability.create(0.5);
      const inputs = EconomicValueInputs.create({
        potentialContractValue: potentialValue,
        probabilityOfSuccess: probability,
      });
      expect(inputs.getRetentionValue()).toBeNull();
      expect(inputs.getExpansionPotential()).toBeNull();
      expect(inputs.getAcquisitionCost()).toBeNull();
      expect(inputs.getExecutionCost()).toBeNull();
      expect(inputs.getDeliveryRiskAdjustment()).toBeNull();
      expect(inputs.getOtherAdjustments()).toBeNull();
    });
  });
});