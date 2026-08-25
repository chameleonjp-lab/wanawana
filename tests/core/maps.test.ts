import { describe, expect, it } from 'vitest';
import { getMapDefinition, spawnCellFor } from '../../src/core/maps.ts';
import { cellCenterUnits, snapToCell } from '../../src/core/fixed.ts';
import { createWorld } from '../../src/core/sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  DEFAULT_MAP_ID,
  MAP_IDS,
} from '../../src/core/types.ts';

describe('deterministic maps', () => {
  it('defines three distinct, in-bounds spawn layouts', () => {
    const signatures = new Set<string>();

    for (const mapId of MAP_IDS) {
      const map = getMapDefinition(mapId);
      const playerSpawn = spawnCellFor(mapId, 0);
      const cpuSpawn = spawnCellFor(mapId, 1);
      expect(playerSpawn[0]).toBeGreaterThanOrEqual(0);
      expect(playerSpawn[0]).toBeLessThan(ARENA_WIDTH_CELLS);
      expect(playerSpawn[1]).toBeGreaterThanOrEqual(0);
      expect(playerSpawn[1]).toBeLessThan(ARENA_HEIGHT_CELLS);
      expect(cpuSpawn[0]).toBeGreaterThanOrEqual(0);
      expect(cpuSpawn[0]).toBeLessThan(ARENA_WIDTH_CELLS);
      expect(cpuSpawn[1]).toBeGreaterThanOrEqual(0);
      expect(cpuSpawn[1]).toBeLessThan(ARENA_HEIGHT_CELLS);
      expect(playerSpawn).not.toEqual(cpuSpawn);
      for (const obstacle of map.obstacleCells) {
        expect(obstacle.cellX).toBeGreaterThanOrEqual(0);
        expect(obstacle.cellX).toBeLessThan(ARENA_WIDTH_CELLS);
        expect(obstacle.cellY).toBeGreaterThanOrEqual(0);
        expect(obstacle.cellY).toBeLessThan(ARENA_HEIGHT_CELLS);
        expect(obstacle).not.toEqual({ cellX: playerSpawn[0], cellY: playerSpawn[1] });
        expect(obstacle).not.toEqual({ cellX: cpuSpawn[0], cellY: cpuSpawn[1] });
      }
      expect(map.name.length).toBeGreaterThan(0);
      expect(map.subtitle.length).toBeGreaterThan(0);
      signatures.add(`${playerSpawn.join(',')}:${cpuSpawn.join(',')}`);
    }

    expect(signatures.size).toBe(MAP_IDS.length);
  });

  it('normalizes unknown map ids to the default without changing the seed', () => {
    const world = createWorld(123, undefined, undefined, 'unknown-map');
    expect(world.mapId).toBe(DEFAULT_MAP_ID);
    expect(world.seed).toBe(123);
    expect(world.players[0].x).toBe(cellCenterUnits(2));
    expect(world.players[0].y).toBe(cellCenterUnits(6));
    expect(world.players[1].x).toBe(cellCenterUnits(7));
    expect(world.players[1].y).toBe(cellCenterUnits(6));
  });

  it('includes the selected map in the deterministic world hash', () => {
    const gearworks = createWorld(456, undefined, undefined, 'gearworks');
    const crossroads = createWorld(456, undefined, undefined, 'crossroads');
    const repeated = createWorld(456, undefined, undefined, 'crossroads');

    expect(gearworks.lastHash).not.toBe(crossroads.lastHash);
    expect(crossroads.lastHash).toBe(repeated.lastHash);
    expect(crossroads.players[0]).not.toEqual(gearworks.players[0]);
  });

  it('snaps centre-based positions back to their owning cells', () => {
    expect(snapToCell(cellCenterUnits(0), ARENA_WIDTH_CELLS)).toBe(0);
    expect(snapToCell(cellCenterUnits(4), ARENA_WIDTH_CELLS)).toBe(4);
    expect(snapToCell(cellCenterUnits(8), ARENA_WIDTH_CELLS)).toBe(8);
  });
});
