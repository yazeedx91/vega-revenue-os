import { ValueObject } from '../../value-object/value-object';
import { MonetaryAmount, CurrencyCode } from './monetary-amount';
import { Probability } from './probability';

export class EconomicValueInputs extends ValueObject {
  private readonly potentialContractValue: MonetaryAmount;
  private readonly probabilityOfSuccess: Probability;
  private readonly retentionValue: MonetaryAmount | null;
  private readonly expansionPotential: MonetaryAmount | null;
  private readonly acquisitionCost: MonetaryAmount | null;
  private readonly executionCost: MonetaryAmount | null;
  private readonly deliveryRiskAdjustment: number | null;
  private readonly otherAdjustments: MonetaryAmount | null;

  private constructor(props: {
    potentialContractValue: MonetaryAmount;
    probabilityOfSuccess: Probability;
    retentionValue?: MonetaryAmount | null;
    expansionPotential?: MonetaryAmount | null;
    acquisitionCost?: MonetaryAmount | null;
    executionCost?: MonetaryAmount | null;
    deliveryRiskAdjustment?: number | null;
    otherAdjustments?: MonetaryAmount | null;
  }) {
    super();
    this.potentialContractValue = props.potentialContractValue;
    this.probabilityOfSuccess = props.probabilityOfSuccess;
    this.retentionValue = props.retentionValue ?? null;
    this.expansionPotential = props.expansionPotential ?? null;
    this.acquisitionCost = props.acquisitionCost ?? null;
    this.executionCost = props.executionCost ?? null;
    this.deliveryRiskAdjustment = props.deliveryRiskAdjustment ?? null;
    this.otherAdjustments = props.otherAdjustments ?? null;
    this.validateCurrencyConsistency();
    this.validateRiskAdjustment();
  }

  private validateCurrencyConsistency(): void {
    const currency = this.potentialContractValue.getCurrency();
    const monetaryFields = [
      this.retentionValue,
      this.expansionPotential,
      this.acquisitionCost,
      this.executionCost,
      this.otherAdjustments,
    ].filter((m): m is MonetaryAmount => m !== null);

    for (const field of monetaryFields) {
      if (field.getCurrency() !== currency) {
        throw new Error('All monetary values must use the same currency');
      }
    }
  }

  private validateRiskAdjustment(): void {
    if (this.deliveryRiskAdjustment !== null) {
      if (!Number.isFinite(this.deliveryRiskAdjustment)) {
        throw new Error('Delivery risk adjustment must be a finite number');
      }
      if (this.deliveryRiskAdjustment < 0 || this.deliveryRiskAdjustment > 1) {
        throw new Error('Delivery risk adjustment must be between 0 and 1');
      }
    }
  }

  static create(props: {
    potentialContractValue: MonetaryAmount;
    probabilityOfSuccess: Probability;
    retentionValue?: MonetaryAmount | null;
    expansionPotential?: MonetaryAmount | null;
    acquisitionCost?: MonetaryAmount | null;
    executionCost?: MonetaryAmount | null;
    deliveryRiskAdjustment?: number | null;
    otherAdjustments?: MonetaryAmount | null;
  }): EconomicValueInputs {
    return new EconomicValueInputs(props);
  }

  getPotentialContractValue(): MonetaryAmount {
    return this.potentialContractValue;
  }

  getProbabilityOfSuccess(): Probability {
    return this.probabilityOfSuccess;
  }

  getRetentionValue(): MonetaryAmount | null {
    return this.retentionValue;
  }

  getExpansionPotential(): MonetaryAmount | null {
    return this.expansionPotential;
  }

  getAcquisitionCost(): MonetaryAmount | null {
    return this.acquisitionCost;
  }

  getExecutionCost(): MonetaryAmount | null {
    return this.executionCost;
  }

  getDeliveryRiskAdjustment(): number | null {
    return this.deliveryRiskAdjustment;
  }

  getOtherAdjustments(): MonetaryAmount | null {
    return this.otherAdjustments;
  }

  getCurrency(): CurrencyCode {
    return this.potentialContractValue.getCurrency();
  }

  protected getEqualityComponents(): unknown[] {
    return [
      this.potentialContractValue.getAmount(),
      this.potentialContractValue.getCurrency(),
      this.probabilityOfSuccess.getValue(),
      this.retentionValue?.getAmount(),
      this.retentionValue?.getCurrency(),
      this.expansionPotential?.getAmount(),
      this.expansionPotential?.getCurrency(),
      this.acquisitionCost?.getAmount(),
      this.acquisitionCost?.getCurrency(),
      this.executionCost?.getAmount(),
      this.executionCost?.getCurrency(),
      this.deliveryRiskAdjustment,
      this.otherAdjustments?.getAmount(),
      this.otherAdjustments?.getCurrency(),
    ];
  }
}