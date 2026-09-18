import { ValueObject } from '../../value-object/value-object';

export class ProbabilityInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbabilityInvariantError';
  }
}

export class Probability extends ValueObject {
  private readonly value: number;

  private constructor(value: number) {
    super();
    this.value = value;
  }

  static create(value: number): Probability {
    if (!Number.isFinite(value)) {
      throw new ProbabilityInvariantError('Probability must be a finite number');
    }
    if (value < 0 || value > 1) {
      throw new ProbabilityInvariantError('Probability must be between 0 and 1');
    }
    return new Probability(value);
  }

  getValue(): number {
    return this.value;
  }

  isCertain(): boolean {
    return this.value === 1;
  }

  isImpossible(): boolean {
    return this.value === 0;
  }

  isLikely(): boolean {
    return this.value > 0.5;
  }

  isUnlikely(): boolean {
    return this.value <= 0.5;
  }

  protected getEqualityComponents(): unknown[] {
    return [this.value];
  }

  static fromPercentage(percentage: number): Probability {
    if (!Number.isFinite(percentage)) {
      throw new ProbabilityInvariantError('Percentage must be a finite number');
    }
    if (percentage < 0 || percentage > 100) {
      throw new ProbabilityInvariantError('Percentage must be between 0 and 100');
    }
    return Probability.create(percentage / 100);
  }

  toPercentage(): number {
    return this.value * 100;
  }
}