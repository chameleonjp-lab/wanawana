export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export function createViewportSize(width: number, height: number): ViewportSize {
  return {
    width: Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0,
    height: Number.isFinite(height) ? Math.max(0, Math.round(height)) : 0,
  };
}

export function viewportSizeChanged(previous: ViewportSize | null, current: ViewportSize): boolean {
  if (!previous) return false;
  return previous.width !== current.width || previous.height !== current.height;
}
