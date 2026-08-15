import { describe, expect, it } from 'vitest';
import {
  emptyMatchSummary,
  readMatchSummary,
  recordMatchSummary,
  serializeMatchSummary,
} from '../../src/core/progress.ts';

describe('terminal match summary', () => {
  it('starts empty and records only a completed result', () => {
    const empty = emptyMatchSummary();
    expect(recordMatchSummary(empty, {
      result: null,
      maxChain: 4,
      trapsPlaced: 2,
      trapsDisarmed: 1,
    })).toEqual(empty);

    const next = recordMatchSummary(empty, {
      result: 'player-win',
      maxChain: 4,
      trapsPlaced: 2,
      trapsDisarmed: 1,
    });
    expect(next).toMatchObject({
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      bestChain: 4,
      trapsPlaced: 2,
      trapsDisarmed: 1,
    });
  });

  it('counts draws and excludes technical invalidation from the saved record', () => {
    let summary = emptyMatchSummary();
    summary = recordMatchSummary(summary, {
      result: 'time-draw',
      maxChain: 0,
      trapsPlaced: 0,
      trapsDisarmed: 0,
    });
    summary = recordMatchSummary(summary, {
      result: 'technical-invalid',
      maxChain: 0,
      trapsPlaced: 0,
      trapsDisarmed: 0,
    });
    expect(summary).toMatchObject({ matches: 1, draws: 1 });
    expect(summary).not.toHaveProperty('technicalInvalid');
  });

  it('resets malformed, future, and out-of-range storage values', () => {
    expect(readMatchSummary('{not-json')).toEqual(emptyMatchSummary());
    expect(readMatchSummary(JSON.stringify({ schemaVersion: 2 }))).toEqual(emptyMatchSummary());
    expect(readMatchSummary(JSON.stringify({
      ...emptyMatchSummary(),
      matches: -1,
    }))).toEqual(emptyMatchSummary());
    expect(readMatchSummary(JSON.stringify({
      ...emptyMatchSummary(),
      wins: 2,
      matches: 1,
    }))).toEqual(emptyMatchSummary());
  });

  it('serializes a validated summary without adding storage fields', () => {
    const summary = recordMatchSummary(emptyMatchSummary(), {
      result: 'cpu-win',
      maxChain: 3,
      trapsPlaced: 1,
      trapsDisarmed: 0,
    });
    expect(readMatchSummary(serializeMatchSummary(summary))).toEqual(summary);
  });
});
