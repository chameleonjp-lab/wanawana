import {
  applyMovement,
  applyPush,
  autoAimVelocity,
  cellCenterUnits,
  DISARM_RADIUS_UNITS,
  DISARM_TICKS,
  FIRE_COOLDOWN_TICKS,
  FIRE_SLOW_TICKS,
  GEAR_MAX,
  GEAR_RECOVERY_TICKS,
  GEAR_START,
  INVESTIGATE_RADIUS_UNITS,
  INVESTIGATE_TICKS,
  INVESTIGATION_PAUSE_TICKS,
  isTrapKind,
  MAX_ACTIVE_TRAPS,
  normalizeCommand,
  PLAYER_RADIUS_UNITS,
  PUSH_IMMUNITY_TICKS,
  segmentHitsCircle,
  SHOT_RANGE_UNITS,
  SHOT_RADIUS_UNITS,
  snapToCell,
  TRAP_ARMING_TICKS,
  TRAP_COOLDOWN_TICKS,
  TRAP_COSTS,
  TRAP_LIFETIME_TICKS,
  TRAP_PLACEMENT_TICKS,
} from './fixed.ts';
import { hashWorld } from './hash.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  CELL_UNITS,
  MATCH_TICKS,
  type InputCommand,
  type InvestigationState,
  type PlacementState,
  type PlayerState,
  type ShotState,
  type TrapState,
  type WorldState,
} from './types.ts';

function createPlayer(id: 0 | 1): PlayerState {
  return {
    id,
    x: (id === 0 ? 2 : 7) * CELL_UNITS,
    y: 6 * CELL_UNITS,
    hp: 100,
    fireCooldownTicks: 0,
    fireSlowTicks: 0,
    pushImmunityTicks: 0,
    trapCooldownTicks: 0,
    gear: GEAR_START,
    gearRecoveryTicks: GEAR_RECOVERY_TICKS,
    placement: null,
    investigation: null,
    investigationPauseTicks: 0,
  };
}

export function createWorld(seed = 1): WorldState {
  const world: WorldState = {
    phase: 'battle',
    tick: 0,
    seed: Math.trunc(seed) >>> 0,
    players: [createPlayer(0), createPlayer(1)],
    shots: [],
    traps: [],
    nextEntityId: 2,
    shotsFired: [0, 0],
    trapsPlaced: [0, 0],
    trapsDisarmed: [0, 0],
    lastHash: '',
  };
  return { ...world, lastHash: hashWorld(world) };
}

interface PlayerStep {
  readonly player: PlayerState;
  readonly shot: ShotState | null;
  readonly completedPlacement: PlacementState | null;
}

function recoverGear(player: PlayerState): Pick<PlayerState, 'gear' | 'gearRecoveryTicks'> {
  if (player.gear >= GEAR_MAX) return { gear: GEAR_MAX, gearRecoveryTicks: GEAR_RECOVERY_TICKS };
  const nextRecoveryTicks = Math.max(0, player.gearRecoveryTicks - 1);
  if (nextRecoveryTicks > 0) return { gear: player.gear, gearRecoveryTicks: nextRecoveryTicks };
  return { gear: Math.min(GEAR_MAX, player.gear + 1), gearRecoveryTicks: GEAR_RECOVERY_TICKS };
}

function placementCellIsValid(
  player: PlayerState,
  target: PlayerState,
  traps: readonly TrapState[],
  cellX: number,
  cellY: number,
): boolean {
  if (traps.some((trap) => trap.owner === player.id && trap.cellX === cellX && trap.cellY === cellY)) return false;
  const trapX = cellCenterUnits(cellX);
  const trapY = cellCenterUnits(cellY);
  const horizontalOverlap = Math.abs(target.x - trapX) <= CELL_UNITS / 2 + PLAYER_RADIUS_UNITS;
  const verticalOverlap = Math.abs(target.y - trapY) <= CELL_UNITS / 2 + PLAYER_RADIUS_UNITS;
  return !(horizontalOverlap && verticalOverlap);
}

function stepPlayer(
  player: PlayerState,
  command: InputCommand,
  target: PlayerState,
  traps: readonly TrapState[],
  shotId: number,
): PlayerStep {
  const gearState = recoverGear(player);
  const timers = {
    fireCooldownTicks: Math.max(0, player.fireCooldownTicks - 1),
    fireSlowTicks: Math.max(0, player.fireSlowTicks - 1),
    pushImmunityTicks: Math.max(0, player.pushImmunityTicks - 1),
    trapCooldownTicks: Math.max(0, player.trapCooldownTicks - 1),
    investigationPauseTicks: Math.max(0, player.investigationPauseTicks - 1),
    ...gearState,
  };

  if (player.placement) {
    const remainingTicks = player.placement.remainingTicks - 1;
    if (remainingTicks > 0) {
      return {
        player: { ...player, ...timers, placement: { ...player.placement, remainingTicks } },
        shot: null,
        completedPlacement: null,
      };
    }
    return {
      player: { ...player, ...timers, placement: null },
      shot: null,
      completedPlacement: player.placement,
    };
  }

  if (
    command.placeTrap
    && isTrapKind(command.placeTrap)
    && !player.investigation
    && player.gear >= TRAP_COSTS[command.placeTrap]
    && player.trapCooldownTicks === 0
    && traps.filter((trap) => trap.owner === player.id).length < MAX_ACTIVE_TRAPS
  ) {
    const cellX = Number.isInteger(command.trapCellX)
      ? Math.min(ARENA_WIDTH_CELLS - 1, Math.max(0, command.trapCellX as number))
      : snapToCell(player.x, ARENA_WIDTH_CELLS);
    const cellY = Number.isInteger(command.trapCellY)
      ? Math.min(ARENA_HEIGHT_CELLS - 1, Math.max(0, command.trapCellY as number))
      : snapToCell(player.y, ARENA_HEIGHT_CELLS);
    if (placementCellIsValid(player, target, traps, cellX, cellY)) {
      return {
        player: {
          ...player,
          ...timers,
          placement: {
            kind: command.placeTrap,
            direction: command.trapDirection,
            cellX,
            cellY,
            remainingTicks: TRAP_PLACEMENT_TICKS,
          },
        },
        shot: null,
        completedPlacement: null,
      };
    }
  }

  const canFire = command.fire && player.fireCooldownTicks === 0;
  const moved = applyMovement({
    ...player,
    ...timers,
    fireSlowTicks: canFire ? FIRE_SLOW_TICKS : timers.fireSlowTicks,
  }, command);
  if (!canFire) return { player: moved, shot: null, completedPlacement: null };

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
    completedPlacement: null,
  };
}

function createTrap(owner: 0 | 1, id: number, placement: PlacementState): TrapState {
  return {
    id,
    owner,
    kind: placement.kind,
    direction: placement.direction,
    cellX: placement.cellX,
    cellY: placement.cellY,
    armingTicks: TRAP_ARMING_TICKS,
    remainingTicks: TRAP_LIFETIME_TICKS,
    discoveredBy: owner === 0 ? [true, false] : [false, true],
  };
}

function addCompletedTrap(
  player: PlayerState,
  placement: PlacementState | null,
  traps: readonly TrapState[],
  nextEntityId: number,
  cancelled: boolean,
): { player: PlayerState; traps: readonly TrapState[]; nextEntityId: number; placed: boolean } {
  if (!placement || cancelled) return { player, traps, nextEntityId, placed: false };
  const trap = createTrap(player.id, nextEntityId, placement);
  return {
    player: {
      ...player,
      gear: Math.max(0, player.gear - TRAP_COSTS[placement.kind]),
      trapCooldownTicks: TRAP_COOLDOWN_TICKS,
    },
    traps: [...traps, trap],
    nextEntityId: nextEntityId + 1,
    placed: true,
  };
}

function trapDistanceSquared(player: PlayerState, trap: TrapState): number {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  return dx * dx + dy * dy;
}

function findInvestigationTarget(
  player: PlayerState,
  traps: readonly TrapState[],
): { trap: TrapState; mode: 'reveal' | 'disarm' } | null {
  const candidates: Array<{ trap: TrapState; mode: 'reveal' | 'disarm'; distance: number }> = [];
  for (const trap of traps) {
    if (trap.owner === player.id || trap.armingTicks > 0) continue;
    const distance = trapDistanceSquared(player, trap);
    if (!trap.discoveredBy[player.id] && distance <= INVESTIGATE_RADIUS_UNITS ** 2) {
      candidates.push({ trap, mode: 'reveal', distance });
    } else if (trap.discoveredBy[player.id] && distance <= DISARM_RADIUS_UNITS ** 2) {
      candidates.push({ trap, mode: 'disarm', distance });
    }
  }
  candidates.sort((first, second) => first.distance - second.distance || first.trap.id - second.trap.id);
  const target = candidates[0];
  return target ? { trap: target.trap, mode: target.mode } : null;
}

function investigationStillValid(
  player: PlayerState,
  state: InvestigationState,
  traps: readonly TrapState[],
): TrapState | null {
  if (player.x !== state.startX || player.y !== state.startY) return null;
  const trap = traps.find((candidate) => candidate.id === state.targetTrapId);
  if (!trap || trap.owner === player.id || trap.armingTicks > 0) return null;
  if (state.mode === 'reveal' && trap.discoveredBy[player.id]) return null;
  if (state.mode === 'disarm' && !trap.discoveredBy[player.id]) return null;
  const radius = state.mode === 'reveal' ? INVESTIGATE_RADIUS_UNITS : DISARM_RADIUS_UNITS;
  return trapDistanceSquared(player, trap) <= radius ** 2 ? trap : null;
}

interface InvestigationStep {
  readonly player: PlayerState;
  readonly traps: readonly TrapState[];
  readonly disarmed: boolean;
}

function stepInvestigation(
  player: PlayerState,
  command: InputCommand,
  traps: readonly TrapState[],
): InvestigationStep {
  if (player.placement) {
    return { player: { ...player, investigation: null }, traps, disarmed: false };
  }
  if (player.investigation) {
    const state = player.investigation;
    if (!command.investigate) return { player: { ...player, investigation: null }, traps, disarmed: false };
    const target = investigationStillValid(player, state, traps);
    if (!target) return { player: { ...player, investigation: null }, traps, disarmed: false };
    if (player.investigationPauseTicks > 0) {
      return { player: { ...player, investigationPauseTicks: player.investigationPauseTicks - 1 }, traps, disarmed: false };
    }
    const remainingTicks = state.remainingTicks - 1;
    if (remainingTicks > 0) {
      return { player: { ...player, investigation: { ...state, remainingTicks } }, traps, disarmed: false };
    }
    if (state.mode === 'reveal') {
      const updatedTraps = traps.map((trap) => trap.id === target.id
        ? {
          ...trap,
          discoveredBy: (player.id === 0
            ? [true, trap.discoveredBy[1]]
            : [trap.discoveredBy[0], true]) as readonly [boolean, boolean],
        }
        : trap);
      return { player: { ...player, investigation: null }, traps: updatedTraps, disarmed: false };
    }
    return { player: { ...player, investigation: null }, traps: traps.filter((trap) => trap.id !== target.id), disarmed: true };
  }

  if (!command.investigateStart || !command.investigate) return { player, traps, disarmed: false };
  const target = findInvestigationTarget(player, traps);
  if (!target) return { player, traps, disarmed: false };
  return {
    player: {
      ...player,
      investigation: {
        targetTrapId: target.trap.id,
        mode: target.mode,
        startX: player.x,
        startY: player.y,
        remainingTicks: target.mode === 'reveal' ? INVESTIGATE_TICKS : DISARM_TICKS,
      },
    },
    traps,
    disarmed: false,
  };
}

function advanceTrapTimers(traps: readonly TrapState[]): readonly TrapState[] {
  return traps
    .map((trap) => ({
      ...trap,
      armingTicks: Math.max(0, trap.armingTicks - 1),
      remainingTicks: trap.armingTicks > 0 ? trap.remainingTicks : Math.max(0, trap.remainingTicks - 1),
    }))
    .filter((trap) => trap.remainingTicks > 0);
}

function isInsideShotArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_WIDTH_CELLS * CELL_UNITS
    && y >= 0 && y <= ARENA_HEIGHT_CELLS * CELL_UNITS;
}

interface ShotStep {
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
  readonly placementCancelled: readonly [boolean, boolean];
}

function stepShots(
  shots: readonly ShotState[],
  players: readonly [PlayerState, PlayerState],
  placementInProgress: readonly [boolean, boolean],
): ShotStep {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  const nextShots: ShotState[] = [];
  const placementCancelled: [boolean, boolean] = [false, false];

  for (const shot of [...shots].sort((first, second) => first.id - second.id)) {
    const nextX = shot.x + shot.vx;
    const nextY = shot.y + shot.vy;
    const targetId: 0 | 1 = shot.owner === 0 ? 1 : 0;
    const target = nextPlayers[targetId];
    const hit = segmentHitsCircle(shot.x, shot.y, nextX, nextY, target.x, target.y, PLAYER_RADIUS_UNITS + SHOT_RADIUS_UNITS);
    if (hit) {
      const pushed = target.pushImmunityTicks === 0 ? applyPush(target, shot.vx, shot.vy) : target;
      if (placementInProgress[targetId]) placementCancelled[targetId] = true;
      const investigation = target.investigation && pushed !== target
        ? {
          ...target.investigation,
          startX: pushed.x,
          startY: pushed.y,
        }
        : target.investigation;
      nextPlayers[targetId] = {
        ...pushed,
        placement: null,
        investigation,
        investigationPauseTicks: Math.max(target.investigationPauseTicks, INVESTIGATION_PAUSE_TICKS),
        pushImmunityTicks: target.pushImmunityTicks === 0 ? PUSH_IMMUNITY_TICKS : target.pushImmunityTicks,
      };
      continue;
    }

    const travelledUnits = shot.travelledUnits + Math.abs(shot.vx) + Math.abs(shot.vy);
    if (travelledUnits > SHOT_RANGE_UNITS || !isInsideShotArena(nextX, nextY)) continue;
    nextShots.push({ ...shot, x: nextX, y: nextY, travelledUnits });
  }
  return { players: nextPlayers, shots: nextShots, placementCancelled };
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
  const playerStep = stepPlayer(world.players[0], playerInput, world.players[1], world.traps, nextEntityId);
  if (playerStep.shot) nextEntityId += 1;
  const cpuStep = stepPlayer(world.players[1], cpuInput, playerStep.player, world.traps, nextEntityId);
  if (cpuStep.shot) nextEntityId += 1;

  const placementInProgress: readonly [boolean, boolean] = [
    Boolean(world.players[0].placement || playerStep.completedPlacement),
    Boolean(world.players[1].placement || cpuStep.completedPlacement),
  ];
  const shotStep = stepShots(
    [
      ...world.shots,
      ...(playerStep.shot ? [playerStep.shot] : []),
      ...(cpuStep.shot ? [cpuStep.shot] : []),
    ],
    [playerStep.player, cpuStep.player],
    placementInProgress,
  );

  let traps: readonly TrapState[] = world.traps;
  let player = shotStep.players[0];
  let cpu = shotStep.players[1];
  const playerTrap = addCompletedTrap(
    player,
    playerStep.completedPlacement,
    traps,
    nextEntityId,
    shotStep.placementCancelled[0],
  );
  player = playerTrap.player;
  traps = playerTrap.traps;
  nextEntityId = playerTrap.nextEntityId;
  const cpuTrap = addCompletedTrap(
    cpu,
    cpuStep.completedPlacement,
    traps,
    nextEntityId,
    shotStep.placementCancelled[1],
  );
  cpu = cpuTrap.player;
  traps = cpuTrap.traps;

  const playerInvestigation = stepInvestigation(player, playerInput, traps);
  player = playerInvestigation.player;
  traps = playerInvestigation.traps;
  const cpuInvestigation = stepInvestigation(cpu, cpuInput, traps);
  cpu = cpuInvestigation.player;
  traps = cpuInvestigation.traps;

  const nextTick = world.tick + 1;
  const nextWorld: WorldState = {
    phase: nextTick >= MATCH_TICKS ? 'result' : world.phase,
    tick: nextTick,
    seed: world.seed,
    players: [player, cpu],
    shots: shotStep.shots,
    traps: advanceTrapTimers(traps),
    nextEntityId,
    shotsFired: [
      world.shotsFired[0] + (playerStep.shot ? 1 : 0),
      world.shotsFired[1] + (cpuStep.shot ? 1 : 0),
    ],
    trapsPlaced: [
      world.trapsPlaced[0] + (playerTrap.placed ? 1 : 0),
      world.trapsPlaced[1] + (cpuTrap.placed ? 1 : 0),
    ],
    trapsDisarmed: [
      world.trapsDisarmed[0] + (playerInvestigation.disarmed ? 1 : 0),
      world.trapsDisarmed[1] + (cpuInvestigation.disarmed ? 1 : 0),
    ],
    lastHash: '',
  };
  return { ...nextWorld, lastHash: hashWorld(nextWorld) };
}
