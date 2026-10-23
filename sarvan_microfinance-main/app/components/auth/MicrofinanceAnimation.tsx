'use client';

import { motion } from 'framer-motion';

/* ── Static data (no Math.random — avoids hydration mismatch) ──────────── */

const RISING_COINS: { x: number; delay: number; dur: number; size: number }[] = [
  { x: 55,  delay: 0,    dur: 3.5, size: 18 },
  { x: 112, delay: 0.9,  dur: 3.1, size: 15 },
  { x: 172, delay: 1.6,  dur: 3.8, size: 20 },
  { x: 238, delay: 0.4,  dur: 3.3, size: 16 },
  { x: 300, delay: 1.3,  dur: 3.6, size: 18 },
  { x: 358, delay: 0.7,  dur: 3.0, size: 14 },
];

const PEOPLE: { x: number; delay: number; big: boolean; color: string }[] = [
  { x: 110, delay: 0,   big: false, color: '#025c27' },
  { x: 200, delay: 0.5, big: true,  color: '#037f35' },
  { x: 290, delay: 1.0, big: false, color: '#025c27' },
];

const BARS: { h: number; delay: number }[] = [
  { h: 35, delay: 0.20 },
  { h: 55, delay: 0.36 },
  { h: 45, delay: 0.52 },
  { h: 72, delay: 0.68 },
  { h: 92, delay: 0.84 },
  { h: 80, delay: 1.00 },
];

const SPARKLES: { x: number; y: number; r: number; delay: number }[] = [
  { x: 74,  y: 84,  r: 4, delay: 0.3  },
  { x: 326, y: 68,  r: 3, delay: 1.2  },
  { x: 352, y: 184, r: 5, delay: 0.7  },
  { x: 48,  y: 196, r: 4, delay: 1.6  },
  { x: 200, y: 26,  r: 3, delay: 1.0  },
  { x: 284, y: 136, r: 4, delay: 0.4  },
  { x: 116, y: 142, r: 3, delay: 1.9  },
];

const CX = 200;
const CY = 148;
const RINGS = [90, 108, 126] as const;

/* ── Component ──────────────────────────────────────────────────────────── */

export function MicrofinanceAnimation() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center">
      <svg
        viewBox="0 0 400 340"
        className="w-full max-w-xs sm:max-w-sm"
        aria-label="Microfinance community illustration"
      >
        {/* ── Definitions ─────────────── */}
        <defs>
          <radialGradient id="mf-center" cx="40%" cy="35%" r="65%">
            <stop offset="0%"   stopColor="#04a845" />
            <stop offset="100%" stopColor="#012b14" />
          </radialGradient>
          <linearGradient id="mf-coin" x1="20%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%"   stopColor="#ffe76e" />
            <stop offset="100%" stopColor="#d4900d" />
          </linearGradient>
          <radialGradient id="mf-bg" cx="50%" cy="43%" r="55%">
            <stop offset="0%"   stopColor="rgba(4,168,69,0.26)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>

        {/* ── Soft background glow ─────────────── */}
        <ellipse cx={CX} cy={CY} rx={185} ry={155} fill="url(#mf-bg)" />

        {/* ── Pulsing rings ─────────────── */}
        {RINGS.map((r, i) => (
          <motion.circle
            key={`ring-${i}`}
            cx={CX} cy={CY} r={r}
            fill="none"
            stroke="rgba(4,168,69,0.22)"
            strokeWidth={1.5}
            animate={{ r: [r - 5, r + 7, r - 5], opacity: [0.08, 0.46, 0.08] }}
            transition={{ duration: 3.2, repeat: Infinity, delay: i * 0.88, ease: 'easeInOut' }}
          />
        ))}

        {/* ── Central glow halo ─────────────── */}
        <motion.circle
          cx={CX} cy={CY} r={70}
          fill="rgba(4,168,69,0.12)"
          animate={{ r: [66, 75, 66] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ── Central emblem ─────────────── */}
        <circle cx={CX} cy={CY} r={64} fill="url(#mf-center)" />
        <circle cx={CX} cy={CY} r={64} fill="none" stroke="rgba(254,185,2,0.72)" strokeWidth={2.5} />
        <circle cx={CX} cy={CY} r={56} fill="none" stroke="rgba(254,185,2,0.22)" strokeWidth={1}   />

        {/* ── Central ₹ ─────────────── */}
        <motion.text
          x={CX} y={CY + 5}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={52}
          fontWeight="bold"
          fill="#feb902"
          fontFamily="Georgia,'Times New Roman',serif"
          animate={{ opacity: [0.80, 1, 0.80] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        >
          ₹
        </motion.text>

        {/* ── Sparkle particles ─────────────── */}
        {SPARKLES.map((sp, i) => (
          <motion.circle
            key={`sp-${i}`}
            cx={sp.x} cy={sp.y} r={sp.r}
            fill="#feb902"
            animate={{ opacity: [0, 0.85, 0], r: [sp.r * 0.3, sp.r, sp.r * 0.3] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: sp.delay, ease: 'easeInOut' }}
          />
        ))}

        {/* ── Rising coins ─────────────── */}
        {RISING_COINS.map((coin, i) => (
          <motion.g
            key={`coin-${i}`}
            animate={{ y: [0, -60, -125, -190], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: coin.dur,
              repeat: Infinity,
              delay: coin.delay,
              ease: 'easeOut',
              repeatDelay: 0.4,
            }}
          >
            {/* shadow */}
            <circle cx={coin.x} cy={315} r={coin.size + 1} fill="rgba(0,0,0,0.12)" />
            {/* body */}
            <circle cx={coin.x} cy={313} r={coin.size} fill="url(#mf-coin)" />
            <circle cx={coin.x} cy={313} r={coin.size} fill="none" stroke="#b8860b" strokeWidth={1.2} />
            <text
              x={coin.x} y={313 + 1}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={coin.size * 0.95} fontWeight="bold"
              fill="#013318" fontFamily="serif"
            >
              ₹
            </text>
          </motion.g>
        ))}

        {/* ── People silhouettes ─────────────── */}
        {PEOPLE.map((p, i) => {
          const hr = p.big ? 13 : 11;
          const bw = p.big ? 20 : 18;
          return (
            <motion.g
              key={`person-${i}`}
              animate={{ y: [0, -4, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
            >
              {/* head */}
              <circle cx={p.x} cy={268}   r={hr} fill={p.color} />
              {/* body */}
              <rect   x={p.x - bw / 2} y={280} width={bw} height={22} rx={5} fill={p.color} />
              {/* legs */}
              <rect   x={p.x - 8}  y={299} width={7} height={16} rx={3} fill={p.color} />
              <rect   x={p.x + 1}  y={299} width={7} height={16} rx={3} fill={p.color} />
            </motion.g>
          );
        })}

        {/* ── Community link lines ─────────────── */}
        {[{ x1: 110, x2: 200 }, { x1: 200, x2: 290 }].map(({ x1, x2 }, i) => (
          <motion.line
            key={`link-${i}`}
            x1={x1} y1={277} x2={x2} y2={277}
            stroke="rgba(254,185,2,0.45)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            animate={{ opacity: [0.25, 0.7, 0.25] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.6 }}
          />
        ))}

        {/* ── Ground line ─────────────── */}
        <line x1={45} y1={320} x2={355} y2={320} stroke="rgba(4,168,69,0.3)" strokeWidth={2} strokeLinecap="round" />

        {/* ── Bar chart (bottom-left) ─────────────── */}
        {BARS.map((bar, i) => (
          <motion.line
            key={`bar-${i}`}
            x1={22 + i * 14 + 5} y1={320}
            x2={22 + i * 14 + 5} y2={320 - bar.h}
            stroke="#feb902"
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={bar.h}
            strokeDashoffset={bar.h}
            animate={{ strokeDashoffset: [bar.h, 0, 0, bar.h] }}
            transition={{
              duration: 5.5,
              delay: bar.delay,
              ease: 'easeInOut',
              repeat: Infinity,
              times: [0, 0.13, 0.85, 1],
            }}
          />
        ))}

        {/* ── Upward trend (bottom-right) ─────────────── */}
        <motion.path
          d="M332,318 L346,298 L360,306 L374,278 L389,258"
          fill="none" stroke="#04a845" strokeWidth={3}
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray={112} strokeDashoffset={112}
          animate={{ strokeDashoffset: [112, 0, 0, 112] }}
          transition={{ duration: 5, delay: 1, ease: 'easeInOut', repeat: Infinity, times: [0, 0.28, 0.82, 1] }}
        />
        <motion.circle
          cx={389} cy={258} r={5} fill="#04a845"
          animate={{ opacity: [0, 0, 1, 1, 0], scale: [0, 0, 1, 1, 0] }}
          transition={{ duration: 5, delay: 1, repeat: Infinity, times: [0, 0.26, 0.32, 0.82, 1] }}
        />

        {/* ── Side leaf accents ─────────────── */}
        <motion.path
          d="M14 302 Q15 272 36 265 Q17 278 14 302 Z"
          fill="rgba(4,168,69,0.55)"
          animate={{ opacity: [0.35, 0.75, 0.35] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.path
          d="M386 302 Q385 274 364 267 Q383 280 386 302 Z"
          fill="rgba(4,168,69,0.55)"
          animate={{ opacity: [0.35, 0.75, 0.35] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut', delay: 0.9 }}
        />
      </svg>

      {/* ── Tagline ─────────────── */}
      <motion.div
        className="mt-5 px-4 text-center"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.4 }}
      >
        <p className="text-xl font-bold tracking-wide text-white">Empowering Communities</p>
        <p className="mt-1 text-xs text-green-300/75">
          Trusted Microfinance · Financial Inclusion · Growth
        </p>
      </motion.div>
    </div>
  );
}
