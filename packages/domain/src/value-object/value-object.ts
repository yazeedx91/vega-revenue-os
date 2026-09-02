export abstract class ValueObject {
  protected abstract getEqualityComponents(): unknown[];

  equals(other: this): boolean {
    if (!(other instanceof ValueObject)) {
      return false;
    }
    const a = this.getEqualityComponents();
    const b = other.getEqualityComponents();
    if (a.length !== b.length) {
      return false;
    }
    return a.every((value, index) => JSON.stringify(value) === JSON.stringify(b[index]));
  }
}
