'use client';

import { useMemo, type CSSProperties } from 'react';
import Image from 'next/image';
import { ArrowUpRight, Building2 } from 'lucide-react';

/** Background-removed portrait (transparent PNG, 1024×1536). Rename the file when replacing it — next/image caches by URL. */
const EOD_ILLUSTRATION_SRC = '/eod-officer-v2.png';

/**
 * Blazer-only alpha mask generated from the portrait above (regenerate it if the portrait changes).
 * The overlay uses `mix-blend-mode: color`, so the blazer takes the theme hue but keeps its shading.
 */
const DRESS_MASK = "url('/eod-officer-v2-dress-mask.png') center bottom / contain no-repeat";
const DRESS_TINT_STYLE: CSSProperties = { mask: DRESS_MASK, WebkitMask: DRESS_MASK };

const EOD_QUOTES: { text: string; author: string }[] = [
    { text: 'Small daily improvements lead to stunning long-term results.', author: 'Robin Sharma' },
    { text: 'Beware of little expenses. A small leak will sink a great ship.', author: 'Benjamin Franklin' },
    { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
    { text: 'Accuracy builds trust. Trust builds the branch.', author: 'Sarvam' },
    { text: 'Do not save what is left after spending; spend what is left after saving.', author: 'Warren Buffett' },
    { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
    { text: 'Every rupee counted right is a family served right.', author: 'Sarvam' },
    { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
    { text: 'Discipline is the bridge between goals and accomplishment.', author: 'Jim Rohn' },
    { text: 'A day closed well is the best start for tomorrow.', author: 'Sarvam' },
];

/** IST hour + day-of-year, so the greeting and daily quote follow the business calendar. */
function getKolkataClock(): { hour: number; dayOfYear: number } {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const year = get('year');
    const dayOfYear = Math.floor((Date.UTC(year, get('month') - 1, get('day')) - Date.UTC(year, 0, 0)) / 86_400_000);
    return { hour: get('hour'), dayOfYear };
}

function greetingFor(hour: number): string {
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

// Keyframes are scoped by the `eodb-` prefix; all motion is disabled under prefers-reduced-motion.
const BANNER_CSS = `
@keyframes eodb-sway { 0%,100% { transform: rotate(-3deg); } 50% { transform: rotate(4deg); } }
@keyframes eodb-fall {
  0%   { transform: translate(0,-30px) rotate(0deg); opacity: 0; }
  10%  { opacity: .9; }
  100% { transform: translate(-90px,300px) rotate(320deg); opacity: 0; }
}
@keyframes eodb-rise { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }
@keyframes eodb-glow { 0%,100% { opacity: .55; transform: scale(1); } 50% { opacity: .85; transform: scale(1.06); } }
.eodb-sway  { animation: eodb-sway 6s ease-in-out infinite; }
.eodb-fall  { animation: eodb-fall linear infinite; }
.eodb-rise  { animation: eodb-rise .8s ease-out both; }
.eodb-glow  { animation: eodb-glow 5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .eodb-sway, .eodb-fall, .eodb-rise, .eodb-glow { animation: none !important; }
  .eodb-fall { display: none; }
}
`;

export function EodWelcomeBanner({ userName, branchCount }: { userName?: string | null; branchCount: number }) {
    // Computed after mount (component only renders client-side once the user is loaded).
    const { greeting, quote } = useMemo(() => {
        const { hour, dayOfYear } = getKolkataClock();
        return { greeting: greetingFor(hour), quote: EOD_QUOTES[dayOfYear % EOD_QUOTES.length] };
    }, []);

    return (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-amber-50 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/40 dark:via-slate-950 dark:to-amber-950/20">
            <style>{BANNER_CSS}</style>

            {/* Corner foliage — swaying branches */}
            <div aria-hidden className="pointer-events-none absolute inset-0">
                <div className="eodb-sway absolute -right-8 -top-6 h-52 w-44 origin-top-right" style={{ animationDelay: '-2s' }}>
                    <LeafBranch className="h-full w-full -scale-x-100" />
                </div>
                <div className="eodb-sway absolute -bottom-10 -right-6 h-40 w-36 origin-bottom-right" style={{ animationDelay: '-4s' }}>
                    <LeafBranch className="h-full w-full -scale-100" />
                </div>

                {/* Falling leaves */}
                {FALLING_LEAVES.map((l, i) => (
                    <span
                        key={i}
                        className="eodb-fall absolute top-0"
                        style={{ left: l.left, animationDuration: l.duration, animationDelay: l.delay }}
                    >
                        <SingleLeaf className={l.size} tone={l.tone} />
                    </span>
                ))}
            </div>

            <div className="relative flex flex-col items-center gap-4 px-6 pt-6 sm:flex-row sm:items-stretch sm:gap-8 sm:pl-10 sm:pr-44 sm:pt-4">
                {/* Officer with glow; blazer tinted to the brand primary color */}
                <div className="relative h-64 w-44 shrink-0 sm:h-72 sm:w-48">
                    <div className="eodb-glow absolute inset-x-0 bottom-6 mx-auto h-48 w-48 rounded-full bg-gradient-to-tr from-emerald-300/50 to-amber-200/60 blur-2xl" />
                    <div className="eodb-rise relative isolate h-full w-full">
                        <Image
                            src={EOD_ILLUSTRATION_SRC}
                            alt="Branch officer ready to close the day"
                            width={1024}
                            height={1536}
                            sizes="200px"
                            priority
                            className="h-full w-full object-contain object-bottom drop-shadow-xl"
                        />
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0 bg-primary mix-blend-color"
                            style={DRESS_TINT_STYLE}
                        />
                    </div>
                </div>

                <div className="eodb-rise min-w-0 flex-1 pb-6 text-center sm:self-center sm:py-6 sm:text-left" style={{ animationDelay: '.15s' }}>
                    <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                        {greeting}{userName ? `, ${userName}` : ''}! <span aria-hidden>👋</span>
                    </h2>
                    <p className="mt-1 text-sm font-medium text-primary">Close the day right. Open tomorrow strong.</p>

                    <p className="mt-3 text-base italic text-slate-600 dark:text-slate-300">{quote.text}</p>

                    <div className="mt-4 flex flex-col items-center gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
                        <span className="inline-flex items-center gap-1.5">
                            <Building2 className="h-4 w-4 text-primary" aria-hidden />
                            You have access to <span className="font-semibold text-primary">{branchCount}</span> branch{branchCount === 1 ? '' : 'es'}.
                        </span>
                        <span className="inline-flex items-center gap-1 font-medium text-foreground">
                            Select a branch in EOD Setup to begin
                            <ArrowUpRight className="h-4 w-4 text-primary" aria-hidden />
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

const FALLING_LEAVES: { left: string; duration: string; delay: string; size: string; tone: LeafTone }[] = [
    { left: '30%', duration: '11s', delay: '0s', size: 'h-5 w-5', tone: 'light' },
    { left: '52%', duration: '14s', delay: '-5s', size: 'h-4 w-4', tone: 'dark' },
    { left: '68%', duration: '12s', delay: '-8s', size: 'h-6 w-6', tone: 'light' },
    { left: '85%', duration: '16s', delay: '-3s', size: 'h-4 w-4', tone: 'dark' },
    { left: '42%', duration: '13s', delay: '-10s', size: 'h-3 w-3', tone: 'light' },
];

type LeafTone = 'light' | 'dark';

// Leaf outline pointing along +x, 0..60 long; midrib + side veins drawn separately.
const LEAF_PATH = 'M0 0 C10 -12 34 -14 60 0 C34 14 10 12 0 0 Z';
const LEAF_VEINS = 'M8 0 L56 0 M16 0 L24 -6 M26 0 L34 -7 M36 0 L44 -6 M16 0 L24 6 M26 0 L34 7 M36 0 L44 6';

function LeafGradients() {
    return (
        <defs>
            <linearGradient id="eodb-leaf-light" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0%" stopColor="#c5dd8a" />
                <stop offset="100%" stopColor="#7fae4a" />
            </linearGradient>
            <linearGradient id="eodb-leaf-dark" x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
                <stop offset="0%" stopColor="#8fbf9a" />
                <stop offset="100%" stopColor="#3f7d5a" />
            </linearGradient>
        </defs>
    );
}

function Leaf({ x, y, angle, scale, tone }: { x: number; y: number; angle: number; scale: number; tone: LeafTone }) {
    return (
        <g transform={`translate(${x} ${y}) rotate(${angle}) scale(${scale})`}>
            <path d={LEAF_PATH} fill={`url(#eodb-leaf-${tone})`} />
            <path d={LEAF_VEINS} fill="none" stroke="#ffffff" strokeOpacity="0.45" strokeWidth="0.9" strokeLinecap="round" />
        </g>
    );
}

// Leaves hung off a drooping stem, alternating sides and shrinking toward the tip.
const BRANCH_LEAVES: { x: number; y: number; angle: number; scale: number; tone: LeafTone }[] = [
    { x: 22, y: 18, angle: -10, scale: 1.05, tone: 'dark' },
    { x: 30, y: 34, angle: 70, scale: 1.0, tone: 'light' },
    { x: 46, y: 50, angle: 5, scale: 0.95, tone: 'light' },
    { x: 54, y: 70, angle: 100, scale: 0.95, tone: 'dark' },
    { x: 70, y: 86, angle: 20, scale: 0.85, tone: 'dark' },
    { x: 76, y: 106, angle: 110, scale: 0.8, tone: 'light' },
    { x: 90, y: 124, angle: 35, scale: 0.7, tone: 'light' },
    { x: 94, y: 142, angle: 115, scale: 0.65, tone: 'dark' },
    { x: 104, y: 160, angle: 70, scale: 0.55, tone: 'light' },
];

function LeafBranch({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 160 200" className={className}>
            <LeafGradients />
            <path d="M6 6 C40 30 60 60 76 100 C88 130 98 150 106 178" fill="none" stroke="#5f8f4e" strokeWidth="2.4" strokeLinecap="round" />
            {BRANCH_LEAVES.map((l, i) => (
                <Leaf key={i} {...l} />
            ))}
        </svg>
    );
}

function SingleLeaf({ className, tone }: { className?: string; tone: LeafTone }) {
    return (
        <svg viewBox="-4 -16 68 32" className={className}>
            <LeafGradients />
            <Leaf x={0} y={0} angle={0} scale={1} tone={tone} />
        </svg>
    );
}
