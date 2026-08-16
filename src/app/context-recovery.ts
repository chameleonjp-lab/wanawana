export interface ContextLossOutcome {
  readonly activeMatch: boolean;
  readonly lossCount: number;
  readonly invalid: boolean;
}

/**
 * Keeps GPU context recovery rules independent from PixiJS and the battle loop.
 * A restored context still requires an explicit user resume before ticks run.
 */
export class ContextRecovery {
  private activeMatch = false;
  private pending = false;
  private lossCount = 0;

  public startMatch(): void {
    this.activeMatch = true;
    this.pending = false;
    this.lossCount = 0;
  }

  public endMatch(): void {
    this.activeMatch = false;
    this.pending = false;
    this.lossCount = 0;
  }

  public loseContext(): ContextLossOutcome {
    if (!this.activeMatch) {
      return { activeMatch: false, lossCount: this.lossCount, invalid: false };
    }
    this.lossCount += 1;
    this.pending = true;
    return {
      activeMatch: true,
      lossCount: this.lossCount,
      invalid: this.lossCount >= 2,
    };
  }

  public markRestored(): boolean {
    if (!this.activeMatch || !this.pending || this.lossCount >= 2) return false;
    this.pending = false;
    return true;
  }

  public markResumed(): boolean {
    if (!this.activeMatch || this.pending) return false;
    return true;
  }

  public get isPending(): boolean {
    return this.pending;
  }

  public get canResume(): boolean {
    return this.activeMatch && !this.pending;
  }
}
