/** Parses a hex color (`#rgb` or `#rrggbb`, with or without the `#`) into an [r,g,b] triple. */
export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Linearly mix two hex colors. t=0 -> a, t=1 -> b. */
export function mixHex(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** Picks readable near-black or white text for a given background color. */
export function contrastColor(bg: string): string {
  const [r, g, b] = hexToRgb(bg);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#0a0a0a' : '#ffffff';
}

export interface ColorScale {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
}

/**
 * Derives a full 11-step Tailwind-style scale from BrandConfig's five primary
 * anchor colors, so every Tailwind color family aliased to this scale in
 * globals.css (green/emerald/teal/cyan/sky/lime/purple/violet/fuchsia) stays
 * visually consistent with the admin's saved theme without needing a
 * dedicated BrandConfig field per shade. At BrandConfig's defaults this
 * reproduces the scale that used to be hardcoded in globals.css almost
 * exactly (interpolated shades land within ~1-2 RGB units).
 */
export function buildPrimaryScale(anchors: {
  color: string; dark: string; darker: string; light: string; tint: string;
}): ColorScale {
  const { color, dark, darker, light, tint } = anchors;
  return {
    50: mixHex(tint, '#ffffff', 0.5),
    100: tint,
    200: mixHex(light, tint, 0.66),
    300: mixHex(light, tint, 0.33),
    400: light,
    500: color,
    600: mixHex(dark, color, 0.5),
    700: dark,
    800: mixHex(darker, dark, 0.5),
    900: darker,
    950: mixHex(darker, '#000000', 0.35),
  };
}

/**
 * Same idea for the accent/secondary color, which only has a single
 * BrandConfig anchor — lighter/darker steps are derived by mixing toward
 * white/black.
 */
export function buildSecondaryScale(secondary: string): ColorScale {
  return {
    50: mixHex(secondary, '#ffffff', 0.90),
    100: mixHex(secondary, '#ffffff', 0.75),
    200: mixHex(secondary, '#ffffff', 0.55),
    300: mixHex(secondary, '#ffffff', 0.30),
    400: mixHex(secondary, '#ffffff', 0.15),
    500: secondary,
    600: mixHex(secondary, '#000000', 0.15),
    700: mixHex(secondary, '#000000', 0.30),
    800: mixHex(secondary, '#000000', 0.45),
    900: mixHex(secondary, '#000000', 0.60),
    950: mixHex(secondary, '#000000', 0.75),
  };
}

/** Standard neutral gray scale (Tailwind slate defaults) used as the base for buildNeutralScale. */
const BASE_GRAY: ColorScale = {
  50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8',
  500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617',
};

/**
 * Derives a "brand-tinted neutral" scale (used for muted/secondary text and
 * borders throughout the app, e.g. `text-slate-500`) by lightly mixing a
 * standard neutral gray scale with the primary brand color, so neutrals stay
 * reactive to BrandConfig instead of freezing at a hardcoded green tint.
 */
export function buildNeutralScale(primaryColor: string): ColorScale {
  const tint = 0.22;
  const steps: (keyof ColorScale)[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const result = {} as ColorScale;
  for (const step of steps) {
    result[step] = mixHex(BASE_GRAY[step], primaryColor, tint);
  }
  return result;
}
