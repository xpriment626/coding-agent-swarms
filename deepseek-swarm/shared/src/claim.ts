import type { CoralSettings } from './env.ts';

export const USD_PER_TOKEN = 0.000001;

/**
 * Coral session claim accounting. No-op unless CORAL_SEND_CLAIMS=1 is set
 * in the session — Coral server logs claims itself when posted through
 * CORAL_API_URL. `noBudget()` is a hook for plugging in a real ceiling;
 * left false by default to keep parity with the Kotlin side.
 */
export class ClaimHandler {
  private totalClaimed = 0;

  constructor(private readonly coral: CoralSettings | null) {}

  noBudget(): boolean {
    return false;
  }

  async claim(cost: number): Promise<void> {
    if (!this.coral || this.coral.sendClaims !== 1) return;
    this.totalClaimed += cost;
  }

  get total(): number {
    return this.totalClaimed;
  }
}
