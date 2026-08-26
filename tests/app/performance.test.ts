import { describe, expect, it } from 'vitest';
import { MatchPerformanceMonitor } from '../../src/app/performance.ts';

describe('MatchPerformanceMonitor', () => {
  it('summarizes frame intervals and input-to-next-frame latency', () => {
    const monitor = new MatchPerformanceMonitor();
    monitor.start();
    monitor.recordFrame(0);
    monitor.markInput(15);
    monitor.recordFrame(20);
    monitor.recordFrame(54);
    monitor.recordFrame(154);

    const report = monitor.finish();

    expect(report.frameSamples).toBe(3);
    expect(report.frameP95Ms).toBe(100);
    expect(report.frameP99Ms).toBe(100);
    expect(report.frameMaxMs).toBe(100);
    expect(report.frameOver20Ms).toBe(2);
    expect(report.frameOver34Ms).toBe(1);
    expect(report.frameOver67Ms).toBe(1);
    expect(report.frameOver100Ms).toBe(1);
    expect(report.frameOver150Ms).toBe(0);
    expect(report.inputSamples).toBe(1);
    expect(report.inputP95Ms).toBe(5);
    expect(report.inputMaxMs).toBe(5);
  });

  it('does not count time spent between paused frame segments', () => {
    const monitor = new MatchPerformanceMonitor();
    monitor.start();
    monitor.recordFrame(0);
    monitor.recordFrame(16);
    monitor.startFrameSegment();
    monitor.recordFrame(1000);
    monitor.recordFrame(1016);

    const report = monitor.finish();

    expect(report.frameSamples).toBe(2);
    expect(report.frameMaxMs).toBe(16);
  });
});
