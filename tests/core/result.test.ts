import { describe, expect, it } from 'vitest';
import { buildMatchReport, chainHeading } from '../../src/core/result.ts';
import { createWorld } from '../../src/core/sim.ts';
import type { TrapEvent, WorldState } from '../../src/core/types.ts';

function event(overrides: Partial<TrapEvent> = {}): TrapEvent {
  return {
    id: 1,
    tick: 20,
    chainId: 4,
    parentEventId: null,
    chainLength: 1,
    trapId: 10,
    owner: 1,
    kind: 'bounce',
    target: 0,
    responsibleActor: 1,
    x: 19_200,
    y: 57_600,
    damage: 0,
    pushX: 21_600,
    pushY: 0,
    ...overrides,
  };
}

describe('match result report', () => {
  it('groups events by chain and preserves deterministic event order', () => {
    const base = createWorld(301);
    const world: WorldState = {
      ...base,
      tick: 90,
      result: 'player-win',
      players: [base.players[0], { ...base.players[1], hp: 0 }],
      events: [
        event({ id: 3, chainId: 5, chainLength: 2, kind: 'shock', damage: 18, target: 1, parentEventId: 2 }),
        event({ id: 1, chainId: 4 }),
        event({ id: 2, chainId: 4, chainLength: 2, kind: 'hatch', damage: 26, pushX: 0, parentEventId: 1 }),
      ],
      maxChain: 2,
      shotsFired: [2, 3],
      trapsPlaced: [1, 2],
      trapsDisarmed: [1, 0],
    };

    const report = buildMatchReport(world);
    expect(report.resultLabel).toBe('あなたの勝ち');
    expect(report.resultReason).toBe('CPUの体力が0になりました。');
    expect(report.eventCount).toBe(3);
    expect(report.chains).toHaveLength(2);
    expect(report.chains[0].eventIds).toEqual([1, 2]);
    expect(report.chains[0].damage).toBe(26);
    expect(report.chains[0].description).toContain('ハネ板');
    expect(report.chains[0].description).toContain('パカット床');
    expect(chainHeading(report.chains[1])).toBe('連鎖5・2段・CPUの仕掛け');
  });

  it('explains a timeout draw and reports both players', () => {
    const base = createWorld(302);
    const world: WorldState = {
      ...base,
      tick: 9_000,
      result: 'time-draw',
      players: [
        { ...base.players[0], hp: 55 },
        { ...base.players[1], hp: 55 },
      ],
    };
    const report = buildMatchReport(world);
    expect(report.resultLabel).toBe('引き分け');
    expect(report.resultReason).toBe('時間切れ時の体力が同じでした。');
    expect(report.players[0].hp).toBe(55);
    expect(report.players[1].hp).toBe(55);
    expect(report.chains).toEqual([]);
  });

  it('explains technical invalidation without inventing a winner', () => {
    const base = createWorld(303);
    const report = buildMatchReport({ ...base, result: 'technical-invalid' });
    expect(report.resultLabel).toBe('技術的に無効');
    expect(report.resultReason).toContain('無効');
  });
});
