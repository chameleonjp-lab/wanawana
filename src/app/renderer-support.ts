export type RendererPreference = 'webgl' | 'canvas';

/**
 * Prefer WebGL when it is available, but keep the game playable with PixiJS's
 * 2D Canvas renderer when the browser cannot create a WebGL context.
 */
export function rendererPreferences(webglAvailable: boolean): RendererPreference[] {
  return webglAvailable ? ['webgl', 'canvas'] : ['canvas'];
}
