'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBrandNames } from '@/app/lib/brand-context';

/* ─── Slide data — sourced from LoginSlide rows (see /dashboard/settings/brand)
   or the built-in default set; both are assembled server-side by the login page. */
export interface Slide {
  src: string;
  title: string;
  description: string;
}

const INTERVAL_MS = 4000; // auto-advance every 4 s

/* ─── Component ─────────────────────────────────────────────────────────────── */
interface LoginCarouselProps {
  slides: Slide[];
}

export function LoginCarousel({ slides }: LoginCarouselProps) {
  const { companyNameFull } = useBrandNames();
  const [current, setCurrent] = useState(0);
  const [animating, setAnimating] = useState(false);

  const goTo = useCallback(
    (index: number) => {
      if (animating || index === current) return;
      setAnimating(true);
      setCurrent(index);
      setTimeout(() => setAnimating(false), 600);
    },
    [animating, current]
  );

  const next = useCallback(() => {
    goTo((current + 1) % slides.length);
  }, [current, goTo, slides.length]);

  /* Auto-advance */
  useEffect(() => {
    const id = setInterval(next, INTERVAL_MS);
    return () => clearInterval(id);
  }, [next]);

  if (slides.length === 0) return null;
  const slide = slides[current];

  return (
    <div className="relative w-full h-full min-h-[480px] flex flex-col overflow-hidden rounded-r-[32px]">
      {/* ── Image layer ───────────────────────────────────────────────────── */}
      {slides.map((s, i) => (
        <div
          key={s.src}
          className="absolute inset-0 transition-opacity duration-700"
          style={{ opacity: i === current ? 1 : 0, zIndex: i === current ? 1 : 0 }}
          aria-hidden={i !== current}
        >
          {/* Plain <img>, not next/image — these are already-sized static /public
              PNGs, and next/image's build-time local-pattern validation rejects
              the ?v= cache-busting query string during static prerendering. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={s.src}
            alt={s.title}
            className="absolute inset-0 h-full w-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : 'auto'}
          />
        </div>
      ))}

      {/* ── Gradient overlay — stays fully transparent over the top ~71% so the
          illustration reads clearly; darkens only behind the bottom title/
          description block, strongest in the final ~15% near the text. ──── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 71%, rgba(0,0,0,0.22) 84%, rgba(0,0,0,0.56) 93%, rgba(0,0,0,0.88) 100%)',
          zIndex: 2,
        }}
      />

      {/* ── Top brand tag ─────────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex items-center gap-2 px-8 pt-8 pb-2"
      >
        <span
          className="text-[11px] font-bold uppercase tracking-widest px-3 py-1 rounded-full"
          style={{
            background: 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0,0,0,0.55)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          }}
        >
          {companyNameFull}
        </span>
      </div>

      {/* ── Slide counter (top-right) ──────────────────────────────────────── */}
      <div className="absolute top-8 right-8 z-10">
        <span
          className="text-[12px] font-semibold tabular-nums"
          style={{ color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}
        >
          {String(current + 1).padStart(2, '0')}&nbsp;/&nbsp;{String(slides.length).padStart(2, '0')}
        </span>
      </div>

      {/* ── Bottom text + dots ────────────────────────────────────────────── */}
      <div className="relative z-10 mt-auto px-8 pb-8">
        {/* Text — nudged down via top padding so it sits fully inside the
            gradient's dark zone instead of the clear upper illustration;
            dots below stay anchored at the same bottom position. */}
        <div
          key={current}
          className="mb-5 pt-3"
          style={{
            animation: 'slideUp 0.55s cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          <h2 className="text-[22px] font-extrabold leading-snug text-white drop-shadow-sm">
            {slide.title}
          </h2>
          <p
            className="mt-2 text-[13px] leading-relaxed whitespace-pre-line"
            style={{ color: 'rgba(255,255,255,0.80)' }}
          >
            {slide.description}
          </p>
        </div>

        {/* Dot indicators */}
        <div className="flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="transition-all duration-300 focus:outline-none"
              style={{
                width: i === current ? 24 : 8,
                height: 8,
                borderRadius: 99,
                background:
                  i === current
                    ? 'rgba(255,255,255,0.95)'
                    : 'rgba(255,255,255,0.42)',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Progress bar ──────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-0 left-0 right-0 h-[3px] z-10"
        style={{ background: 'rgba(255,255,255,0.18)' }}
      >
        <div
          key={current}
          className="h-full"
          style={{
            background: 'rgba(255,255,255,0.80)',
            animation: `progressBar ${INTERVAL_MS}ms linear both`,
            width: '100%',
          }}
        />
      </div>

      {/* ── CSS keyframes injected inline ─────────────────────────────────── */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(18px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes progressBar {
          from { transform: scaleX(0); transform-origin: left; }
          to   { transform: scaleX(1); transform-origin: left; }
        }
      `}</style>
    </div>
  );
}
