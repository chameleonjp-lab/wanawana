import {
  applyMovement,
  applyPush,
  autoAimVelocity,
  FIRE_COOLDOWN_TICKS,
  FIRE_SLOW_TICKS,
  normalizeCommand,
  PLAYER_RADIUS_UNITS,
  PUSH_IMMUNITY_TICKS,
  segmentHitsCircle,
  SHOT_RANGE_UNITS,
  SHOT_RADIUS_UNITS,
} from './fixed.ts';
import { hashWorld } from './hash.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  MATCH_TICKS,
  type InputCommand,
  type PlayerState,
  type ShotState,
  type WorldState,
} from './types.ts';

function createPlayer(id: 0 | 1): PlayerState {
  return id === 0
    ? { id, x: 2 * CELL_UNITS, y: 6 * CELL_UNITS, hp: 100, fireCooldownTicks: 0, fireSlowTicks: 0, pushImmunityTicks: 0 }
    : { id, x: 7 * CELL_UNITS, y: 6 * CELL_UNITS, hp: 100, fireCooldownTicks: 0, fireSlowTicks: 0, pushImmunityTicks: 0 };
}

export function createWorld(seed = 1): WorldState {
  const world: WorldState = {
    phase: 'battle',
    tick: 0,
    seed: Math.trunc(seed) >>> 0,
    players: [createPlayer(0), createPlayer(1)],
    shots: [],
    nextEntityId: 2,
    shotsFired: [0, 0],
    lastHash: '',
  };
  return { ...world, lastHash: hashWorld(world) };
}

interface PlayerStep {
  readonly player: PlayerState;
  readonly shot: ShotState | null;
}

function stepPlayer(
  player: PlayerState,
  command: InputCommand,
  target: PlayerState,
  shotId: number,
): PlayerStep {
  const canFire = command.fire && player.fireCooldownTicks === 0;
  const timers = {
    fireCooldownTicks: Math.max(0, player.fireCooldownTicks - 1),
    fireSlowTicks: canFire ? FIRE_SLOW_TICKS : Math.max(0, player.fireSlowTicks - 1),
    pushImmunityTicks: Math.max(0, player.pushImmunityTicks - 1),
  };
  const moved = applyMovement({ ...player, ...timers }, command);
  if (!canFire) return { player: moved, shot: null };

  const velocity = autoAimVelocity(moved.x, moved.y, target.x, target.y);
  return {
    player: { ...moved, fireCooldownTicks: FIRE_COOLDOWN_TICKS },
    shot: {
      id: shotId,
      owner: player.id,
      x: moved.x,
      y: moved.y,
      vx: velocity.vx,
      vy: velocity.vy,
      travelledUnits: 0,
    },
  };
}

function isInsideShotArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_WIDTH_CELLS * CELL_UNITS
    && y >= 0 && y <= ARENA_HEIGHT_CELLS * CELL_UNITS;
}

interface ShotStep {
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
}

function stepShots(
  shots: readonly ShotState[],
  players: readonly [PlayerState, PlayerState],
): ShotStep {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  const nextShots: ShotState[] = [];

  for (const shot of [...shots].sort((first, second) => first.id - second.id)) {
    const nextX = shot.x + shot.vx;
    const nextY = shot.y + shot.vy;
    const targetId: 0 | 1 = shot.owner === 0 ? 1 : 0;
    const target = nextPlayers[targetId];
    const hit = segmentHitsCircle(
      shot.x,
      shot.y,
      nextX,
      nextY,
      target.x,
      target.y,
      PLAYER_RADIUS_UNITS + SHOT_RADIUS_UNITS,
    );
    if (hit) {
      if (target.pushImmunityTicks === 0) {
        nextPlayers[targetId] = {
          ...applyPush(target, shot.vx, shot.vy),
          pushImmunityTicks: PUSH_IMMUNITY_TICKS,
        };
      }
      continue;
    }

    const travelledUnits = shot.travelledUnits + Math.abs(shot.vx) + Math.abs(shot.vy);
    if (travelledUnits > SHOT_RANGE_UNITS || !isInsideShotArena(nextX, nextY)) continue;
    nextShots.push({ ...shot, x: nextX, y: nextY, travelledUnits });
  }
  return { players: nextPlayers, shots: nextShots };
}

export function advanceWorld(
  world: WorldState,
  playerCommand: Partial<InputCommand> = {},
  cpuCommand: Partial<InputCommand> = {},
): WorldState {
  if (world.phase !== 'battle') return world;

  const playerInput = normalizeCommand(playerCommand);
  const cpuInput = normalizeCommand(cpuCommand);
  let nextEntityId = world.nextEntityId;
  const playerStep = stepPlayer(world.players[0], playerInput, world.players[1], nextEntityId);
  if (playerStep.shot) nextEntityId += 1;
  const cpuStep = stepPlayer(world.players[1], cpuInput, playerStep.player, nextEntityId);
  if (cpuStep.shot) nextEntityId += 1;
  const shotStep = stepShots(
    [
      ...world.shots,
      ...(playerStep.shot ? [playerStep.shot] : []),
      ...(cpuStep.shot ? [cpuStep.shot] : []),
    ],
    [playerStep.player, cpuStep.player],
  );
  const nextTick = world.tick + 1;
  const nextShots: readonly [number, number] = [
    world.shotsFired[0] + (playerStep.shot ? 1 : 0),
    world.shotsFired[1] + (cpuStep.shot ? 1 : 0),
  ];
  const nextPhase = nextTick >= MATCH_TICKS ? 'result' : world.phase;
  const nextWorld: WorldState = {
    phase: nextPhase,
    tick: nextTick,
    seed: world.seed,
    players: shotStep.players,
    shots: shotStep.shots,
    nextEntityId,
    shotsFired: nextShots,
    lastHash: '',
  };
  return { ...nextWorld, lastHash: hashWorld(nextWorld) };
}
