export class RequestBudgetExceeded extends Error {
  constructor(readonly maxRequests: number) {
    super(`P4 request budget exceeded: ${maxRequests}`);
    this.name = "RequestBudgetExceeded";
  }
}

/** Deterministic provider-request counter for P4; caller decides how to persist the stop. */
export class RequestBudget {
  private count = 0;

  constructor(private readonly maxRequests: number) {
    if (!Number.isInteger(maxRequests) || maxRequests <= 0) throw new Error("maxRequests must be a positive integer");
  }

  claim(): number {
    if (this.count >= this.maxRequests) throw new RequestBudgetExceeded(this.maxRequests);
    this.count += 1;
    return this.count;
  }

  get used(): number {
    return this.count;
  }
}
