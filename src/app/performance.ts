export interface MatchPerformanceReport {
  readonly frameSamples: number;
  readonly frameP95Ms: number | null;
  readonly frameP99Ms: number | null;
  readonly frameMaxMs: number | null;
  readonly frameOver20Ms: number;
  readonly frameOver34Ms: number;
  readonly frameOver67Ms: number;
  readonly frameOver100Ms: number;
  readonly frameOver150Ms: number;
  readonly inputSamples: number;
  readonly inputP95Ms: number | null;
  readonly inputMaxMs: number | null;
}

function percentile(values: readonly number[], rank: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank) - 1));
  return sorted[index];
}

function countAbove(values: readonly number[], threshold: number): number {
  return values.reduce((count, value) => count + (value > threshold ? 1 : 0), 0);
}

function countAtLeast(values: readonly number[], threshold: number): number {
  return values.reduce((count, value) => count + (value >= threshold ? 1 : 0), 0);
}

function maxValue(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

export class MatchPerformanceMonitor {
  private active = false;
  private frameIntervals: number[] = [];
  private inputLatencies: number[] = [];
  private lastFrameTimestamp: number | null = null;
  private pendingInputTimestamp: number | null = null;

  public start(): void {
    this.active = true;
    this.frameIntervals = [];
    this.inputLatencies = [];
    this.lastFrameTimestamp = null;
    this.pendingInputTimestamp = null;
  }

  public reset(): void {
    this.active = false;
    this.frameIntervals = [];
    this.inputLatencies = [];
    this.lastFrameTimestamp = null;
    this.pendingInputTimestamp = null;
  }

  public startFrameSegment(): void {
    if (!this.active) return;
    this.lastFrameTimestamp = null;
    this.pendingInputTimestamp = null;
  }

  public markInput(timestamp: number): void {
    if (!this.active || !Number.isFinite(timestamp)) return;
    if (this.pendingInputTimestamp === null) this.pendingInputTimestamp = timestamp;
  }

  public recordFrame(timestamp: number): void {
    if (!this.active || !Number.isFinite(timestamp)) return;
    if (this.lastFrameTimestamp !== null) {
      const interval = timestamp - this.lastFrameTimestamp;
      if (interval >= 0 && Number.isFinite(interval)) this.frameIntervals.push(interval);
    }
    this.lastFrameTimestamp = timestamp;
    if (this.pendingInputTimestamp !== null) {
      const latency = timestamp - this.pendingInputTimestamp;
      if (latency >= 0 && Number.isFinite(latency)) this.inputLatencies.push(latency);
      this.pendingInputTimestamp = null;
    }
  }

  public finish(): MatchPerformanceReport {
    const report = this.snapshot();
    this.active = false;
    this.lastFrameTimestamp = null;
    this.pendingInputTimestamp = null;
    return report;
  }

  public snapshot(): MatchPerformanceReport {
    return {
      frameSamples: this.frameIntervals.length,
      frameP95Ms: percentile(this.frameIntervals, 0.95),
      frameP99Ms: percentile(this.frameIntervals, 0.99),
      frameMaxMs: maxValue(this.frameIntervals),
      frameOver20Ms: countAbove(this.frameIntervals, 20),
      frameOver34Ms: countAbove(this.frameIntervals, 34),
      frameOver67Ms: countAbove(this.frameIntervals, 67),
      frameOver100Ms: countAtLeast(this.frameIntervals, 100),
      frameOver150Ms: countAtLeast(this.frameIntervals, 150),
      inputSamples: this.inputLatencies.length,
      inputP95Ms: percentile(this.inputLatencies, 0.95),
      inputMaxMs: maxValue(this.inputLatencies),
    };
  }
}
