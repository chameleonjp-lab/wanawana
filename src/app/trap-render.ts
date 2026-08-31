import type { TrapDirection, TrapKind } from '../core/types.ts';

export interface TrapGraphics {
  circle(x: number, y: number, radius: number): TrapGraphics;
  roundRect(x: number, y: number, width: number, height: number, radius: number): TrapGraphics;
  moveTo(x: number, y: number): TrapGraphics;
  lineTo(x: number, y: number): TrapGraphics;
  fill(style: { readonly color: number; readonly alpha?: number }): TrapGraphics;
  stroke(style: { readonly color: number; readonly alpha?: number; readonly width?: number }): TrapGraphics;
}

export interface TrapVisualState {
  readonly x: number;
  readonly y: number;
  /** The full visual size of one trap in pixels. */
  readonly size: number;
  readonly kind: TrapKind;
  readonly direction: TrapDirection;
  readonly owner: 0 | 1;
  readonly discovered: boolean;
  readonly color: number;
  readonly tick: number;
  readonly armingTicks: number;
  readonly remainingTicks: number;
  readonly triggerTicks?: number;
  readonly effectTicks?: number;
  /** Radius of the active gas field in pixels. */
  readonly effectRadius?: number;
  /** Preview graphics are ghosted and do not show an ownership badge. */
  readonly preview?: boolean;
  /** 0 disables pulse movement, 1 uses the normal rendering amplitude. */
  readonly motionScale?: number;
  readonly alpha?: number;
}

export interface TrapEventVisualState {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
  readonly age: number;
  readonly eventMarkerTicks: number;
  readonly burstTicks: number;
  readonly chainLength: number;
  readonly showRays: boolean;
  readonly motionScale?: number;
  readonly alpha?: number;
}

export interface TrapPreviewVisualState {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly kind: TrapKind;
  readonly direction: TrapDirection;
  readonly color: number;
  readonly tick: number;
  readonly motionScale?: number;
  readonly alpha?: number;
}

export const TRAP_DIRECTION_VECTORS: Readonly<Record<TrapDirection, readonly [number, number]>> = {
  0: [0, -1],
  1: [1, 0],
  2: [0, 1],
  3: [-1, 0],
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function pulseAt(tick: number, id: number, motionScale: number): number {
  if (motionScale === 0) return 0.5;
  return 0.5 + Math.sin((tick + id * 11) * 0.24) * 0.5 * motionScale;
}

function drawDashedRing(
  graphics: TrapGraphics,
  x: number,
  y: number,
  radius: number,
  color: number,
  alpha: number,
  width: number,
  dashCount = 10,
): void {
  const safeDashCount = Math.max(4, Math.floor(dashCount));
  for (let index = 0; index < safeDashCount; index += 2) {
    const start = (index / safeDashCount) * Math.PI * 2;
    const end = ((index + 1) / safeDashCount) * Math.PI * 2;
    graphics
      .moveTo(x + Math.cos(start) * radius, y + Math.sin(start) * radius)
      .lineTo(x + Math.cos(end) * radius, y + Math.sin(end) * radius);
  }
  graphics.stroke({ color, alpha, width });
}

function drawArrow(
  graphics: TrapGraphics,
  x: number,
  y: number,
  size: number,
  direction: TrapDirection,
  color: number,
  alpha: number,
  width: number,
): void {
  const [directionX, directionY] = TRAP_DIRECTION_VECTORS[direction];
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const shaftStart = size * 0.12;
  const shaftEnd = size * 0.34;
  const head = size * 0.12;
  const tipX = x + directionX * shaftEnd;
  const tipY = y + directionY * shaftEnd;

  graphics
    .moveTo(x + directionX * shaftStart, y + directionY * shaftStart)
    .lineTo(tipX, tipY)
    .moveTo(
      tipX - directionX * head + perpendicularX * head * 0.72,
      tipY - directionY * head + perpendicularY * head * 0.72,
    )
    .lineTo(tipX, tipY)
    .lineTo(
      tipX - directionX * head - perpendicularX * head * 0.72,
      tipY - directionY * head - perpendicularY * head * 0.72,
    )
    .stroke({ color, alpha, width });
}

function drawOwnershipBadge(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
): void {
  const badgeX = state.x + state.size * 0.31;
  const badgeY = state.y - state.size * 0.31;
  const badgeRadius = Math.max(2, state.size * 0.085);
  const badgeColor = state.owner === 0 ? 0x8cbdff : 0xff99c8;

  if (state.owner === 0) {
    graphics.circle(badgeX, badgeY, badgeRadius)
      .fill({ color: 0x211a37, alpha: alpha * 0.96 })
      .stroke({ color: badgeColor, alpha, width: Math.max(1, state.size * 0.04) });
    return;
  }

  const diamond = badgeRadius * 1.2;
  graphics
    .moveTo(badgeX, badgeY - diamond)
    .lineTo(badgeX + diamond, badgeY)
    .lineTo(badgeX, badgeY + diamond)
    .lineTo(badgeX - diamond, badgeY)
    .lineTo(badgeX, badgeY - diamond)
    .stroke({ color: badgeColor, alpha, width: Math.max(1, state.size * 0.04) });
  graphics.circle(badgeX, badgeY, badgeRadius * 0.35)
    .stroke({ color: 0xf7f1e7, alpha, width: Math.max(1, state.size * 0.03) });
  graphics
    .moveTo(badgeX - badgeRadius * 0.66, badgeY)
    .lineTo(badgeX + badgeRadius * 0.66, badgeY)
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.9, width: Math.max(1, state.size * 0.025) });
}

function drawBounceTrap(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  width: number,
): void {
  const [directionX, directionY] = TRAP_DIRECTION_VECTORS[state.direction];
  const perpendicularX = -directionY;
  const perpendicularY = directionX;
  const halfLength = state.size * 0.29;

  graphics
    .moveTo(
      state.x - perpendicularX * halfLength,
      state.y - perpendicularY * halfLength,
    )
    .lineTo(
      state.x + perpendicularX * halfLength,
      state.y + perpendicularY * halfLength,
    )
    .stroke({ color: state.color, alpha, width: Math.max(4, state.size * 0.18) });
  graphics
    .moveTo(
      state.x - perpendicularX * halfLength,
      state.y - perpendicularY * halfLength,
    )
    .lineTo(
      state.x + perpendicularX * halfLength,
      state.y + perpendicularY * halfLength,
    )
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.72, width });
  drawArrow(graphics, state.x, state.y, state.size, state.direction, 0xf7f1e7, alpha, width);
  graphics.circle(
    state.x - directionX * state.size * 0.18,
    state.y - directionY * state.size * 0.18,
    Math.max(2, state.size * 0.07),
  ).fill({ color: 0x211a37, alpha: alpha * 0.9 });
}

function drawShockTrap(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  width: number,
): void {
  const radius = state.size * 0.27;
  graphics.circle(state.x, state.y, radius)
    .fill({ color: state.color, alpha: alpha * 0.9 })
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.86, width });
  graphics.circle(state.x, state.y, radius * 0.52)
    .stroke({ color: 0x5c4a72, alpha, width: Math.max(1, width * 0.8) });

  const lightning = [
    [state.x - state.size * 0.13, state.y - state.size * 0.2],
    [state.x - state.size * 0.02, state.y - state.size * 0.04],
    [state.x - state.size * 0.1, state.y + state.size * 0.02],
    [state.x + state.size * 0.14, state.y + state.size * 0.2],
  ] as const;
  graphics.moveTo(lightning[0][0], lightning[0][1]);
  for (const [pointX, pointY] of lightning.slice(1)) graphics.lineTo(pointX, pointY);
  graphics.stroke({ color: 0xf7f1e7, alpha, width: Math.max(1.5, width) });
}

function drawHatchTrap(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  width: number,
): void {
  const side = state.size * 0.28;
  graphics.roundRect(
    state.x - side,
    state.y - side,
    side * 2,
    side * 2,
    state.size * 0.08,
  ).fill({ color: state.color, alpha: alpha * 0.9 })
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.86, width });

  graphics
    .moveTo(state.x, state.y - side * 0.88)
    .lineTo(state.x, state.y + side * 0.88)
    .moveTo(state.x - side * 0.88, state.y)
    .lineTo(state.x + side * 0.88, state.y)
    .stroke({ color: 0x5c4a72, alpha, width: Math.max(1, width * 0.8) });

  graphics
    .moveTo(state.x - side * 0.64, state.y - side * 0.64)
    .lineTo(state.x + side * 0.64, state.y + side * 0.64)
    .moveTo(state.x + side * 0.64, state.y - side * 0.64)
    .lineTo(state.x - side * 0.64, state.y + side * 0.64)
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.78, width: Math.max(1, width * 0.75) });
}

function drawBombTrap(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  width: number,
): void {
  const radius = state.size * 0.25;
  graphics.circle(state.x, state.y, radius)
    .fill({ color: state.color, alpha: alpha * 0.92 })
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.9, width });
  graphics.circle(
    state.x - state.size * 0.08,
    state.y - state.size * 0.08,
    Math.max(1.5, state.size * 0.055),
  ).fill({ color: 0xfff2b0, alpha });
  graphics
    .moveTo(state.x, state.y - radius)
    .lineTo(state.x + state.size * 0.06, state.y - state.size * 0.35)
    .lineTo(state.x + state.size * 0.16, state.y - state.size * 0.39)
    .stroke({ color: 0xfff2b0, alpha, width: Math.max(1.5, width) });
  graphics.circle(
    state.x + state.size * 0.18,
    state.y - state.size * 0.4,
    Math.max(1.5, state.size * 0.045),
  ).fill({ color: 0xfff2b0, alpha });
}

function drawMoyaTrap(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  width: number,
): void {
  const bodyWidth = state.size * 0.25;
  const bodyHeight = state.size * 0.42;
  graphics.roundRect(
    state.x - bodyWidth / 2,
    state.y - bodyHeight * 0.28,
    bodyWidth,
    bodyHeight,
    state.size * 0.08,
  ).fill({ color: state.color, alpha: alpha * 0.9 })
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.88, width });
  graphics.roundRect(
    state.x - state.size * 0.08,
    state.y - state.size * 0.48,
    state.size * 0.16,
    state.size * 0.15,
    state.size * 0.03,
  ).fill({ color: 0x5c4a72, alpha })
    .stroke({ color: 0xf7f1e7, alpha: alpha * 0.82, width: Math.max(1, width * 0.8) });
  graphics
    .moveTo(state.x - state.size * 0.2, state.y + state.size * 0.26)
    .lineTo(state.x + state.size * 0.2, state.y + state.size * 0.26)
    .stroke({ color: 0x5c4a72, alpha, width: Math.max(1, width * 0.8) });
}

function drawGasField(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  motionScale: number,
): void {
  const radius = Math.max(state.size * 0.55, state.effectRadius ?? state.size * 1.6);
  const pulse = pulseAt(state.tick, state.owner, motionScale);
  graphics.circle(state.x, state.y, radius)
    .stroke({ color: state.color, alpha: alpha * (0.3 + pulse * 0.18), width: Math.max(1.5, state.size * 0.06) });
  for (const [offsetX, offsetY, bubble] of [
    [-0.4, -0.2, 0.12],
    [0.35, -0.05, 0.1],
    [0.1, 0.35, 0.14],
  ] as const) {
    graphics.circle(
      state.x + offsetX * radius,
      state.y + offsetY * radius,
      state.size * bubble * (0.9 + pulse * 0.16),
    ).stroke({ color: state.color, alpha: alpha * 0.42, width: Math.max(1, state.size * 0.035) });
  }
}

function drawActivationCue(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
  motionScale: number,
): void {
  const triggerTicks = state.triggerTicks ?? 0;
  const effectTicks = state.effectTicks ?? 0;
  if (state.kind === 'moya' && effectTicks > 0) return;
  if (triggerTicks <= 0 && effectTicks <= 0) return;

  const pulse = pulseAt(state.tick, state.owner, motionScale);
  const radius = state.size * (0.48 + pulse * 0.08);
  graphics.circle(state.x, state.y, radius)
    .stroke({ color: state.color, alpha: alpha * (0.55 + pulse * 0.25), width: Math.max(1.5, state.size * 0.06) });
}

function drawArmingCue(
  graphics: TrapGraphics,
  state: TrapVisualState,
  alpha: number,
): void {
  if (state.armingTicks <= 0 || state.preview) return;
  drawDashedRing(
    graphics,
    state.x,
    state.y,
    state.size * 0.52,
    state.color,
    alpha * 0.92,
    Math.max(1.2, state.size * 0.045),
    state.owner === 0 ? 10 : 8,
  );
}

export function drawTrap(graphics: TrapGraphics, state: TrapVisualState): void {
  if (state.owner === 1 && !state.discovered) return;

  const alpha = clampUnit(state.alpha ?? 1);
  const motionScale = clampUnit(state.motionScale ?? 1);
  const width = Math.max(1.2, state.size * 0.045);
  const bodyAlpha = alpha * (state.preview ? 0.48 : state.armingTicks > 0 ? 0.62 : 0.94);

  if (state.kind === 'moya' && (state.effectTicks ?? 0) > 0) {
    drawGasField(graphics, state, alpha, motionScale);
  }

  if (state.kind === 'bounce') drawBounceTrap(graphics, state, bodyAlpha, width);
  if (state.kind === 'shock') drawShockTrap(graphics, state, bodyAlpha, width);
  if (state.kind === 'hatch') drawHatchTrap(graphics, state, bodyAlpha, width);
  if (state.kind === 'bomb') drawBombTrap(graphics, state, bodyAlpha, width);
  if (state.kind === 'moya') drawMoyaTrap(graphics, state, bodyAlpha, width);

  drawArmingCue(graphics, state, alpha);
  if (!state.preview) drawOwnershipBadge(graphics, state, alpha);
  drawActivationCue(graphics, state, alpha, motionScale);
}

export function drawTrapPreview(graphics: TrapGraphics, state: TrapPreviewVisualState): void {
  drawTrap(graphics, {
    ...state,
    owner: 0,
    discovered: true,
    armingTicks: 1,
    remainingTicks: 1,
    triggerTicks: 0,
    effectTicks: 0,
    preview: true,
  });
  const alpha = clampUnit(state.alpha ?? 1);
  const width = Math.max(1.2, state.size * 0.045);
  drawDashedRing(graphics, state.x, state.y, state.size * 0.56, 0xf2b8ff, alpha * 0.92, width, 12);
  drawArrow(graphics, state.x, state.y, state.size, state.direction, 0xffffff, alpha, Math.max(1.4, state.size * 0.05));
}

export function drawTrapEvent(graphics: TrapGraphics, state: TrapEventVisualState): void {
  if (state.age < 0 || state.age > state.eventMarkerTicks) return;

  const alpha = clampUnit(state.alpha ?? 1);
  const motionScale = clampUnit(state.motionScale ?? 1);
  const ageRatio = state.eventMarkerTicks <= 0 ? 1 : Math.max(0, state.age / state.eventMarkerTicks);
  const markerRadius = state.showRays
    ? Math.max(state.size * 0.22, state.size * (0.2 + state.age / 180))
    : Math.max(state.size * 0.22, state.size * 0.28);
  const markerAlpha = state.showRays
    ? Math.max(0.2, 1 - ageRatio)
    : 0.86;
  const width = Math.max(1.5, state.size * 0.055);

  graphics.circle(state.x, state.y, markerRadius)
    .stroke({ color: state.color, alpha: alpha * markerAlpha, width });
  if (state.chainLength >= 2) {
    graphics.circle(state.x, state.y, markerRadius * 0.56)
      .stroke({ color: 0xf7f1e7, alpha: alpha * markerAlpha * 0.86, width: Math.max(1, width * 0.7) });
  }

  if (!state.showRays || state.age > state.burstTicks) return;
  const pulse = pulseAt(state.age, state.chainLength, motionScale);
  const burstAlpha = alpha * Math.max(0.08, 0.7 - state.age / 18) * (0.86 + pulse * 0.14);
  const burstRadius = state.size * (0.28 + state.age / 60);
  graphics.circle(state.x, state.y, burstRadius)
    .stroke({ color: state.color, alpha: burstAlpha, width });
  for (let ray = 0; ray < 4; ray += 1) {
    const angle = ray * Math.PI / 2;
    const startRadius = burstRadius * 1.25;
    const endRadius = burstRadius * 1.8;
    graphics
      .moveTo(state.x + Math.cos(angle) * startRadius, state.y + Math.sin(angle) * startRadius)
      .lineTo(state.x + Math.cos(angle) * endRadius, state.y + Math.sin(angle) * endRadius);
  }
  graphics.stroke({ color: state.color, alpha: burstAlpha, width });
}
