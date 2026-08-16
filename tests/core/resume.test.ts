import { describe, expect, it } from 'vitest';
import {
  RESUME_MAX_AGE_MS,
  createMatchResume,
  readMatchResume,
  serializeMatchResume,
} from '../../src/core/resume.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import { BALANCE_CONFIG_HASH } from '../../src/core/balance.ts';

describe('interrupted match resume records', () => {
  it('round-trips a validated battle state with its difficulty and hash', () => {
    let world = createWorld(1234, ['bounce', 'shock', 'hatch'], ['bounce', 'shock', 'hatch'], 'crossroads');
    for (let tick = 0; tick < 12; tick += 1) {
      world = advanceWorld(world, { moveX: 1 }, { moveX: -1 });
    }

    const saved = createMatchResume(world, 'hard', 10_000);
    const restored = readMatchResume(serializeMatchResume(saved), 10_500);
    expect(restored).toEqual(saved);
    expect(restored?.world.lastHash).toBe(world.lastHash);
    expect(restored?.difficulty).toBe('hard');
    expect(saved.balanceConfigHash).toBe(BALANCE_CONFIG_HASH);
  });

  it('accepts a state that already contains trap events and delayed fields', () => {
    let world = createWorld(4321);
    world = advanceWorld(world, {
      placeTrap: 'shock',
      trapCellX: 5,
      trapCellY: 6,
    }, {});
    for (let tick = 0; tick < 100 && world.events.length === 0; tick += 1) {
      world = advanceWorld(world, { moveX: 1 }, {});
    }
    expect(world.events.length).toBeGreaterThan(0);
    const saved = createMatchResume(world, 'normal', 15_000);
    expect(readMatchResume(serializeMatchResume(saved), 15_500)).toEqual(saved);
  });

  it('rejects malformed, stale, future, incompatible, and tampered records', () => {
    const world = createWorld(77);
    const saved = createMatchResume(world, 'normal', 20_000);
    const raw = serializeMatchResume(saved);

    expect(readMatchResume('{not-json', 20_001)).toBeNull();
    expect(readMatchResume(raw, 20_000 + RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(readMatchResume(raw, 19_999)).toBeNull();
    expect(readMatchResume(JSON.stringify({ ...saved, schemaVersion: 2 }), 20_001)).toBeNull();
    expect(readMatchResume(JSON.stringify({
      ...saved,
      world: { ...saved.world, lastHash: '00000000' },
    }), 20_001)).toBeNull();
  });

  it('does not accept a finished world or an oversized payload', () => {
    const world = createWorld(99);
    const saved = createMatchResume(world, 'easy', 30_000);
    const finished = { ...saved, world: { ...saved.world, phase: 'result', result: 'player-win' } };
    expect(readMatchResume(JSON.stringify(finished), 30_001)).toBeNull();
    expect(readMatchResume(`${'x'.repeat(2_000_001)}`, 30_001)).toBeNull();
  });
});
