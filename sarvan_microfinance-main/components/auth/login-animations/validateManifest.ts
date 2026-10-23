import { z } from 'zod';
import type {
  AnimationManifest,
  AnimationLayer,
  AnimationCanvas,
  AnimationTransform,
  AnimationEasing,
} from './types';

/**
 * Regex detecting dangerous script indicators, tags, or execution vectors
 * in string properties.
 */
const DANGEROUS_SCRIPT_REGEX =
  /<script\b|javascript:|vbscript:|data:text\/(html|javascript)|onload\s*=|onerror\s*=|onclick\s*=|eval\s*\(|expression\s*\(/i;

function safeString(min = 0, max = 100000) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine((val) => !DANGEROUS_SCRIPT_REGEX.test(val), {
      message: 'Value contains potentially dangerous or executable script patterns',
    });
}

const safeIdentifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'ID must consist of alphanumeric characters, hyphens, or underscores only',
  });

const safeColor = z
  .string()
  .max(128)
  .refine((val) => !DANGEROUS_SCRIPT_REGEX.test(val) && !val.includes('url('), {
    message: 'Color must not contain executable patterns or url() expressions',
  });

const safeImageHref = z
  .string()
  .max(500000)
  .refine(
    (val) => {
      if (DANGEROUS_SCRIPT_REGEX.test(val)) return false;
      // Allow safe relative paths
      if (val.startsWith('/') && !val.startsWith('//')) return true;
      // Allow safe base64 images
      if (/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(val)) {
        return true;
      }
      return false;
    },
    {
      message: 'Image href must be a root-relative path (/...) or a valid base64 image data URI',
    }
  );

const easingPresetEnum = z.enum([
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'circIn',
  'circOut',
  'circInOut',
  'backIn',
  'backOut',
  'backInOut',
  'anticipate',
]);

const cubicBezierTupleSchema = z.tuple([
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
  z.number().finite().min(-10).max(10),
]);

const easingSchema: z.ZodType<AnimationEasing> = z.union([
  easingPresetEnum,
  cubicBezierTupleSchema,
]);

const transformSchema: z.ZodType<AnimationTransform> = z
  .object({
    x: z.number().finite().min(-10000).max(10000).optional(),
    y: z.number().finite().min(-10000).max(10000).optional(),
    scale: z.number().finite().min(0).max(100).optional(),
    scaleX: z.number().finite().min(0).max(100).optional(),
    scaleY: z.number().finite().min(0).max(100).optional(),
    rotation: z.number().finite().min(-3600).max(3600).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),
    pathLength: z.number().finite().min(0).max(1).optional(),
    fillOpacity: z.number().finite().min(0).max(1).optional(),
    strokeOpacity: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

const layerSchema: z.ZodType<AnimationLayer> = z
  .object({
    id: safeIdentifier,
    type: z.enum(['svg-path', 'svg-circle', 'svg-rect', 'svg-group', 'text', 'image']),

    // Path
    d: safeString(0, 100000).optional(),

    // Circle
    cx: z.number().finite().min(-10000).max(10000).optional(),
    cy: z.number().finite().min(-10000).max(10000).optional(),
    r: z.number().finite().min(0).max(10000).optional(),

    // Rect / Image
    width: z.number().finite().min(0).max(10000).optional(),
    height: z.number().finite().min(0).max(10000).optional(),
    rx: z.number().finite().min(0).max(10000).optional(),
    ry: z.number().finite().min(0).max(10000).optional(),
    href: safeImageHref.optional(),

    // Text
    text: safeString(0, 500).optional(),
    fontSize: z.number().finite().min(1).max(1000).optional(),
    fontFamily: safeString(0, 128).optional(),
    fontWeight: z.union([z.string().max(32), z.number().int().min(100).max(900)]).optional(),
    textAnchor: z.enum(['start', 'middle', 'end']).optional(),

    // Style
    fill: safeColor.optional(),
    stroke: safeColor.optional(),
    strokeWidth: z.number().finite().min(0).max(200).optional(),
    strokeLinecap: z.enum(['butt', 'round', 'square']).optional(),
    strokeLinejoin: z.enum(['miter', 'round', 'bevel']).optional(),

    // Base spatial
    x: z.number().finite().min(-10000).max(10000).optional(),
    y: z.number().finite().min(-10000).max(10000).optional(),
    scale: z.number().finite().min(0).max(100).optional(),
    rotation: z.number().finite().min(-3600).max(3600).optional(),
    opacity: z.number().finite().min(0).max(1).optional(),

    // Keyframes
    from: transformSchema.optional(),
    to: transformSchema.optional(),

    // Timing
    delayMs: z.number().finite().min(0).max(60000).optional(),
    durationMs: z.number().finite().min(0).max(60000).optional(),
    easing: easingSchema.optional(),
  })
  .strict();

const canvasSchema: z.ZodType<AnimationCanvas> = z
  .object({
    width: z.number().finite().min(1).max(4096),
    height: z.number().finite().min(1).max(4096),
    background: safeColor.optional(),
  })
  .strict();

export const animationManifestSchema: z.ZodType<AnimationManifest> = z
  .object({
    schemaVersion: z.union([z.string().min(1).max(16), z.number().finite()]),
    id: safeIdentifier,
    name: safeString(1, 128),
    version: safeString(1, 32),
    durationMs: z.number().finite().min(100).max(60000),
    reducedMotionDurationMs: z.number().finite().min(0).max(60000),
    canvas: canvasSchema,
    layers: z.array(layerSchema).min(1).max(500),
    description: safeString(0, 500).optional(),
    author: safeString(0, 128).optional(),
  })
  .strict();

export interface ManifestValidationResult {
  success: boolean;
  data?: AnimationManifest;
  error?: string;
  issues?: string[];
}

/**
 * Validates untrusted animation JSON data against the strict declarative specification.
 *
 * Rejects:
 * - Missing required fields
 * - Non-numeric or out-of-bound durations and dimensions
 * - Unsupported layer types
 * - Executable/script injection patterns
 * - Any unrecognized or unapproved properties (.strict())
 */
export function validateAnimationManifest(input: unknown): ManifestValidationResult {
  if (!input || typeof input !== 'object') {
    return {
      success: false,
      error: 'Animation manifest must be a non-null object',
      issues: ['Expected object, received null or primitive'],
    };
  }

  const result = animationManifestSchema.safeParse(input);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  const issues = result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`
  );

  return {
    success: false,
    error: `Manifest validation failed with ${issues.length} error(s)`,
    issues,
  };
}

/**
 * Type guard to check whether an unknown object is a valid AnimationManifest.
 */
export function isAnimationManifest(input: unknown): input is AnimationManifest {
  return validateAnimationManifest(input).success;
}
