import { describe, expect, it } from 'vitest';
import {
  normalizeReplayCommand,
  readReplayRecord,
  ReplayRecorder,
  serializeReplayRecord,
  verifyReplayRecord,
  type MatchReplay,
} from '../../src/core/replay.ts';
import { BALANCE_CONFIG_HASH } from '../../src/core/balance.ts';
import { advanceWorld, createWorld } from '../../src/core/sim.ts';

describe('deterministic match records', () => {
  it('records normalized commands and verifies the same final world', () => {
    const initial = createWorld(77, ['bounce', 'bomb', 'moya'], ['bounce', 'shock', 'hatch'], 'ring');
    const recorder = new ReplayRecorder(initial, { buildCommit: 'test-build' });
    let world = initial;

    for (let tick = 0; tick < 12; tick += 1) {
      const playerCommand = { moveX: (tick % 2 === 0 ? 1 : 0) as -1 | 0 | 1, fire: tick === 3 };
      const cpuCommand = { moveY: (tick % 3 === 0 ? -1 : 0) as -1 | 0 | 1, fire: tick === 5 };
      world = advanceWorld(world, playerCommand, cpuCommand);
      recorder.recordTick(playerCommand, cpuCommand, world);
    }

    const record = recorder.finish(world);
    expect(record).not.toBeNull();
    if (!record) return;
    expect(record.commands).toHaveLength(12);
    expect(record.balanceConfigHash).toBe(BALANCE_CONFIG_HASH);
    expect(record.checkpoints.at(-1)?.tick).toBe(12);
    expect(record.finalHash).toBe(world.lastHash);

    const parsed = readReplayRecord(serializeReplayRecord(record));
    expect(parsed).not.toBeNull();
    expect(verifyReplayRecord(parsed as MatchReplay)).toMatchObject({
      valid: true,
      mismatchTick: null,
      reason: null,
    });
    expect(verifyReplayRecord(parsed as MatchReplay).world).toEqual(world);
  });

  it('rejects a changed engine version or malformed payload', () => {
    const initial = createWorld(78);
    const recorder = new ReplayRecorder(initial, { buildCommit: 'test-build' });
    const world = advanceWorld(initial, { moveX: 1 }, { moveX: -1 });
    recorder.recordTick({ moveX: 1 }, { moveX: -1 }, world);
    const record = recorder.finish(world);
    expect(record).not.toBeNull();
    if (!record) return;

    const changedVersion = { ...record, engineVersion: 'other-engine-v9' } as MatchReplay;
    expect(verifyReplayRecord(changedVersion).valid).toBe(false);
    expect(readReplayRecord('{"schemaVersion":999}')).toBeNull();
    expect(readReplayRecord('not-json')).toBeNull();
    expect(readReplayRecord(JSON.stringify({
      ...record,
      checkpoints: [...record.checkpoints, { tick: record.commands.length + 1, hash: record.finalHash }],
    }))).toBeNull();
  });

  it('does not produce a shareable record for a technically invalid match', () => {
    const initial = createWorld(81);
    const recorder = new ReplayRecorder(initial);
    const invalidWorld = {
      ...initial,
      phase: 'result' as const,
      result: 'technical-invalid' as const,
    };
    expect(recorder.finish(invalidWorld)).toBeNull();
  });

  it('rejects records that claim a result without a final hash or share a technical stop', () => {
    const initial = createWorld(82);
    const recorder = new ReplayRecorder(initial);
    const world = advanceWorld(initial, { moveX: 1 });
    recorder.recordTick({ moveX: 1 }, {}, world);
    const record = recorder.finish(world);
    expect(record).not.toBeNull();
    if (!record) return;

    expect(readReplayRecord(JSON.stringify({
      ...record,
      result: 'player-win',
      finalHash: null,
    }))).toBeNull();
    expect(readReplayRecord(JSON.stringify({
      ...record,
      result: 'technical-invalid',
    }))).toBeNull();
  });

  it('reports the first checkpoint mismatch', () => {
    const initial = createWorld(79);
    const recorder = new ReplayRecorder(initial);
    let world = advanceWorld(initial, { moveX: 1 });
    recorder.recordTick({ moveX: 1 }, {}, world);
    const record = recorder.finish(world);
    expect(record).not.toBeNull();
    if (!record) return;

    const changedStart = {
      ...record,
      checkpoints: [{ ...record.checkpoints[0], hash: '00000000' }, ...record.checkpoints.slice(1)],
    } as MatchReplay;
    const verification = verifyReplayRecord(changedStart);
    expect(verification.valid).toBe(false);
    expect(verification.mismatchTick).toBe(0);
  });

  it('rejects a tampered accepted command at its first divergent checkpoint', () => {
    const initial = createWorld(80);
    const recorder = new ReplayRecorder(initial);
    let world = initial;
    for (let tick = 0; tick < 301; tick += 1) {
      world = advanceWorld(world, { moveX: tick === 4 ? 1 : 0 }, {});
      recorder.recordTick({ moveX: tick === 4 ? 1 : 0 }, {}, world);
    }
    const record = recorder.finish(world);
    expect(record).not.toBeNull();
    if (!record) return;

    const tamperedCommands = record.commands.map((command) => command.tick === 5
      ? { ...command, player: { ...command.player, moveX: 0 as const } }
      : command);
    const verification = verifyReplayRecord({ ...record, commands: tamperedCommands });
    expect(verification.valid).toBe(false);
    expect(verification.mismatchTick).toBe(300);
  });

  it('normalizes movement, trap, and cell values before recording', () => {
    const command = normalizeReplayCommand({
      moveX: 7,
      moveY: -7,
      fire: true,
      placeTrap: 'not-a-trap' as never,
      trapCellX: 999,
      trapCellY: -4,
      trapDirection: 99,
    } as unknown as Parameters<typeof normalizeReplayCommand>[0]);
    expect(command).toMatchObject({
      moveX: 1,
      moveY: -1,
      fire: true,
      trapCellX: 8,
      trapCellY: 0,
      trapDirection: 0,
      investigate: false,
      investigateStart: false,
    });
    expect(command.placeTrap).toBeUndefined();
  });
});
