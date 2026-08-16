import {
  isTrapKind,
  normalizeCommand,
} from './fixed.ts';
import { hashText } from './hash.ts';
import { getMapDefinition, isMapId } from './maps.ts';
import { advanceWorld, createWorld } from './sim.ts';
import {
  ARENA_HEIGHT_CELLS,
  ARENA_WIDTH_CELLS,
  TICK_RATE,
  type InputCommand,
  type MapId,
  type MatchResult,
  type TrapLoadout,
  type WorldState,
} from './types.ts';

export const REPLAY_SCHEMA_VERSION = 1 as const;
export const REPLAY_INPUT_ENCODING_VERSION = 1 as const;
export const REPLAY_ENGINE_VERSION = 'wanawana-sim-v1' as const;
export const REPLAY_PRNG_NAME = 'fixed-integer-v1' as const;
export const REPLAY_CHECKPOINT_INTERVAL_TICKS = 300;
export const MAX_REPLAY_COMMANDS = 11_000;
export const MAX_REPLAY_CHECKPOINTS = 100;
export const MAX_REPLAY_JSON_BYTES = 2_000_000;

const BALANCE_CONFIG_ID = 'wanawana-balance-v1';
const HASH_PATTERN = /^[0-9a-f]{8}$/;

export interface ReplayCommand {
  readonly tick: number;
  readonly player: InputCommand;
  readonly cpu: InputCommand;
}

export interface ReplayCheckpoint {
  readonly tick: number;
  readonly hash: string;
}

export interface MatchReplay {
  readonly schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  readonly engineVersion: string;
  readonly buildCommit: string;
  readonly balanceConfigHash: string;
  readonly mapHash: string;
  readonly prngName: typeof REPLAY_PRNG_NAME;
  readonly seed: number;
  readonly tickRate: typeof TICK_RATE;
  readonly inputEncodingVersion: typeof REPLAY_INPUT_ENCODING_VERSION;
  readonly mapId: MapId;
  readonly loadouts: readonly [TrapLoadout, TrapLoadout];
  readonly commands: readonly ReplayCommand[];
  readonly checkpoints: readonly ReplayCheckpoint[];
  readonly finalHash: string | null;
  readonly result: MatchResult | null;
}

export interface ReplayVerification {
  readonly valid: boolean;
  readonly world: WorldState;
  readonly mismatchTick: number | null;
  readonly reason: string | null;
}

function clampCell(value: number | undefined, maximum: number): number | undefined {
  if (!Number.isInteger(value)) return undefined;
  return Math.min(maximum - 1, Math.max(0, value as number));
}

/** Convert an input boundary value into the exact command stored in a replay. */
export function normalizeReplayCommand(command: Partial<InputCommand>): InputCommand {
  const normalized = normalizeCommand(command);
  return {
    moveX: normalized.moveX,
    moveY: normalized.moveY,
    fire: normalized.fire,
    placeTrap: isTrapKind(normalized.placeTrap) ? normalized.placeTrap : undefined,
    trapDirection: normalized.trapDirection,
    trapCellX: clampCell(normalized.trapCellX, ARENA_WIDTH_CELLS),
    trapCellY: clampCell(normalized.trapCellY, ARENA_HEIGHT_CELLS),
    investigate: normalized.investigate,
    investigateStart: normalized.investigateStart,
  };
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

function isSafeString(value: unknown, maximumLength = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isSafeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isCommand(value: unknown): value is InputCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  const validCellX = command.trapCellX === undefined || isSafeInteger(command.trapCellX, 0, ARENA_WIDTH_CELLS - 1);
  const validCellY = command.trapCellY === undefined || isSafeInteger(command.trapCellY, 0, ARENA_HEIGHT_CELLS - 1);
  return (command.moveX === -1 || command.moveX === 0 || command.moveX === 1)
    && (command.moveY === -1 || command.moveY === 0 || command.moveY === 1)
    && typeof command.fire === 'boolean'
    && (command.placeTrap === undefined
      || (typeof command.placeTrap === 'string' && isTrapKind(command.placeTrap)))
    && isSafeInteger(command.trapDirection, 0, 3)
    && validCellX
    && validCellY
    && typeof command.investigate === 'boolean'
    && typeof command.investigateStart === 'boolean';
}

function isLoadout(value: unknown): value is TrapLoadout {
  return Array.isArray(value)
    && value.length === 3
    && value.every((kind) => isTrapKind(kind))
    && value[0] === 'bounce';
}

function isReplayCommand(value: unknown, expectedTick: number): value is ReplayCommand {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  return command.tick === expectedTick && isCommand(command.player) && isCommand(command.cpu);
}

function isCheckpoint(value: unknown): value is ReplayCheckpoint {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const checkpoint = value as Record<string, unknown>;
  return isSafeInteger(checkpoint.tick, 0, MAX_REPLAY_COMMANDS)
    && typeof checkpoint.hash === 'string'
    && HASH_PATTERN.test(checkpoint.hash);
}

function isMatchResult(value: unknown): value is MatchResult | null {
  return value === null
    || value === 'player-win'
    || value === 'cpu-win'
    || value === 'draw'
    || value === 'time-draw'
    || value === 'technical-invalid';
}

function isReplayRecord(value: unknown): value is MatchReplay {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== REPLAY_SCHEMA_VERSION
    || !isSafeString(record.engineVersion)
    || !isSafeString(record.buildCommit)
    || typeof record.balanceConfigHash !== 'string'
    || !HASH_PATTERN.test(record.balanceConfigHash)
    || typeof record.mapHash !== 'string'
    || !HASH_PATTERN.test(record.mapHash)
    || record.prngName !== REPLAY_PRNG_NAME
    || !isSafeInteger(record.seed, 0, 0xffff_ffff)
    || record.tickRate !== TICK_RATE
    || record.inputEncodingVersion !== REPLAY_INPUT_ENCODING_VERSION
    || !isMapId(record.mapId)
    || !Array.isArray(record.loadouts)
    || record.loadouts.length !== 2
    || !isLoadout(record.loadouts[0])
    || !isLoadout(record.loadouts[1])
    || !Array.isArray(record.commands)
    || record.commands.length > MAX_REPLAY_COMMANDS
    || !record.commands.every((command, index) => isReplayCommand(command, index + 1))
    || !Array.isArray(record.checkpoints)
    || record.checkpoints.length === 0
    || record.checkpoints.length > MAX_REPLAY_CHECKPOINTS
    || !record.checkpoints.every(isCheckpoint)
    || record.checkpoints[0].tick !== 0
    || !record.checkpoints.every((checkpoint, index, checkpoints) => index === 0 || checkpoint.tick > checkpoints[index - 1].tick)
    || (record.finalHash !== null && (typeof record.finalHash !== 'string' || !HASH_PATTERN.test(record.finalHash)))
    || !isMatchResult(record.result)) {
    return false;
  }
  return true;
}

function createReplayRecord(
  world: WorldState,
  engineVersion: string,
  buildCommit: string,
): MatchReplay {
  const normalizedMapId = getMapDefinition(world.mapId).id;
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    engineVersion,
    buildCommit,
    balanceConfigHash: hashText(BALANCE_CONFIG_ID),
    mapHash: mapHash(normalizedMapId),
    prngName: REPLAY_PRNG_NAME,
    seed: world.seed >>> 0,
    tickRate: TICK_RATE,
    inputEncodingVersion: REPLAY_INPUT_ENCODING_VERSION,
    mapId: normalizedMapId,
    loadouts: world.loadouts,
    commands: [],
    checkpoints: [{ tick: world.tick, hash: world.lastHash }],
    finalHash: null,
    result: null,
  };
}

export class ReplayRecorder {
  private readonly engineVersion: string;
  private readonly buildCommit: string;
  private readonly commands: ReplayCommand[] = [];
  private readonly checkpoints: ReplayCheckpoint[];
  private readonly initial: MatchReplay;
  private failed = false;

  public constructor(
    world: WorldState,
    options: { readonly engineVersion?: string; readonly buildCommit?: string } = {},
  ) {
    this.engineVersion = options.engineVersion ?? REPLAY_ENGINE_VERSION;
    this.buildCommit = options.buildCommit ?? 'local';
    this.initial = createReplayRecord(world, this.engineVersion, this.buildCommit);
    this.checkpoints = [...this.initial.checkpoints];
  }

  public recordTick(
    playerCommand: Partial<InputCommand>,
    cpuCommand: Partial<InputCommand>,
    world: WorldState,
  ): void {
    if (this.failed || this.commands.length >= MAX_REPLAY_COMMANDS) {
      this.failed = true;
      return;
    }
    const expectedTick = this.commands.length + 1;
    if (world.tick !== expectedTick) {
      this.failed = true;
      return;
    }
    this.commands.push({
      tick: world.tick,
      player: normalizeReplayCommand(playerCommand),
      cpu: normalizeReplayCommand(cpuCommand),
    });
    if (world.tick % REPLAY_CHECKPOINT_INTERVAL_TICKS === 0 && this.checkpoints.length < MAX_REPLAY_CHECKPOINTS) {
      this.checkpoints.push({ tick: world.tick, hash: world.lastHash });
    }
  }

  public finish(world: WorldState): MatchReplay | null {
    if (this.failed || world.tick !== this.commands.length) return null;
    const checkpoints = [...this.checkpoints];
    if (checkpoints[checkpoints.length - 1]?.tick !== world.tick && checkpoints.length < MAX_REPLAY_CHECKPOINTS) {
      checkpoints.push({ tick: world.tick, hash: world.lastHash });
    }
    const record: MatchReplay = {
      ...this.initial,
      commands: [...this.commands],
      checkpoints,
      finalHash: world.lastHash,
      result: world.result,
    };
    return isReplayRecord(record) ? record : null;
  }
}

export function serializeReplayRecord(record: MatchReplay): string {
  if (!isReplayRecord(record)) throw new Error('Invalid replay record');
  const serialized = JSON.stringify(record);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REPLAY_JSON_BYTES) {
    throw new Error('Replay record is too large');
  }
  return serialized;
}

export function readReplayRecord(raw: string | null | undefined): MatchReplay | null {
  if (!raw || new TextEncoder().encode(raw).byteLength > MAX_REPLAY_JSON_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isReplayRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function verifyReplayRecord(record: MatchReplay): ReplayVerification {
  if (!isReplayRecord(record)) {
    return { valid: false, world: createWorld(0), mismatchTick: null, reason: '記録形式が不正です。' };
  }

  if (record.engineVersion !== REPLAY_ENGINE_VERSION
    || record.balanceConfigHash !== hashText(BALANCE_CONFIG_ID)
    || record.mapHash !== mapHash(record.mapId)) {
    return {
      valid: false,
      world: createWorld(0),
      mismatchTick: null,
      reason: '実装版、調整値、または面の版が現在と一致しません。',
    };
  }

  let world = createWorld(record.seed, record.loadouts[0], record.loadouts[1], record.mapId);
  const initialCheckpoint = record.checkpoints.find((checkpoint) => checkpoint.tick === 0);
  if (!initialCheckpoint || initialCheckpoint.hash !== world.lastHash) {
    return { valid: false, world, mismatchTick: 0, reason: '開始時の状態ハッシュが一致しません。' };
  }

  const checkpointByTick = new Map(record.checkpoints.map((checkpoint) => [checkpoint.tick, checkpoint.hash]));
  for (const command of record.commands) {
    if (world.phase !== 'battle') {
      return { valid: false, world, mismatchTick: command.tick, reason: '試合終了後の命令が含まれています。' };
    }
    world = advanceWorld(world, command.player, command.cpu);
    const expectedHash = checkpointByTick.get(world.tick);
    if (expectedHash && expectedHash !== world.lastHash) {
      return { valid: false, world, mismatchTick: world.tick, reason: '途中の状態ハッシュが一致しません。' };
    }
  }

  if (record.finalHash !== null && record.finalHash !== world.lastHash) {
    return { valid: false, world, mismatchTick: world.tick, reason: '最終状態ハッシュが一致しません。' };
  }
  if (record.result !== null && record.result !== world.result) {
    return { valid: false, world, mismatchTick: world.tick, reason: '勝敗結果が一致しません。' };
  }
  return { valid: true, world, mismatchTick: null, reason: null };
}
