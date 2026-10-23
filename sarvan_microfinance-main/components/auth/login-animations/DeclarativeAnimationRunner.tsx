'use client';

import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Transition } from 'framer-motion';
import type {
  AnimationManifest,
  AnimationLayer,
  DeclarativeAnimationRunnerProps,
} from './types';
import { validateAnimationManifest } from './validateManifest';

/**
 * Brand-agnostic declarative animation runner.
 *
 * Interprets pure JSON manifest data and renders vector-based animations
 * using Framer Motion primitives.
 *
 * Security & Safety guarantees:
 * - Validates input against a strict schema.
 * - Never evaluates JavaScript or dynamic code (no eval, no Function, no innerHTML).
 * - Never injects raw style strings or unsanitized DOM elements.
 * - Respects prefers-reduced-motion.
 * - Guarantees onComplete is called exactly once.
 * - Provides graceful fallback UI if manifest is malformed or invalid.
 */
export function DeclarativeAnimationRunner({
  manifest,
  onComplete,
  className = '',
}: DeclarativeAnimationRunnerProps) {
  const completedRef = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  // Validate the manifest at runtime
  const validation = useMemo(() => {
    return validateAnimationManifest(manifest);
  }, [manifest]);

  const validManifest: AnimationManifest | null = validation.success && validation.data
    ? validation.data
    : null;

  // Single-dispatch completion callback
  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  // Determine overall duration in ms
  const effectiveDurationMs = useMemo(() => {
    if (!validManifest) return 600; // Fast fallback delay
    if (prefersReducedMotion) {
      return Math.max(100, Math.min(validManifest.reducedMotionDurationMs, 2000));
    }
    return Math.max(200, validManifest.durationMs);
  }, [validManifest, prefersReducedMotion]);

  // Master timer to guarantee onComplete is called
  useEffect(() => {
    const timer = setTimeout(() => {
      handleComplete();
    }, effectiveDurationMs);

    return () => clearTimeout(timer);
  }, [effectiveDurationMs, handleComplete]);

  // Fallback view for invalid or missing manifests
  if (!validManifest) {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm ${className}`}
        role="status"
        aria-live="polite"
        aria-label="Signing in..."
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="flex flex-col items-center gap-3 p-6 text-center"
        >
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm font-medium text-muted-foreground">Signing in...</p>
        </motion.div>
      </div>
    );
  }

  const { canvas, layers } = validManifest;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden ${className}`}
      style={{
        backgroundColor: canvas.background || '#090d16',
      }}
      role="region"
      aria-label={validManifest.name || 'Login animation'}
    >
      {/* ── Bounded lockup container: consistent size regardless of the manifest's native canvas dimensions ── */}
      <div
        className="relative w-[85vw] max-w-[440px]"
        style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
      >
        <svg
          viewBox={`0 0 ${canvas.width} ${canvas.height}`}
          className="h-full w-full object-contain"
          preserveAspectRatio="xMidYMid meet"
          xmlns="http://www.w3.org/2000/svg"
        >
          {layers.map((layer) => (
            <DeclarativeLayer
              key={layer.id}
              layer={layer}
              masterDurationMs={validManifest.durationMs}
              prefersReducedMotion={Boolean(prefersReducedMotion)}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

interface DeclarativeLayerProps {
  layer: AnimationLayer;
  masterDurationMs: number;
  prefersReducedMotion: boolean;
}

function DeclarativeLayer({
  layer,
  masterDurationMs,
  prefersReducedMotion,
}: DeclarativeLayerProps) {
  // Compute animation states safely from declarative properties
  const initial = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        opacity: layer.from?.opacity ?? layer.opacity ?? 0,
      };
    }
    return {
      x: layer.from?.x ?? layer.x ?? 0,
      y: layer.from?.y ?? layer.y ?? 0,
      scale: layer.from?.scale ?? layer.scale ?? 1,
      scaleX: layer.from?.scaleX,
      scaleY: layer.from?.scaleY,
      rotate: layer.from?.rotation ?? layer.rotation ?? 0,
      opacity: layer.from?.opacity ?? layer.opacity ?? 1,
      pathLength: layer.from?.pathLength,
      fillOpacity: layer.from?.fillOpacity,
      strokeOpacity: layer.from?.strokeOpacity,
    };
  }, [layer, prefersReducedMotion]);

  const animate = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        opacity: layer.to?.opacity ?? layer.opacity ?? 1,
      };
    }
    return {
      x: layer.to?.x ?? layer.x ?? 0,
      y: layer.to?.y ?? layer.y ?? 0,
      scale: layer.to?.scale ?? layer.scale ?? 1,
      scaleX: layer.to?.scaleX,
      scaleY: layer.to?.scaleY,
      rotate: layer.to?.rotation ?? layer.rotation ?? 0,
      opacity: layer.to?.opacity ?? layer.opacity ?? 1,
      pathLength: layer.to?.pathLength,
      fillOpacity: layer.to?.fillOpacity,
      strokeOpacity: layer.to?.strokeOpacity,
    };
  }, [layer, prefersReducedMotion]);

  const transition: Transition = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        duration: 0.3,
        ease: 'easeOut',
      };
    }

    const durationSec = (layer.durationMs ?? masterDurationMs) / 1000;
    const delaySec = (layer.delayMs ?? 0) / 1000;

    return {
      duration: Math.max(0.05, durationSec),
      delay: Math.max(0, delaySec),
      ease: (layer.easing ?? 'easeInOut') as Transition['ease'],
    };
  }, [layer, masterDurationMs, prefersReducedMotion]);

  const commonSvgProps = {
    fill: layer.fill,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    strokeLinecap: layer.strokeLinecap,
    strokeLinejoin: layer.strokeLinejoin,
    initial,
    animate,
    transition,
  };

  switch (layer.type) {
    case 'svg-path':
      if (!layer.d) return null;
      return <motion.path d={layer.d} {...commonSvgProps} />;

    case 'svg-circle':
      return (
        <motion.circle
          cx={layer.cx ?? 0}
          cy={layer.cy ?? 0}
          r={layer.r ?? 0}
          {...commonSvgProps}
        />
      );

    case 'svg-rect':
      return (
        <motion.rect
          x={layer.x ?? 0}
          y={layer.y ?? 0}
          width={layer.width ?? 0}
          height={layer.height ?? 0}
          rx={layer.rx}
          ry={layer.ry}
          {...commonSvgProps}
        />
      );

    case 'text':
      return (
        <motion.text
          x={layer.x ?? 0}
          y={layer.y ?? 0}
          fontSize={layer.fontSize}
          fontFamily={layer.fontFamily}
          fontWeight={layer.fontWeight}
          textAnchor={layer.textAnchor}
          {...commonSvgProps}
        >
          {layer.text}
        </motion.text>
      );

    case 'image':
      if (!layer.href) return null;
      return (
        <motion.image
          href={layer.href}
          x={layer.x ?? 0}
          y={layer.y ?? 0}
          width={layer.width ?? 0}
          height={layer.height ?? 0}
          preserveAspectRatio="xMidYMid meet"
          initial={initial}
          animate={animate}
          transition={transition}
        />
      );

    case 'svg-group':
      return <motion.g {...commonSvgProps} />;

    default:
      return null;
  }
}
