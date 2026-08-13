import { applyMovement, normalizeCommand } from './fixed.ts';
import { hashWorld } from './hash.ts';
import {
  CELL_UNITS,
  MATCH_TICKS,
  type InputCommand,
  type PlayerState,
  type WorldState,
} from './types.ts';

function createPlayer(id: 0 | 1): PlayerState {
  return id === 0
    ? { id, x: 2 * CELL_UNITS, y: 6 * CELL_UNITS, hp: 100 }
    : { id, x: 7 * CELL_UNITS, y: 6 * CELL_UNITS, hp: 100 };
}

export function createWorld(seed = 1): WorldState {
  const world: WorldState = {
    phase: 'battle',
    tick: 0,
    seed: Math.trunc(seed) >>> 0,
    players: [createPlayer(0), createPlayer(1)],
    shotsFired: [0, 0],
    lastHash: '',
  };
  return { ...world, lastHash: hashWorld(world) };
}

export function advanceWorld(
  world: WorldState,
  playerCommand: Partial<InputCommand> = {},
  cpuCommand: Partial<InputCommand> = {},
): WorldState {
  if (world.phase !== 'battle') return world;

  const playerInput = normalizeCommand(playerCommand);
  const cpuInput = normalizeCommand(cpuCommand);
  const player = applyMovement(world.players[0], playerInput);
  const cpu = applyMovement(world.players[1], cpuInput);
  const nextTick = world.tick + 1;
  const nextShots: readonly [number, number] = [
    world.shotsFired[0] + (playerInput.fire ? 1 : 0),
    world.shotsFired[1] + (cpuInput.fire ? 1 : 0),
  ];
  const nextPhase = nextTick >= MATCH_TICKS ? 'result' : world.phase;
  const nextWorld: WorldState = {
    phase: nextPhase,
    tick: nextTick,
    seed: world.seed,
    players: [player, cpu],
    shotsFired: nextShots,
    lastHash: '',
  };
  return { ...nextWorld, lastHash: hashWorld(nextWorld) };
}
