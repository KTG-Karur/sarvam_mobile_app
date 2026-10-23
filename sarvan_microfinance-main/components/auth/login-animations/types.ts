/**
 * Generic Declarative Login Animation Specification
 *
 * Defines strict TypeScript types for brand-agnostic, data-driven
 * login animations. Animations are represented purely as JSON data,
 * never as executable JavaScript, React, or TypeScript code.
 */

export type AnimationEasingPreset =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'circIn'
  | 'circOut'
  | 'circInOut'
  | 'backIn'
  | 'backOut'
  | 'backInOut'
  | 'anticipate';

export type CubicBezierTuple = [number, number, number, number];

export type AnimationEasing = AnimationEasingPreset | CubicBezierTuple;

export interface AnimationTransform {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  opacity?: number;
  pathLength?: number;
  fillOpacity?: number;
  strokeOpacity?: number;
}

export type AnimationLayerType =
  | 'svg-path'
  | 'svg-circle'
  | 'svg-rect'
  | 'svg-group'
  | 'text'
  | 'image';

export interface AnimationLayer {
  id: string;
  type: AnimationLayerType;

  // Path data (for 'svg-path')
  d?: string;

  // Circle properties (for 'svg-circle')
  cx?: number;
  cy?: number;
  r?: number;

  // Rect/Image properties (for 'svg-rect', 'image')
  width?: number;
  height?: number;
  rx?: number;
  ry?: number;
  href?: string;

  // Text properties (for 'text')
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  textAnchor?: 'start' | 'middle' | 'end';

  // Styling properties
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'round' | 'bevel';

  // Base spatial coordinates
  x?: number;
  y?: number;
  scale?: number;
  rotation?: number;
  opacity?: number;

  // Declarative animation keyframes
  from?: AnimationTransform;
  to?: AnimationTransform;

  // Animation timing
  delayMs?: number;
  durationMs?: number;
  easing?: AnimationEasing;
}

export interface AnimationCanvas {
  width: number;
  height: number;
  background?: string;
}

export interface AnimationManifest {
  /** Schema specification version (e.g. "1.0") */
  schemaVersion: string | number;

  /** Unique identifier for this animation manifest */
  id: string;

  /** Human-readable display name */
  name: string;

  /** Semantic version of the animation asset */
  version: string;

  /** Total animation runtime duration in milliseconds */
  durationMs: number;

  /** Fallback duration in milliseconds when user prefers reduced motion */
  reducedMotionDurationMs: number;

  /** Canvas coordinate space and presentation properties */
  canvas: AnimationCanvas;

  /** Ordered list of animation layers */
  layers: AnimationLayer[];

  /** Optional descriptive metadata */
  description?: string;
  author?: string;
}

export interface DeclarativeAnimationRunnerProps {
  /** The validated animation manifest or raw JSON object */
  manifest: AnimationManifest | unknown;

  /** Callback invoked once animation sequence completes */
  onComplete: () => void;

  /** Optional className to append to root wrapper */
  className?: string;
}
