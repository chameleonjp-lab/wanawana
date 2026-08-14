import {
  applyMovement,
  applyPush,
  autoAimVelocity,
  BOUNCE_PUSH_UNITS,
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
  HATCH_DISABLED_TICKS,
  HATCH_RADIUS_UNITS,
  MAX_ACTIVE_TRAPS,
  MAX_CHAIN_TRAPS,
  MAX_EVENTS_PER_TICK,
  MAX_EVENT_LOG,
  normalizeCommand,
  PLAYER_RADIUS_UNITS,
  PUSH_IMMUNITY_TICKS,
  RESPAWN_INVULNERABLE_TICKS,
  segmentHitsCircle,
  SHOCK_PUSH_UNITS,
  SHOCK_RADIUS_UNITS,
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
  type MatchResult,
  type PlacementState,
  type PlayerState,
  type ShotState,
  type TrapState,
  type TrapEvent,
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
    disabledTicks: 0,
    respawnInvulnerableTicks: 0,
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
    events: [],
    nextEventId: 1,
    nextChainId: 1,
    maxChain: 0,
    result: null,
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

function spawnPosition(id: 0 | 1): { x: number; y: number } {
  return { x: (id === 0 ? 2 : 7) * CELL_UNITS, y: 6 * CELL_UNITS };
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
    disabledTicks: Math.max(0, player.disabledTicks - 1),
    respawnInvulnerableTicks: Math.max(0, player.respawnInvulnerableTicks - 1),
    ...gearState,
  };

  if (player.disabledTicks > 0) {
    const position = timers.disabledTicks === 0 ? spawnPosition(player.id) : { x: player.x, y: player.y };
    return {
      player: {
        ...player,
        ...timers,
        ...position,
        placement: null,
        investigation: null,
        respawnInvulnerableTicks: timers.disabledTicks === 0
          ? RESPAWN_INVULNERABLE_TICKS
          : timers.respawnInvulnerableTicks,
      },
      shot: null,
      completedPlacement: null,
    };
  }

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

interface TrapSegment {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly sourceActor: 0 | 1;
  readonly parentEventId: number | null;
  readonly chainId: number | null;
  readonly chainLength: number;
}

interface ContactCandidate {
  readonly trap: TrapState;
  readonly distance: number;
}

interface TrapResolution {
  readonly players: readonly [PlayerState, PlayerState];
  readonly traps: readonly TrapState[];
  readonly events: readonly TrapEvent[];
  readonly nextEventId: number;
  readonly nextChainId: number;
  readonly maxChain: number;
  readonly technicalInvalid: boolean;
}

function trapContactRadius(trap: TrapState): number {
  if (trap.kind === 'bounce') return CELL_UNITS / 2;
  if (trap.kind === 'shock') return SHOCK_RADIUS_UNITS;
  return HATCH_RADIUS_UNITS;
}

function findFirstContact(segment: TrapSegment, traps: readonly TrapState[]): ContactCandidate | null {
  const candidates: ContactCandidate[] = [];
  for (const trap of traps) {
    if (trap.armingTicks > 0) continue;
    const centerX = cellCenterUnits(trap.cellX);
    const centerY = cellCenterUnits(trap.cellY);
    if (!segmentHitsCircle(
      segment.startX,
      segment.startY,
      segment.endX,
      segment.endY,
      centerX,
      centerY,
      trapContactRadius(trap),
    )) continue;
    const dx = centerX - segment.startX;
    const dy = centerY - segment.startY;
    candidates.push({ trap, distance: dx * dx + dy * dy });
  }
  candidates.sort((first, second) => first.distance - second.distance || first.trap.id - second.trap.id);
  return candidates[0] ?? null;
}

function clampPlayerCoordinate(value: number, maximum: number): number {
  return Math.min(maximum - PLAYER_RADIUS_UNITS, Math.max(PLAYER_RADIUS_UNITS, Math.trunc(value)));
}

function moveByDirection(player: PlayerState, direction: 0 | 1 | 2 | 3, distance: number): PlayerState {
  const vectors = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const [dx, dy] = vectors[direction];
  return {
    ...player,
    x: clampPlayerCoordinate(player.x + dx * distance, ARENA_WIDTH_CELLS * CELL_UNITS),
    y: clampPlayerCoordinate(player.y + dy * distance, ARENA_HEIGHT_CELLS * CELL_UNITS),
  };
}

function moveAwayFromTrap(player: PlayerState, trap: TrapState, distance: number): PlayerState {
  const dx = player.x - cellCenterUnits(trap.cellX);
  const dy = player.y - cellCenterUnits(trap.cellY);
  if (dx === 0 && dy === 0) return moveByDirection(player, 0, distance);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return moveByDirection(player, dx < 0 ? 3 : 1, distance);
  }
  return moveByDirection(player, dy < 0 ? 0 : 2, distance);
}

function resolveTrapContacts(
  tick: number,
  players: readonly [PlayerState, PlayerState],
  traps: readonly TrapState[],
  previousPositions: readonly [{ x: number; y: number }, { x: number; y: number }],
  pushedBy: readonly [0 | 1 | null, 0 | 1 | null],
  nextEventId: number,
  nextChainId: number,
  currentMaxChain: number,
): TrapResolution {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  let remainingTraps: readonly TrapState[] = traps;
  const segments: Array<TrapSegment | null> = [
    players[0].disabledTicks > 0 ? null : {
      startX: previousPositions[0].x,
      startY: previousPositions[0].y,
      endX: players[0].x,
      endY: players[0].y,
      sourceActor: pushedBy[0] ?? 0,
      parentEventId: null,
      chainId: null,
      chainLength: 0,
    },
    players[1].disabledTicks > 0 ? null : {
      startX: previousPositions[1].x,
      startY: previousPositions[1].y,
      endX: players[1].x,
      endY: players[1].y,
      sourceActor: pushedBy[1] ?? 1,
      parentEventId: null,
      chainId: null,
      chainLength: 0,
    },
  ];
  const events: TrapEvent[] = [];
  let eventId = nextEventId;
  let chainId = nextChainId;
  let maxChain = currentMaxChain;
  let technicalInvalid = false;

  for (let eventCount = 0; eventCount < MAX_EVENTS_PER_TICK; eventCount += 1) {
    const candidates = segments.map((segment) => segment ? findFirstContact(segment, remainingTraps) : null);
    let targetId: 0 | 1 | null = null;
    let candidate: ContactCandidate | null = null;
    for (const id of [0, 1] as const) {
      const current = candidates[id];
      if (!current) continue;
      if (!candidate || current.distance < candidate.distance
        || (current.distance === candidate.distance && (id < (targetId ?? 2)
          || (id === targetId && current.trap.id < candidate.trap.id)))) {
        targetId = id;
        candidate = current;
      }
    }
    if (!candidate || targetId === null) break;

    const segment = segments[targetId];
    if (!segment) break;
    const trap = candidate.trap;
    remainingTraps = remainingTraps.filter((current) => current.id !== trap.id);
    const parentEventId = segment.parentEventId;
    const eventChainId = segment.chainId ?? chainId++;
    const eventChainLength = segment.chainLength + 1;
    if (eventChainLength > MAX_CHAIN_TRAPS) technicalInvalid = true;
    maxChain = Math.max(maxChain, eventChainLength);

    const currentPlayer = nextPlayers[targetId];
    const eventX = currentPlayer.x;
    const eventY = currentPlayer.y;
    const responsibleActor = parentEventId === null ? segment.sourceActor : (events.find((event) => event.id === parentEventId)?.responsibleActor ?? segment.sourceActor);
    const protectedTarget = currentPlayer.respawnInvulnerableTicks > 0;
    let nextPlayer = currentPlayer;
    let damage = 0;
    let pushX = 0;
    let pushY = 0;

    if (!protectedTarget) {
      if (trap.kind === 'bounce') {
        nextPlayer = moveByDirection({ ...currentPlayer, placement: null, investigation: null }, trap.direction, BOUNCE_PUSH_UNITS);
        pushX = nextPlayer.x - currentPlayer.x;
        pushY = nextPlayer.y - currentPlayer.y;
      } else if (trap.kind === 'shock') {
        damage = 18;
        nextPlayer = moveAwayFromTrap({
          ...currentPlayer,
          hp: Math.max(0, currentPlayer.hp - damage),
          placement: null,
          investigation: null,
        }, trap, SHOCK_PUSH_UNITS);
        pushX = nextPlayer.x - currentPlayer.x;
        pushY = nextPlayer.y - currentPlayer.y;
      } else {
        damage = 26;
        nextPlayer = {
          ...currentPlayer,
          hp: Math.max(0, currentPlayer.hp - damage),
          disabledTicks: HATCH_DISABLED_TICKS,
          placement: null,
          investigation: null,
        };
      }
    }

    const event: TrapEvent = {
      id: eventId,
      tick,
      chainId: eventChainId,
      parentEventId,
      chainLength: eventChainLength,
      trapId: trap.id,
      owner: trap.owner,
      kind: trap.kind,
      target: targetId,
      responsibleActor,
      x: eventX,
      y: eventY,
      damage,
      pushX,
      pushY,
    };
    eventId += 1;
    events.push(event);
    nextPlayers[targetId] = nextPlayer;

    if (technicalInvalid || events.length >= MAX_EVENT_LOG) {
      technicalInvalid = true;
      break;
    }

    if (trap.kind === 'bounce' || trap.kind === 'shock') {
      segments[targetId] = {
        startX: currentPlayer.x,
        startY: currentPlayer.y,
        endX: nextPlayer.x,
        endY: nextPlayer.y,
        sourceActor: responsibleActor,
        parentEventId: event.id,
        chainId: event.chainId,
        chainLength: event.chainLength,
      };
    } else {
      segments[targetId] = null;
    }
  }

  if (events.length >= MAX_EVENTS_PER_TICK) technicalInvalid = true;
  return {
    players: nextPlayers,
    traps: remainingTraps,
    events,
    nextEventId: eventId,
    nextChainId: chainId,
    maxChain,
    technicalInvalid,
  };
}

function isInsideShotArena(x: number, y: number): boolean {
  return x >= 0 && x <= ARENA_WIDTH_CELLS * CELL_UNITS
    && y >= 0 && y <= ARENA_HEIGHT_CELLS * CELL_UNITS;
}

interface ShotStep {
  readonly players: readonly [PlayerState, PlayerState];
  readonly shots: readonly ShotState[];
  readonly placementCancelled: readonly [boolean, boolean];
  readonly pushedBy: readonly [0 | 1 | null, 0 | 1 | null];
}

function stepShots(
  shots: readonly ShotState[],
  players: readonly [PlayerState, PlayerState],
  placementInProgress: readonly [boolean, boolean],
): ShotStep {
  const nextPlayers: [PlayerState, PlayerState] = [...players];
  const nextShots: ShotState[] = [];
  const placementCancelled: [boolean, boolean] = [false, false];
  const pushedBy: [0 | 1 | null, 0 | 1 | null] = [null, null];

  for (const shot of [...shots].sort((first, second) => first.id - second.id)) {
    const nextX = shot.x + shot.vx;
    const nextY = shot.y + shot.vy;
    const targetId: 0 | 1 = shot.owner === 0 ? 1 : 0;
    const target = nextPlayers[targetId];
    const hit = target.disabledTicks === 0
      && segmentHitsCircle(shot.x, shot.y, nextX, nextY, target.x, target.y, PLAYER_RADIUS_UNITS + SHOT_RADIUS_UNITS);
    if (hit) {
      const pushed = target.pushImmunityTicks === 0 ? applyPush(target, shot.vx, shot.vy) : target;
      pushedBy[targetId] = shot.owner;
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
  return { players: nextPlayers, shots: nextShots, placementCancelled, pushedBy };
}

function determineResult(
  tick: number,
  players: readonly [PlayerState, PlayerState],
  technicalInvalid: boolean,
): MatchResult | null {
  if (technicalInvalid) return 'technical-invalid';
  const playerDefeated = players[0].hp <= 0;
  const cpuDefeated = players[1].hp <= 0;
  if (playerDefeated && cpuDefeated) return 'draw';
  if (playerDefeated) return 'cpu-win';
  if (cpuDefeated) return 'player-win';
  if (tick < MATCH_TICKS) return null;
  if (players[0].hp === players[1].hp) return 'time-draw';
  return players[0].hp > players[1].hp ? 'player-win' : 'cpu-win';
}

export function advanceWorld(
  world: WorldState,
  playerCommand: Partial<InputCommand> = {},
  cpuCommand: Partial<InputCommand> = {},
): WorldState {
  if (world.phase !== 'battle') return world;

  const playerInput = normalizeCommand(playerCommand);
  const cpuInput = normalizeCommand(cpuCommand);
  const previousPositions: readonly [{ x: number; y: number }, { x: number; y: number }] = [
    { x: world.players[0].x, y: world.players[0].y },
    { x: world.players[1].x, y: world.players[1].y },
  ];
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

  const trapStep = resolveTrapContacts(
    world.tick,
    [player, cpu],
    traps,
    previousPositions,
    shotStep.pushedBy,
    world.nextEventId,
    world.nextChainId,
    world.maxChain,
  );
  player = trapStep.players[0];
  cpu = trapStep.players[1];
  traps = trapStep.traps;

  const playerInvestigation = stepInvestigation(player, playerInput, traps);
  player = playerInvestigation.player;
  traps = playerInvestigation.traps;
  const cpuInvestigation = stepInvestigation(cpu, cpuInput, traps);
  cpu = cpuInvestigation.player;
  traps = cpuInvestigation.traps;

  const nextTick = world.tick + 1;
  const events = [...world.events, ...trapStep.events];
  const result = determineResult(nextTick, [player, cpu], trapStep.technicalInvalid || events.length > MAX_EVENT_LOG);
  const nextWorld: WorldState = {
    phase: result ? 'result' : world.phase,
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
    events,
    nextEventId: trapStep.nextEventId,
    nextChainId: trapStep.nextChainId,
    maxChain: trapStep.maxChain,
    result,
    lastHash: '',
  };
  return { ...nextWorld, lastHash: hashWorld(nextWorld) };
}
