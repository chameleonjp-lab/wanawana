import type { ViewportSize } from './viewport.ts';

export type BattleOrientation = 'portrait' | 'landscape' | 'unknown';

export function classifyBattleOrientation(size: ViewportSize): BattleOrientation {
  if (size.width <= 0 || size.height <= 0) return 'unknown';
  if (size.height > size.width) return 'portrait';
  if (size.width > size.height) return 'landscape';
  return 'unknown';
}

export function isPortraitBattleOrientation(size: ViewportSize): boolean {
  return classifyBattleOrientation(size) === 'portrait';
}

export function battleOrientationMessage(size: ViewportSize): string {
  const orientation = classifyBattleOrientation(size);
  if (orientation === 'landscape') return '横向きでは試合を続けられません。縦向きに戻してください。';
  if (orientation === 'unknown') return '表示領域を確認できません。縦向きに戻してから再開してください。';
  return '';
}
