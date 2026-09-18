import { Probability, ProbabilityInvariantError } from '../value-objects/probability';

describe('Probability', () => {
  describe('creation', () => {
    it('should create valid probability', () => {
      const prob = Probability.create(0.5);
      expect(prob.getValue()).toBe(0.5);
    });

    it('should accept probability of 0', () => {
      const prob = Probability.create(0);
      expect(prob.getValue()).toBe(0);
      expect(prob.isImpossible()).toBe(true);
    });

    it('should accept probability of 1', () => {
      const prob = Probability.create(1);
      expect(prob.getValue()).toBe(1);
      expect(prob.isCertain()).toBe(true);
    });

    it('should reject probabilities below 0', () => {
      expect(() => Probability.create(-0.1)).toThrow(ProbabilityInvariantError);
      expect(() => Probability.create(-0.1)).toThrow('Probability must be between 0 and 1');
    });

    it('should reject probabilities above 1', () => {
      expect(() => Probability.create(1.1)).toThrow(ProbabilityInvariantError);
      expect(() => Probability.create(1.1)).toThrow('Probability must be between 0 and 1');
    });

    it('should reject infinite probabilities', () => {
      expect(() => Probability.create(Infinity)).toThrow(ProbabilityInvariantError);
    });

    it('should reject NaN probabilities', () => {
      expect(() => Probability.create(NaN)).toThrow(ProbabilityInvariantError);
    });
  });

  describe('percentage conversion', () => {
    it('should create from percentage', () => {
      const prob = Probability.fromPercentage(50);
      expect(prob.getValue()).toBe(0.5);
    });

    it('should convert to percentage', () => {
      const prob = Probability.create(0.75);
      expect(prob.toPercentage()).toBe(75);
    });

    it('should reject percentages below 0', () => {
      expect(() => Probability.fromPercentage(-1)).toThrow(ProbabilityInvariantError);
    });

    it('should reject percentages above 100', () => {
      expect(() => Probability.fromPercentage(101)).toThrow(ProbabilityInvariantError);
    });
  });

  describe('helper methods', () => {
    it('should identify certain probabilities', () => {
      const certain = Probability.create(1);
      const uncertain = Probability.create(0.5);
      expect(certain.isCertain()).toBe(true);
      expect(uncertain.isCertain()).toBe(false);
    });

    it('should identify impossible probabilities', () => {
      const impossible = Probability.create(0);
      const possible = Probability.create(0.5);
      expect(impossible.isImpossible()).toBe(true);
      expect(possible.isImpossible()).toBe(false);
    });

    it('should identify likely probabilities', () => {
      const likely = Probability.create(0.75);
      const unlikely = Probability.create(0.25);
      expect(likely.isLikely()).toBe(true);
      expect(unlikely.isLikely()).toBe(false);
    });

    it('should identify unlikely probabilities', () => {
      const unlikely = Probability.create(0.25);
      const likely = Probability.create(0.75);
      expect(unlikely.isUnlikely()).toBe(true);
      expect(likely.isUnlikely()).toBe(false);
    });

    it('should treat 0.5 as unlikely', () => {
      const middle = Probability.create(0.5);
      expect(middle.isLikely()).toBe(false);
      expect(middle.isUnlikely()).toBe(true);
    });
  });

  describe('value object equality', () => {
    it('should consider equal probabilities as equal', () => {
      const a = Probability.create(0.5);
      const b = Probability.create(0.5);
      expect(a.equals(b)).toBe(true);
    });

    it('should consider different probabilities as not equal', () => {
      const a = Probability.create(0.5);
      const b = Probability.create(0.75);
      expect(a.equals(b)).toBe(false);
    });
  });
});