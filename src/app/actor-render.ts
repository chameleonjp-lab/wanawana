import { Graphics } from 'pixi.js';

export type ActorAction = 'idle' | 'moving' | 'firing' | 'placing' | 'investigating' | 'disabled';
export type ActorFacing = 'up' | 'right' | 'down' | 'left';

export interface ActorVisualState {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly color: number;
  readonly outlineColor: number;
  readonly accentColor: number;
  readonly id: 0 | 1;
  readonly tick: number;
  readonly facing: ActorFacing;
  readonly action: ActorAction;
  /** 0 disables animation, 1 is the normal amplitude. */
  readonly motionScale?: number;
  readonly alpha?: number;
}

const FACING_VECTOR: Record<ActorFacing, readonly [number, number]> = {
  up: [0, -1],
  right: [1, 0],
  down: [0, 1],
  left: [-1, 0],
};

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Keeps the character facing the last meaningful movement direction. The
 * fallback makes the two actors readable before either has moved.
 */
export function facingFromDelta(
  deltaX: number,
  deltaY: number,
  fallback: ActorFacing,
): ActorFacing {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return fallback;
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return fallback;
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return deltaX < 0 ? 'left' : 'right';
  return deltaY < 0 ? 'up' : 'down';
}

function drawGroundCue(graphics: Graphics, state: ActorVisualState, bodyY: number, alpha: number): void {
  if (state.action === 'idle' || state.action === 'moving') return;
  const scale = clampUnit(state.motionScale ?? 1);
  const pulse = 0.5 + Math.sin((state.tick + state.id * 13) * 0.28) * 0.5 * scale;
  const cueColor = state.action === 'disabled' ? 0xff99c8 : state.accentColor;
  const radius = state.size * (state.action === 'disabled' ? 0.46 : 0.38 + pulse * 0.05);
  graphics.circle(state.x, bodyY + state.size * 0.29, radius)
    .stroke({ color: cueColor, alpha: alpha * (0.45 + pulse * 0.3), width: Math.max(1.5, state.size * 0.055) });
}

function drawToolCue(graphics: Graphics, state: ActorVisualState, headX: number, headY: number, alpha: number): void {
  const direction = FACING_VECTOR[state.facing];
  const side = state.facing === 'left' ? -1 : state.facing === 'right' ? 1 : state.id === 0 ? 1 : -1;
  const toolX = headX + side * state.size * 0.4;
  const toolY = headY + state.size * 0.04;
  if (state.action === 'placing') {
    graphics.roundRect(toolX - state.size * 0.06, toolY - state.size * 0.22, state.size * 0.12, state.size * 0.34, state.size * 0.05)
      .fill({ color: 0xfff2b0, alpha });
    graphics.moveTo(toolX - state.size * 0.17, toolY - state.size * 0.22)
      .lineTo(toolX + state.size * 0.17, toolY - state.size * 0.22)
      .stroke({ color: 0xfff2b0, alpha, width: Math.max(1.5, state.size * 0.055) });
  } else if (state.action === 'investigating') {
    graphics.circle(toolX, toolY - state.size * 0.08, state.size * 0.13)
      .stroke({ color: 0xf7f1e7, alpha, width: Math.max(1.5, state.size * 0.055) });
    graphics.moveTo(toolX + side * state.size * 0.08, toolY + state.size * 0.03)
      .lineTo(toolX + side * state.size * 0.2, toolY + state.size * 0.16)
      .stroke({ color: 0xf7f1e7, alpha, width: Math.max(1.5, state.size * 0.055) });
  } else if (state.action === 'firing') {
    const [directionX, directionY] = direction;
    const muzzleX = headX + directionX * state.size * 0.31;
    const muzzleY = headY + directionY * state.size * 0.31;
    graphics.circle(muzzleX, muzzleY, state.size * 0.09)
      .fill({ color: 0xfff2b0, alpha });
    graphics.moveTo(muzzleX - state.size * 0.16, muzzleY)
      .lineTo(muzzleX + state.size * 0.16, muzzleY)
      .moveTo(muzzleX, muzzleY - state.size * 0.16)
      .lineTo(muzzleX, muzzleY + state.size * 0.16)
      .stroke({ color: 0xfff2b0, alpha, width: Math.max(1.5, state.size * 0.05) });
  } else if (state.action === 'disabled') {
    graphics.moveTo(headX - state.size * 0.22, headY - state.size * 0.22)
      .lineTo(headX + state.size * 0.22, headY + state.size * 0.22)
      .moveTo(headX + state.size * 0.22, headY - state.size * 0.22)
      .lineTo(headX - state.size * 0.22, headY + state.size * 0.22)
      .stroke({ color: 0xff99c8, alpha, width: Math.max(2, state.size * 0.075) });
  }
}

export function drawActor(graphics: Graphics, state: ActorVisualState): void {
  const alpha = clampUnit(state.alpha ?? 1);
  const motionScale = clampUnit(state.motionScale ?? 1);
  const [directionX, directionY] = FACING_VECTOR[state.facing];
  const moving = state.action === 'moving';
  const breathing = Math.sin((state.tick + state.id * 17) * 0.18) * state.size * 0.025 * motionScale;
  const bodyY = state.y + breathing;
  const stride = moving
    ? Math.sin((state.tick + state.id * 7) * 0.48) * state.size * 0.11 * motionScale
    : 0;

  // The shadow stays still so the body movement remains easy to read.
  graphics.roundRect(
    state.x - state.size * 0.4,
    state.y + state.size * 0.29,
    state.size * 0.8,
    state.size * 0.16,
    state.size * 0.08,
  ).fill({ color: 0x000000, alpha: alpha * 0.28 });

  drawGroundCue(graphics, state, bodyY, alpha);

  graphics.roundRect(
    state.x - state.size * 0.19 + stride,
    bodyY + state.size * 0.13,
    state.size * 0.12,
    state.size * 0.24,
    state.size * 0.05,
  ).fill({ color: state.accentColor, alpha: alpha * 0.9 });
  graphics.roundRect(
    state.x + state.size * 0.07 - stride,
    bodyY + state.size * 0.13,
    state.size * 0.12,
    state.size * 0.24,
    state.size * 0.05,
  ).fill({ color: state.accentColor, alpha: alpha * 0.9 });

  const backpackOffset = state.facing === 'right' ? -1 : state.facing === 'left' ? 1 : state.id === 0 ? -1 : 1;
  graphics.roundRect(
    state.x + backpackOffset * state.size * 0.25,
    bodyY - state.size * 0.03,
    state.size * 0.2,
    state.size * 0.36,
    state.size * 0.07,
  ).fill({ color: state.accentColor, alpha: alpha * 0.95 });

  graphics.roundRect(
    state.x - state.size * 0.25,
    bodyY - state.size * 0.02,
    state.size * 0.5,
    state.size * 0.4,
    state.size * 0.12,
  )
    .fill({ color: state.color, alpha })
    .stroke({ color: state.outlineColor, alpha: alpha * 0.9, width: Math.max(1.5, state.size * 0.065) });

  const panelY = bodyY + state.size * 0.05;
  graphics.roundRect(
    state.x - state.size * 0.13,
    panelY,
    state.size * 0.26,
    state.size * 0.14,
    state.size * 0.04,
  ).fill({ color: state.accentColor, alpha: alpha * 0.9 });

  const headX = state.x + directionX * state.size * 0.015;
  const headY = bodyY - state.size * 0.25 + directionY * state.size * 0.015;
  graphics.circle(headX, headY, state.size * 0.22)
    .fill({ color: state.id === 0 ? 0xfff3d0 : 0xe9dcff, alpha })
    .stroke({ color: state.outlineColor, alpha: alpha * 0.9, width: Math.max(1.5, state.size * 0.06) });

  const visorX = headX + directionX * state.size * 0.12;
  const visorY = headY + directionY * state.size * 0.12;
  graphics.roundRect(
    visorX - (directionY === 0 ? state.size * 0.045 : state.size * 0.13),
    visorY - (directionY === 0 ? state.size * 0.13 : state.size * 0.045),
    directionY === 0 ? state.size * 0.09 : state.size * 0.26,
    directionY === 0 ? state.size * 0.26 : state.size * 0.09,
    state.size * 0.03,
  ).fill({ color: state.id === 0 ? 0x5c4a72 : 0x3c3155, alpha: alpha * 0.95 });

  const eyeAxisX = directionY === 0 ? 0 : state.size * 0.075;
  const eyeAxisY = directionY === 0 ? state.size * 0.075 : 0;
  for (const sign of [-1, 1] as const) {
    graphics.circle(
      headX + (directionY === 0 ? directionX * state.size * 0.15 : sign * eyeAxisX),
      headY + (directionY === 0 ? sign * eyeAxisY : directionY * state.size * 0.15),
      state.size * 0.025,
    ).fill({ color: 0xffffff, alpha });
  }
  graphics.circle(
    headX + directionX * state.size * 0.18,
    headY + directionY * state.size * 0.18,
    state.size * 0.026,
  ).fill({ color: state.id === 0 ? 0x3f2f57 : 0x512f67, alpha });

  drawToolCue(graphics, state, headX, headY, alpha);
}
