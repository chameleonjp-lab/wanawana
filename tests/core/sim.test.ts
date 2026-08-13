import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT_CELLS, ARENA_WIDTH_CELLS, MATCH_TICKS } from '../../src/core/types.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';

describe('fixed simulation', () => {
  it('replays the same accepted commands to the same hash', () => {
    let first = createWorld(42);
    let second = createWorld(42);

    for (let tick = 0; tick < 120; tick += 1) {
      const command = { moveX: tick % 3 === 0 ? 1 : 0, moveY: tick % 5 === 0 ? -1 : 0, fire: tick % 11 === 0 } as const;
      first = advanceWorld(first, command);
      second = advanceWorld(second, command);
    }

    expect(first.lastHash).toBe(second.lastHash);
    expect(first).toEqual(second);
  });

  it('keeps players inside the arena', () => {
    let world = createWorld();
    for (let tick = 0; tick < 2_000; tick += 1) {
      world = advanceWorld(world, { moveX: 1, moveY: 1 });
    }

    expect(world.players[0].x).toBeLessThanOrEqual(ARENA_WIDTH_CELLS * 9_600);
    expect(world.players[0].y).toBeLessThanOrEqual(ARENA_HEIGHT_CELLS * 9_600);
    expect(world.players[0].x).toBeGreaterThan(0);
    expect(world.players[0].y).toBeGreaterThan(0);
  });

  it('ends exactly at the configured match length', () => {
    let world = createWorld();
    for (let tick = 0; tick < MATCH_TICKS - 1; tick += 1) {
      world = advanceWorld(world);
    }
    expect(world.phase).toBe('battle');
    world = advanceWorld(world);
    expect(world.tick).toBe(MATCH_TICKS);
    expect(world.phase).toBe('result');
  });
});
