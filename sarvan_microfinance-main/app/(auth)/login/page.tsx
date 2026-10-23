import fs from "fs";
import path from "path";
import { prisma } from "@/app/lib/prisma";
import { LoginForm } from "@/app/components/auth/LoginForm";
import { LoginCarousel, type Slide } from "@/app/components/auth/LoginCarousel";
import { DEFAULT_LOGIN_SLIDES } from "@/app/lib/constants/login-slides";

/* ─── Cache-busting versions for the default local slide images ────────────── */
function getSlideVersions(): Record<string, string> {
  const dir = path.join(process.cwd(), "public", "login-slides");
  const versions: Record<string, string> = {};
  try {
    for (const file of fs.readdirSync(dir)) {
      const stat = fs.statSync(path.join(dir, file));
      versions[`/login-slides/${file}`] = String(stat.mtimeMs);
    }
  } catch {
    // directory missing — fall back to unversioned src
  }
  return versions;
}

/* ─── Page ──────────────────────────────────────────────────────────────── */
// Slides are admin-managed via /dashboard/settings/brand — this must read the
// DB on every request, not get baked in as a static page at build time.
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const activeTheme = await prisma.themePreset.findFirst({
    where: { isActive: true },
    select: {
      id: true,
      loginAnimationKey: true,
      loginSlides: { orderBy: { sortOrder: "asc" } },
    },
  });
  const dbSlides = activeTheme?.loginSlides ?? [];

  const slides: Slide[] = dbSlides.length > 0
    ? dbSlides.map((slide) => ({
        src: `/api/branding/asset/login-slide/${slide.id}?v=${slide.updatedAt.getTime()}`,
        title: slide.title,
        description: slide.description,
      }))
    : (() => {
        const slideVersions = getSlideVersions();
        return DEFAULT_LOGIN_SLIDES.map((s) => ({
          ...s,
          src: slideVersions[s.src] ? `${s.src}?v=${slideVersions[s.src]}` : s.src,
        }));
      })();

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 sm:p-8"
      style={{
        background:
          "radial-gradient(ellipse at 68% 44%, var(--scale-accent-300) 0%, var(--secondary) 50%, var(--scale-accent-700) 100%)",
      }}
    >
      {/* ── Card ──────────────────────────────────────────────────── */}
      <div
        className="w-full max-w-5xl flex overflow-hidden"
        style={{
          borderRadius: 32,
          boxShadow: "0 32px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10)",
          minHeight: 620,
        }}
      >
        {/* ── LEFT — white form panel (42%) ─────────────────────── */}
        <div className="w-full md:w-[42%] shrink-0 flex flex-col bg-white">
          <LoginForm
            loginAnimationKey={activeTheme?.loginAnimationKey ?? null}
            themePresetId={activeTheme?.id ?? null}
          />
        </div>

        {/* ── RIGHT — image carousel panel (58%) ────────────────── */}
        <div className="hidden md:flex flex-1 relative overflow-hidden">
          <LoginCarousel slides={slides} />
        </div>
      </div>
    </div>
  );
}
