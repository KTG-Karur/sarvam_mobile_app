import React from 'react';
import Image from 'next/image';

export interface SarvamFullBrandLockupProps {
  className?: string;
  priority?: boolean;
}

/**
 * SarvamFullBrandLockup
 * Renders the official horizontal brand lockup (2134x738):
 * - Left: Six-person Sarvam emblem with center growth arrow
 * - Right: "SARVAM" wordmark + dual-color rule + "CHARITABLE TRUST"
 * Uses the official master brand asset public/Sarvam_01.png.
 */
export function SarvamFullBrandLockup({
  className = 'w-full max-w-[520px] aspect-[2134/738]',
  priority = true,
}: SarvamFullBrandLockupProps) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <Image
        src="/Sarvam_01.png"
        alt="Sarvam Charitable Trust"
        width={2134}
        height={738}
        priority={priority}
        className="w-full h-auto object-contain"
      />
    </div>
  );
}
