/** Raised when an effect cannot be applied; the surrounding transaction is rolled back. */
export class EffectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EffectError";
  }
}

export class InsufficientResourcesError extends EffectError {
  constructor(message: string) {
    super(message);
    this.name = "InsufficientResourcesError";
  }
}
