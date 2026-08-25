import {
  CELL_UNITS,
  MATCH_TICKS,
  type CpuDifficulty,
  type MapId,
  type PlayerState,
  type ShotState,
  type TrapEvent,
  type TrapKind,
  type TrapLoadout,
  type TrapState,
  type WorldState,
} from './types.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
} from './types.ts';
import {
  DISARM_TICKS,
  FIRE_COOLDOWN_TICKS,
  FIRE_SLOW_TICKS,
  GEAR_MAX,
  GEAR_RECOVERY_TICKS,
  INVESTIGATION_PAUSE_TICKS,
  INVESTIGATE_TICKS,
  MAX_ACTIVE_TRAPS,
  MAX_EVENT_LOG,
  PUSH_IMMUNITY_TICKS,
  RESPAWN_INVULNERABLE_TICKS,
  TRAP_ARMING_TICKS,
  TRAP_COOLDOWN_TICKS,
  TRAP_LIFETIME_TICKS,
  TRAP_PLACEMENT_TICKS,
  isTrapKind,
} from './fixed.ts';
import { hashText, hashWorld } from './hash.ts';
import { BALANCE_CONFIG_HASH } from './balance.ts';
import { getMapDefinition, isMapId } from './maps.ts';
import { normalizeTrapLoadout } from './fixed.ts';

export const RESUME_SCHEMA_VERSION = 1 as const;
export const RESUME_ENGINE_VERSION = 'wanawana-resume-v4' as const;
export const RESUME_PRNG_NAME = 'fixed-integer-v1' as const;
export const RESUME_MAX_AGE_MS = 30 * 60 * 1_000;
export const RESUME_MAX_JSON_BYTES = 2_000_000;

const HASH_PATTERN = /^[0-9a-f]{8}$/;
const MAX_ID = 0xffff_ffff;
const MAX_TIMER = MATCH_TICKS;

export interface MatchResume {
  readonly schemaVersion: typeof RESUME_SCHEMA_VERSION;
  readonly engineVersion: typeof RESUME_ENGINE_VERSION;
  readonly balanceConfigHash: string;
  readonly mapHash: string;
  readonly prngName: typeof RESUME_PRNG_NAME;
  readonly savedAtMs: number;
  readonly difficulty: CpuDifficulty;
  readonly world: WorldState;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isFiniteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isDifficulty(value: unknown): value is CpuDifficulty {
  return value === 'easy' || value === 'normal' || value === 'hard';
}

function isTrapValue(value: unknown): value is TrapKind {
  return typeof value === 'string' && isTrapKind(value);
}

function isDirection(value: unknown): boolean {
  return isSafeInteger(value, 0, 3);
}

function isLoadout(value: unknown): value is TrapLoadout {
  return Array.isArray(value)
    && value.length === 3
    && value.every((kind) => isTrapKind(kind))
    && value[0] === 'bounce';
}

function isPairOfLoadouts(value: unknown): value is readonly [TrapLoadout, TrapLoadout] {
  return Array.isArray(value)
    && value.length === 2
    && isLoadout(value[0])
    && isLoadout(value[1]);
}

function isPlacement(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const placement = value as Record<string, unknown>;
  return isTrapValue(placement.kind)
    && isDirection(placement.direction)
    && isSafeInteger(placement.cellX, 0, ARENA_WIDTH_CELLS - 1)
    && isSafeInteger(placement.cellY, 0, ARENA_HEIGHT_CELLS - 1)
    && isSafeInteger(placement.remainingTicks, 0, TRAP_PLACEMENT_TICKS);
}

function isInvestigation(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const investigation = value as Record<string, unknown>;
  return isSafeInteger(investigation.targetTrapId, 1, MAX_ID)
    && (investigation.mode === 'reveal' || investigation.mode === 'disarm')
    && isFiniteInteger(investigation.startX, 0, ARENA_WIDTH_CELLS * CELL_UNITS)
    && isFiniteInteger(investigation.startY, 0, ARENA_HEIGHT_CELLS * CELL_UNITS)
    && isSafeInteger(investigation.remainingTicks, 0, Math.max(INVESTIGATE_TICKS, DISARM_TICKS));
}

function isPlayer(value: unknown, id: 0 | 1): value is PlayerState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const player = value as Record<string, unknown>;
  return player.id === id
    && isFiniteInteger(player.x, 0, ARENA_WIDTH_CELLS * CELL_UNITS)
    && isFiniteInteger(player.y, 0, ARENA_HEIGHT_CELLS * CELL_UNITS)
    && isSafeInteger(player.hp, 0, 100)
    && isSafeInteger(player.fireCooldownTicks, 0, FIRE_COOLDOWN_TICKS)
    && isSafeInteger(player.fireSlowTicks, 0, FIRE_SLOW_TICKS)
    && isSafeInteger(player.gasSlowTicks, 0, MAX_TIMER)
    && isSafeInteger(player.pushImmunityTicks, 0, PUSH_IMMUNITY_TICKS)
    && isSafeInteger(player.trapCooldownTicks, 0, TRAP_COOLDOWN_TICKS)
    && isSafeInteger(player.gear, 0, GEAR_MAX)
    && isSafeInteger(player.gearRecoveryTicks, 0, GEAR_RECOVERY_TICKS)
    && isPlacement(player.placement)
    && isInvestigation(player.investigation)
    && isSafeInteger(player.investigationPauseTicks, 0, INVESTIGATION_PAUSE_TICKS)
    && isSafeInteger(player.disabledTicks, 0, MAX_TIMER)
    && isSafeInteger(player.respawnInvulnerableTicks, 0, RESPAWN_INVULNERABLE_TICKS);
}

function isShot(value: unknown): value is ShotState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const shot = value as Record<string, unknown>;
  return isSafeInteger(shot.id, 2, MAX_ID)
    && (shot.owner === 0 || shot.owner === 1)
    && isFiniteInteger(shot.x, -CELL_UNITS, ARENA_WIDTH_CELLS * CELL_UNITS + CELL_UNITS)
    && isFiniteInteger(shot.y, -CELL_UNITS, ARENA_HEIGHT_CELLS * CELL_UNITS + CELL_UNITS)
    && isFiniteInteger(shot.vx, -CELL_UNITS * 20, CELL_UNITS * 20)
    && isFiniteInteger(shot.vy, -CELL_UNITS * 20, CELL_UNITS * 20)
    && isSafeInteger(shot.travelledUnits, 0, CELL_UNITS * ARENA_WIDTH_CELLS * 20);
}

function isOptionalInteger(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || isSafeInteger(value, minimum, maximum);
}

function isNullableInteger(value: unknown, minimum: number, maximum: number): boolean {
  return value === null || isOptionalInteger(value, minimum, maximum);
}

function isTrap(value: unknown): value is TrapState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const trap = value as Record<string, unknown>;
  return isSafeInteger(trap.id, 2, MAX_ID)
    && (trap.owner === 0 || trap.owner === 1)
    && isTrapValue(trap.kind)
    && isDirection(trap.direction)
    && isSafeInteger(trap.cellX, 0, ARENA_WIDTH_CELLS - 1)
    && isSafeInteger(trap.cellY, 0, ARENA_HEIGHT_CELLS - 1)
    && isSafeInteger(trap.armingTicks, 0, TRAP_ARMING_TICKS)
    && isSafeInteger(trap.remainingTicks, 0, TRAP_LIFETIME_TICKS)
    && Array.isArray(trap.discoveredBy)
    && trap.discoveredBy.length === 2
    && trap.discoveredBy.every((value) => typeof value === 'boolean')
    && isOptionalInteger(trap.triggerTicks, 0, MAX_TIMER)
    && isOptionalInteger(trap.effectTicks, 0, MAX_TIMER)
    && isNullableInteger(trap.triggerParentEventId, 0, MAX_ID)
    && isNullableInteger(trap.triggerChainId, 0, MAX_ID)
    && isOptionalInteger(trap.triggerChainLength, 0, 8)
    && (trap.triggerResponsibleActor === undefined || trap.triggerResponsibleActor === 0 || trap.triggerResponsibleActor === 1);
}

function isEvent(value: unknown): value is TrapEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return isSafeInteger(event.id, 1, MAX_ID)
    && isSafeInteger(event.tick, 0, MATCH_TICKS)
    && isSafeInteger(event.chainId, 1, MAX_ID)
    && isNullableInteger(event.parentEventId, 0, MAX_ID)
    && isSafeInteger(event.chainLength, 1, 8)
    && isSafeInteger(event.trapId, 1, MAX_ID)
    && (event.owner === 0 || event.owner === 1)
    && isTrapValue(event.kind)
    && (event.target === 0 || event.target === 1)
    && (event.responsibleActor === 0 || event.responsibleActor === 1)
    && isFiniteInteger(event.x, -CELL_UNITS, ARENA_WIDTH_CELLS * CELL_UNITS + CELL_UNITS)
    && isFiniteInteger(event.y, -CELL_UNITS, ARENA_HEIGHT_CELLS * CELL_UNITS + CELL_UNITS)
    && isSafeInteger(event.damage, 0, 100)
    && isFiniteInteger(event.pushX, -CELL_UNITS * 20, CELL_UNITS * 20)
    && isFiniteInteger(event.pushY, -CELL_UNITS * 20, CELL_UNITS * 20);
}

function mapHash(mapId: MapId): string {
  const map = getMapDefinition(mapId);
  const obstacles = [...map.obstacleCells]
    .sort((first, second) => first.cellY - second.cellY || first.cellX - second.cellX)
    .map((cell) => `${cell.cellX},${cell.cellY}`)
    .join('|');
  return hashText([
    map.id,
    map.playerSpawn.join(','),
    map.cpuSpawn.join(','),
    obstacles,
  ].join(';'));
}

function isWorld(value: unknown): value is WorldState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const world = value as Record<string, unknown>;
  if (world.phase !== 'battle'
    || !isSafeInteger(world.tick, 0, MATCH_TICKS - 1)
    || !isSafeInteger(world.seed, 0, MAX_ID)
    || !isMapId(world.mapId)
    || !isPairOfLoadouts(world.loadouts)
    || !Array.isArray(world.players)
    || world.players.length !== 2
    || !isPlayer(world.players[0], 0)
    || !isPlayer(world.players[1], 1)
    || !Array.isArray(world.shots)
    || world.shots.length > 4
    || !world.shots.every(isShot)
    || !Array.isArray(world.traps)
    || world.traps.length > 16
    || !world.traps.every(isTrap)
    || !isSafeInteger(world.nextEntityId, 2, MAX_ID)
    || !Array.isArray(world.shotsFired)
    || world.shotsFired.length !== 2
    || !world.shotsFired.every((value) => isSafeInteger(value, 0, MATCH_TICKS))
    || !Array.isArray(world.trapsPlaced)
    || world.trapsPlaced.length !== 2
    || !world.trapsPlaced.every((value) => isSafeInteger(value, 0, MATCH_TICKS))
    || !Array.isArray(world.trapsDisarmed)
    || world.trapsDisarmed.length !== 2
    || !world.trapsDisarmed.every((value) => isSafeInteger(value, 0, MATCH_TICKS))
    || !Array.isArray(world.events)
    || world.events.length > MAX_EVENT_LOG
    || !world.events.every(isEvent)
    || !isSafeInteger(world.nextEventId, 1, MAX_ID)
    || !isSafeInteger(world.nextChainId, 1, MAX_ID)
    || !isSafeInteger(world.maxChain, 0, 8)
    || world.result !== null
    || typeof world.lastHash !== 'string'
    || !HASH_PATTERN.test(world.lastHash)) {
    return false;
  }

  const typedWorld = world as unknown as WorldState;
  const entityIds = new Set<number>();
  let highestEntityId = 1;
  const trapsByOwner: [number, number] = [0, 0];
  for (const entity of [...typedWorld.traps, ...typedWorld.shots]) {
    if (entityIds.has(entity.id)) return false;
    entityIds.add(entity.id);
    highestEntityId = Math.max(highestEntityId, entity.id);
  }
  if (typedWorld.nextEntityId <= highestEntityId) return false;
  for (const trap of typedWorld.traps) {
    trapsByOwner[trap.owner] += 1;
    if (trapsByOwner[trap.owner] > MAX_ACTIVE_TRAPS) return false;
  }

  const eventIds = new Set<number>();
  let highestEventId = 0;
  let highestChainId = 0;
  let highestChainLength = 0;
  for (const event of typedWorld.events) {
    if (eventIds.has(event.id) || event.tick > typedWorld.tick) return false;
    eventIds.add(event.id);
    highestEventId = Math.max(highestEventId, event.id);
    highestChainId = Math.max(highestChainId, event.chainId);
    highestChainLength = Math.max(highestChainLength, event.chainLength);
    if (event.parentEventId !== null && !eventIds.has(event.parentEventId)) return false;
  }
  if (typedWorld.nextEventId <= highestEventId || typedWorld.nextChainId <= highestChainId) return false;
  if (typedWorld.maxChain < highestChainLength) return false;
  for (const trap of typedWorld.traps) {
    if (trap.triggerParentEventId !== undefined
      && trap.triggerParentEventId !== null
      && !eventIds.has(trap.triggerParentEventId)) return false;
    if (trap.triggerChainId !== undefined
      && trap.triggerChainId !== null
      && trap.triggerChainId >= typedWorld.nextChainId) return false;
  }
  for (const player of typedWorld.players) {
    if (player.investigation && !typedWorld.traps.some((trap) => trap.id === player.investigation?.targetTrapId)) {
      return false;
    }
  }
  const normalizedLoadouts = [
    normalizeTrapLoadout(typedWorld.loadouts[0]),
    normalizeTrapLoadout(typedWorld.loadouts[1]),
  ] as const;
  return normalizedLoadouts[0].every((kind, index) => kind === typedWorld.loadouts[0][index])
    && normalizedLoadouts[1].every((kind, index) => kind === typedWorld.loadouts[1][index])
    && hashWorld(typedWorld) === typedWorld.lastHash;
}

function byteLength(value: string): number {
  return typeof TextEncoder === 'undefined'
    ? value.length
    : new TextEncoder().encode(value).byteLength;
}

function isResume(value: unknown): value is MatchResume {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const resume = value as Record<string, unknown>;
  if (resume.schemaVersion !== RESUME_SCHEMA_VERSION
    || resume.engineVersion !== RESUME_ENGINE_VERSION
    || typeof resume.balanceConfigHash !== 'string'
    || !HASH_PATTERN.test(resume.balanceConfigHash)
    || resume.balanceConfigHash !== BALANCE_CONFIG_HASH
    || typeof resume.mapHash !== 'string'
    || !HASH_PATTERN.test(resume.mapHash)
    || resume.prngName !== RESUME_PRNG_NAME
    || !isSafeInteger(resume.savedAtMs, 0, Number.MAX_SAFE_INTEGER)
    || !isDifficulty(resume.difficulty)
    || !isWorld(resume.world)) {
    return false;
  }
  return resume.mapHash === mapHash(resume.world.mapId);
}

export function createMatchResume(
  world: WorldState,
  difficulty: CpuDifficulty,
  savedAtMs: number,
): MatchResume {
  return {
    schemaVersion: RESUME_SCHEMA_VERSION,
    engineVersion: RESUME_ENGINE_VERSION,
    balanceConfigHash: BALANCE_CONFIG_HASH,
    mapHash: mapHash(world.mapId),
    prngName: RESUME_PRNG_NAME,
    savedAtMs,
    difficulty,
    world,
  };
}

export function readMatchResume(raw: string | null | undefined, nowMs: number): MatchResume | null {
  if (!raw || byteLength(raw) > RESUME_MAX_JSON_BYTES || !isSafeInteger(nowMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isResume(parsed)) return null;
    const age = nowMs - parsed.savedAtMs;
    if (age < 0 || age > RESUME_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function serializeMatchResume(resume: MatchResume): string {
  return JSON.stringify(resume);
}
