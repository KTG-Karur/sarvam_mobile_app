import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { prisma } from "@/app/lib/prisma";
import { companyNameSmall as DEFAULT_COMPANY_NAME_SHORT } from "@/hooks/use-toast";
import { buildPrimaryScale, buildSecondaryScale, buildNeutralScale, contrastColor, type ColorScale } from "@/app/lib/color-scale";
import { BrandProvider } from "@/app/lib/brand-context";

// Force per-request rendering for the ENTIRE app (segment config in the root
// layout is inherited by every route). Without this, Next statically prerenders
// most dashboard routes at build time, which freezes the active ThemePreset's
// colors / company name / favicon — read here by getActiveTheme() — into the
// static HTML shell. In production that shell is served on every refresh and
// after logout/login, so an admin who switches themes only sees the change on
// the one route that is already dynamic (/dashboard/settings/brand). The app is
// fully authenticated (nothing is CDN-cacheable) and runs as a persistent
// `next start` process, so a per-request indexed findFirst is negligible.
export const dynamic = 'force-dynamic';

// Poppins — geometric sans-serif, self-hosted (see app/fonts/) so the build
// never depends on fetching fonts.googleapis.com at build time. Loading
// 400/500/600/700 so font-medium/semibold/bold utilities all render with real
// glyphs instead of browser-synthesized ones. Also exposed as the
// --font-app-sans CSS variable so the `font-sans` Tailwind utility (used by
// print/receipt components) resolves to it too.
const appFont = localFont({
  src: [
    { path: "./fonts/Poppins-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Poppins-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Poppins-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Poppins-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-app-sans",
  display: "swap",
  fallback: ["system-ui", "arial"],
});

type BrandRow = {
  primaryColor: string;
  primaryDark: string;
  primaryDarker: string;
  primaryLight: string;
  primaryTint: string;
  secondaryColor: string;
  sidebarBg: string;
  sidebarText: string;
  sidebarFontSize: number;
  sidebarBrandFontSize: number;
  sidebarFullNameFontSize: number;
  navBg: string;
  pageBg: string;
  foregroundColor: string;
  fontSizeBase: number;
  companyNameShort: string;
  companyNameFull: string;
};

// Deliberately NOT wrapped in unstable_cache: this Next.js version's revalidateTag
// (now tied to its cache-profile system, see the /activate route) does not reliably
// invalidate unstable_cache-backed values, which made a just-applied theme keep
// showing stale colors until some later, unrelated request happened to refetch.
// A single indexed findFirst() is cheap enough to just always read live.
async function getActiveTheme() {
  return prisma.themePreset.findFirst({ where: { isActive: true } });
}

export async function generateMetadata(): Promise<Metadata> {
  let shortName = DEFAULT_COMPANY_NAME_SHORT;
  let logoVersion = 0;
  let hasFavicon = false;
  try {
    const brand = await getActiveTheme();
    if (brand?.companyNameFull) shortName = brand.companyNameFull;
    if (brand?.updatedAt) logoVersion = new Date(brand.updatedAt).getTime();
    hasFavicon = Boolean(brand?.faviconKey);
  } catch (err) {
    // DB unreachable — fall back to the default name, but log it: a silent
    // failure here is indistinguishable from "no theme configured".
    console.error('[layout] generateMetadata: failed to read active theme', err);
  }

  const logoUrl = logoVersion
    ? `/api/branding/asset/logo-wordmark?v=${logoVersion}`
    : '/api/branding/asset/logo-wordmark';

  // Brand favicon served through the API; falls back to the static app/favicon.ico
  // convention when no brand favicon is configured.
  const brandFavicon = hasFavicon
    ? (logoVersion
        ? `/api/branding/asset/favicon?v=${logoVersion}`
        : '/api/branding/asset/favicon')
    : null;

  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://your-domain.com'),
    title: shortName + " System",
    description: "MFI Management System",
    ...(brandFavicon ? { icons: { icon: brandFavicon } } : {}),
    openGraph: {
      title: shortName + " System",
      description: "MFI Management System",
      images: [
        {
          url: logoUrl,
          width: 1200,
          height: 630,
          alt: shortName,
        },
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: shortName + " System",
      description: "MFI Management System",
      images: [logoUrl],
    },
  };
}

const SCALE_STEPS: (keyof ColorScale)[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function scaleVars(prefix: string, scale: ColorScale): string {
  return SCALE_STEPS.map((step) => `  --scale-${prefix}-${step}: ${scale[step]};`).join('\n');
}

function buildThemeVars(c: BrandRow): string {
  const primaryScale = buildPrimaryScale({
    color: c.primaryColor,
    dark: c.primaryDark,
    darker: c.primaryDarker,
    light: c.primaryLight,
    tint: c.primaryTint,
  });
  const accentScale = buildSecondaryScale(c.secondaryColor);
  const neutralScale = buildNeutralScale(c.primaryColor);

  const primaryForeground = contrastColor(c.primaryColor);
  const secondaryForeground = contrastColor(c.secondaryColor);
  const sidebarAccentForeground = contrastColor(c.primaryDark);

  return `
:root {
  --primary: ${c.primaryColor};
  --primary-foreground: ${primaryForeground};
  --ring: ${c.primaryColor};
  --secondary: ${c.secondaryColor};
  --secondary-foreground: ${secondaryForeground};
  --sidebar: ${c.sidebarBg};
  --sidebar-foreground: ${c.sidebarText};
  --sidebar-primary: ${c.secondaryColor};
  --sidebar-primary-foreground: ${secondaryForeground};
  --sidebar-accent: ${c.primaryDark};
  --sidebar-accent-foreground: ${sidebarAccentForeground};
  --sidebar-border: ${c.primaryDark};
  --sidebar-ring: ${c.primaryColor};
  --background: ${c.pageBg};
  --card: ${c.navBg};
  --card-foreground: ${c.foregroundColor};
  --popover: ${c.navBg};
  --popover-foreground: ${c.foregroundColor};
  --foreground: ${c.foregroundColor};
  --muted: ${primaryScale[100]};
  --muted-foreground: ${primaryScale[600]};
  --accent: ${c.secondaryColor};
  --accent-foreground: ${secondaryForeground};
  --border: ${primaryScale[200]};
  --input: ${primaryScale[200]};
${scaleVars('primary', primaryScale)}
${scaleVars('accent', accentScale)}
${scaleVars('neutral', neutralScale)}
}
html { font-size: ${c.fontSizeBase}px; }
:root { --sidebar-brand-font-size: ${c.sidebarBrandFontSize}px; --sidebar-fullname-font-size: ${c.sidebarFullNameFontSize}px; }
[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"] { font-size: ${c.sidebarFontSize}px; }`.trim();
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let brand = null;
  try {
    brand = await getActiveTheme();
  } catch (err) {
    // DB unreachable — render with the built-in default theme this once, and
    // log it so an intermittent DB failure is visible rather than silently
    // stripping every user's theme.
    console.error('[layout] RootLayout: failed to read active theme', err);
  }
  const themeVars = brand ? buildThemeVars(brand) : null;
  const logoVersion = brand ? new Date(brand.updatedAt).getTime() : 0;

  return (
    <html lang="en">
      <body className={`${appFont.className} ${appFont.variable}`} suppressHydrationWarning>
        {/*
          Rendered as a body-level child (not inside a hand-written <head>): React 19
          hoists it into <head> and dedupes by the `href` key rather than by DOM
          position, so a <style>/<link> injected into <head> by a browser extension
          can't cause a hydration mismatch against it. The favicon <link> moved to
          generateMetadata()'s `icons` for the same reason.
        */}
        {themeVars && (
          <style
            href="brand-theme"
            precedence="high"
            dangerouslySetInnerHTML={{ __html: themeVars }}
          />
        )}
        <BrandProvider
          companyNameShort={brand?.companyNameShort || DEFAULT_COMPANY_NAME_SHORT}
          companyNameFull={brand?.companyNameFull || "Sarvam Charitable Trust"}
          logoVersion={logoVersion}
          primaryColor={brand?.primaryColor || "#037f35"}
          primaryDark={brand?.primaryDark || "#025c27"}
          primaryTint={brand?.primaryTint || "#e6f5ec"}
        >
          {children}
        </BrandProvider>
        <Toaster />
      </body>
    </html>
  );
}
