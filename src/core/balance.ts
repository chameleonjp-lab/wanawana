import * as fixed from './fixed.ts';
import * as types from './types.ts';
import { hashText } from './hash.ts';

type BalanceValue = number | string | boolean | readonly unknown[] | Record<string, unknown>;

function isBalanceValue(value: unknown): value is BalanceValue {
  return typeof value === 'number'
    || typeof value === 'string'
    || typeof value === 'boolean'
    || Array.isArray(value)
    || (typeof value === 'object' && value !== null);
}

function serializeNamespace(namespace: object): string {
  return Object.entries(namespace)
    .filter(([, value]) => isBalanceValue(value))
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join('|');
}

/**
 * Hash every exported numeric or data-only rule value used by the simulation.
 * A tuning change therefore invalidates older replays and resume snapshots
 * instead of silently applying new rules to old commands.
 */
export const BALANCE_CONFIG_HASH = hashText([
  'wanawana-balance-v2',
  serializeNamespace(types),
  serializeNamespace(fixed),
].join('|'));
