import { describe, expect, it } from 'vitest';
import {
  RESUME_MAX_AGE_MS,
  createMatchResume,
  readMatchResume,
  serializeMatchResume,
} from '../../src/core/resume.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';
import { BALANCE_CONFIG_HASH } from '../../src/core/balance.ts';
import { hashWorld } from '../../src/core/hash.ts';
import { cellCenterUnits } from '../../src/core/fixed.ts';

function withRehashedWorld(
  saved: ReturnType<typeof createMatchResume>,
  world: ReturnType<typeof createWorld>,
) {
  return {
    ...saved,
    world: {
      ...world,
      lastHash: hashWorld(world),
    },
  };
}

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
    world = {
      ...world,
      players: [{ ...world.players[0], x: cellCenterUnits(4), y: cellCenterUnits(6) }, world.players[1]],
    };
    world = advanceWorld(world, {
      placeTrap: 'shock',
      trapCellX: 4,
      trapCellY: 6,
    }, {});
    for (let tick = 0; tick < 100 && world.events.length === 0; tick += 1) {
      world = advanceWorld(world, tick < 60 ? {} : { moveX: 1 }, {});
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

  it('rejects pre-PR02 snapshots before resuming their state', () => {
    const saved = createMatchResume(createWorld(101), 'normal', 31_000);
    const legacy = { ...saved, engineVersion: 'wanawana-resume-v5' };

    // Keep all state and hashes valid to isolate the physics-version boundary.
    expect(readMatchResume(JSON.stringify(legacy), 31_001)).toBeNull();
    expect(readMatchResume(serializeMatchResume(saved), 31_001)).toEqual(saved);
  });

  it('resumes the result of simultaneous blasts without changing subsequent physics', () => {
    const initial = createWorld(102, ['bounce', 'shock', 'bomb'], ['bounce', 'shock', 'bomb']);
    let uninterrupted = advanceWorld({
      ...initial,
      players: [{ ...initial.players[0], x: 45_120 }, initial.players[1]],
      traps: ([0, 1] as const).map((owner) => ({
        id: owner + 2,
        owner,
        kind: 'bomb' as const,
        direction: 0 as const,
        cellX: owner + 3,
        cellY: 6,
        armingTicks: 0,
        remainingTicks: 100,
        triggerTicks: 1,
        discoveredBy: [true, true] as const,
      })),
      nextEntityId: 4,
    });
    expect(uninterrupted.players[0].hp).toBe(60);
    const saved = createMatchResume(uninterrupted, 'normal', 32_000);
    const restored = readMatchResume(serializeMatchResume(saved), 32_001);
    expect(restored).not.toBeNull();
    if (!restored) return;

    let resumed = restored.world;
    for (let tick = 0; tick < 60; tick += 1) {
      const input = { moveY: -1 as const, fire: tick === 12 };
      uninterrupted = advanceWorld(uninterrupted, input);
      resumed = advanceWorld(resumed, input);
      expect(resumed.lastHash).toBe(uninterrupted.lastHash);
    }
    expect(resumed).toEqual(uninterrupted);
  });

  it('rejects duplicate entities, dangling references, and future event parents', () => {
    const saved = createMatchResume(createWorld(100), 'normal', 40_000);
    const activeTrap = {
      id: 2,
      owner: 0 as const,
      kind: 'shock' as const,
      direction: 0 as const,
      cellX: 3,
      cellY: 3,
      armingTicks: 0,
      remainingTicks: 100,
      discoveredBy: [true, false] as const,
      triggerTicks: 0,
      effectTicks: 0,
    };
    const activeShot = {
      id: 2,
      owner: 1 as const,
      x: 7 * 9_600,
      y: 6 * 9_600,
      vx: -1_600,
      vy: 0,
      travelledUnits: 0,
    };
    const duplicateEntity = withRehashedWorld(saved, {
      ...saved.world,
      traps: [activeTrap],
      shots: [activeShot],
      nextEntityId: 3,
    });
    expect(readMatchResume(serializeMatchResume(duplicateEntity), 40_001)).toBeNull();

    const reservedEntityId = withRehashedWorld(saved, {
      ...saved.world,
      traps: [{ ...activeTrap, id: 1 }],
      nextEntityId: 2,
    });
    expect(readMatchResume(serializeMatchResume(reservedEntityId), 40_001)).toBeNull();

    const danglingInvestigation = withRehashedWorld(saved, {
      ...saved.world,
      players: [
        {
          ...saved.world.players[0],
          investigation: {
            targetTrapId: 999,
            mode: 'reveal',
            startX: saved.world.players[0].x,
            startY: saved.world.players[0].y,
            remainingTicks: 10,
          },
        },
        saved.world.players[1],
      ],
    });
    expect(readMatchResume(serializeMatchResume(danglingInvestigation), 40_001)).toBeNull();

    const futureParent = withRehashedWorld(saved, {
      ...saved.world,
      events: [{
        id: 1,
        tick: 0,
        chainId: 1,
        parentEventId: 99,
        chainLength: 1,
        trapId: 2,
        owner: 0,
        kind: 'shock',
        target: 1,
        responsibleActor: 0,
        x: 0,
        y: 0,
        damage: 18,
        pushX: 0,
        pushY: 0,
      }],
      nextEventId: 2,
      nextChainId: 2,
      maxChain: 1,
    });
    expect(readMatchResume(serializeMatchResume(futureParent), 40_001)).toBeNull();
  });
});
