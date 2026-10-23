'use client';

import { createContext, useContext, useEffect } from 'react';

export interface BrandNames {
  companyNameShort: string;
  companyNameFull: string;
  /** BrandConfig.updatedAt as epoch ms — append as `?v=` to logo/icon URLs so a
   *  freshly-uploaded logo isn't served from the 5-minute unversioned cache
   *  (see app/api/branding/asset/[...type]/route.ts). */
  logoVersion: number;
  /** Active ThemePreset's color anchors (hex, `#rrggbb`) — consumed by report
   *  export builders (jsPDF headers, docx-core.ts) that draw brand color
   *  outside the CSS/Tailwind pipeline and so can't reach it via `--primary`. */
  primaryColor: string;
  primaryDark: string;
  primaryTint: string;
}

const DEFAULT_BRAND_NAMES: BrandNames = {
  companyNameShort: 'KTGT',
  companyNameFull: 'Knock The Globe Technologies',
  logoVersion: 0,
  primaryColor: '#037f35',
  primaryDark: '#025c27',
  primaryTint: '#e6f5ec',
};

const BrandNamesContext = createContext<BrandNames | null>(null);

declare global {
  interface Window {
    __brandNames?: BrandNames;
  }
}

export function BrandProvider({
  companyNameShort,
  companyNameFull,
  logoVersion,
  primaryColor,
  primaryDark,
  primaryTint,
  children,
}: BrandNames & { children: React.ReactNode }) {
  useEffect(() => {
    window.__brandNames = { companyNameShort, companyNameFull, logoVersion, primaryColor, primaryDark, primaryTint };
  }, [companyNameShort, companyNameFull, logoVersion, primaryColor, primaryDark, primaryTint]);

  return (
    <BrandNamesContext.Provider value={{ companyNameShort, companyNameFull, logoVersion, primaryColor, primaryDark, primaryTint }}>
      {children}
    </BrandNamesContext.Provider>
  );
}

/** Falls back to the Sarvam defaults if rendered outside RootLayout's provider (shouldn't happen). */
export function useBrandNames(): BrandNames {
  const ctx = useContext(BrandNamesContext);
  return ctx ?? DEFAULT_BRAND_NAMES;
}

/**
 * Synchronous, non-hook access to the active theme's brand names — for plain
 * browser-only utility modules (PDF/Excel/HTML export builders) that run outside
 * React and can't call `useBrandNames()`. Populated by `BrandProvider` on mount,
 * so falls back to the defaults only if called before first paint or on the server.
 */
export function getBrandNamesGlobal(): BrandNames {
  if (typeof window !== 'undefined' && window.__brandNames) return window.__brandNames;
  return DEFAULT_BRAND_NAMES;
}
