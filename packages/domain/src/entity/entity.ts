export abstract class Entity<TId extends string = string> {
  protected constructor(public readonly id: TId) {}
}
