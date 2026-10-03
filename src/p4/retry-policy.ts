export type RetryKind = "transient" | "permission" | "validation" | "cancelled" | "unknown";

export type RetryDecision = "retry" | "stop";

/** Bounded retry policy for P4; product operations own idempotency outside this helper. */
export class RetryPolicy {
  private attempts = 0;

  constructor(private readonly maxAttempts: number) {
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  }

  decide(kind: RetryKind): RetryDecision {
    if (kind !== "transient" || this.attempts >= this.maxAttempts) return "stop";
    this.attempts += 1;
    return "retry";
  }

  get usedAttempts(): number {
    return this.attempts;
  }
}

/** Counts repeated tool-failure fingerprints and stops after a fixed limit. */
export class NoProgressTracker {
  private readonly counts = new Map<string, number>();

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("no-progress limit must be a positive integer");
  }

  observe(fingerprint: string): "continue" | "stop" {
    const next = (this.counts.get(fingerprint) ?? 0) + 1;
    this.counts.set(fingerprint, next);
    return next >= this.limit ? "stop" : "continue";
  }
}
