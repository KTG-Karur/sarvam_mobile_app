import React from 'react';
import { SarvamLoginTransition } from '@/components/SarvamLoginTransition';

export interface LoginAnimationProps {
  onComplete: () => void;
}

export type LoginAnimationComponent = React.ComponentType<LoginAnimationProps>;

/**
 * Registry mapping built-in loginAnimationKey strings to their respective
 * static animation transition components.
 *
 * Custom animations are not registered here; they are stored as declarative JSON
 * and rendered via DeclarativeAnimationRunner.
 */
export const loginAnimationRegistry: Record<string, LoginAnimationComponent> = {
  sarvam: SarvamLoginTransition,
};

/**
 * Safely retrieves a built-in registered login animation component by key.
 * Returns null if key is null/undefined or corresponds to a custom declarative animation.
 */
export function getLoginAnimation(
  key: string | null | undefined
): LoginAnimationComponent | null {
  if (!key) return null;
  return loginAnimationRegistry[key] ?? null;
}
