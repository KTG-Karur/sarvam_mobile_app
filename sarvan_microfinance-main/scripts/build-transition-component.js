const fs = require('fs');
const path = require('path');

function buildComponent() {
  const svgPath = path.resolve('public/images/sarvam-login-animation.svg');
  const svgContent = fs.readFileSync(svgPath, 'utf8');

  function getGroupPaths(gid) {
    const match = svgContent.match(new RegExp('<g id="' + gid + '">([\\s\\S]*?)<\\/g>'));
    if (!match) throw new Error('Group not found: ' + gid);
    const paths = [];
    const pathMatches = [...match[1].matchAll(/<path\s+d="([^"]+)"\s+fill="([^"]+)"(?:\s+transform="([^"]+)")?\s*\/>/g)];
    for (const pm of pathMatches) {
      paths.push({ d: pm[1], fill: pm[2], transform: pm[3] || 'scale(0.5)' });
    }
    return paths;
  }

  const green1Paths = getGroupPaths('green-person-1');
  const yellow1Paths = getGroupPaths('yellow-person-1');
  const green2Paths = getGroupPaths('green-person-2');
  const yellow2Paths = getGroupPaths('yellow-person-2');
  const green3Paths = getGroupPaths('green-person-3');
  const yellow3Paths = getGroupPaths('yellow-person-3');
  const centerPaths = getGroupPaths('center-icon');

  const componentTsx = `'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion } from 'framer-motion';

export interface SarvamLoginTransitionProps {
  onComplete: () => void;
}

/* ─── Fast Snap Easing Curve ──────────────────────────────────────────────── */
const SNAP_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]; // Clean, decisive snap ease-out
const EXPAND_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]; // Smooth corporate expansion ease-out

/* ─── SVG Vector Path Data (Source: public/images/sarvam-login-animation.svg) ─ */
const PATH_GREEN_PERSON_1 = ${JSON.stringify(green1Paths[0].d)};
const PATH_YELLOW_PERSON_1 = ${JSON.stringify(yellow1Paths[0].d)};
const PATH_GREEN_PERSON_2 = ${JSON.stringify(green2Paths[0].d)};
const PATH_YELLOW_PERSON_2 = ${JSON.stringify(yellow2Paths[0].d)};
const PATH_GREEN_PERSON_3 = ${JSON.stringify(green3Paths[0].d)};
const PATH_YELLOW_PERSON_3 = ${JSON.stringify(yellow3Paths[0].d)};
const PATH_CENTER_GRAPH = ${JSON.stringify(centerPaths[0].d)};
const PATH_CENTER_ARROW = ${JSON.stringify(centerPaths[1].d)};

interface DispersionStreak {
  d: string;
  opacity: number;
}

interface FigureItem {
  id: string;
  path: string;
  fill: string;
  initial: { x: number; y: number; rotate: number };
  staggerIndex: number;
  dispersion: DispersionStreak[];
}

/* ─── 6 Human Figures with Attached Directional Color Dispersion ───────────── */
const FIGURES: FigureItem[] = [
  {
    id: 'green-person-1',
    path: PATH_GREEN_PERSON_1,
    fill: '#037F35',
    initial: { x: -145, y: -100, rotate: -18 },
    staggerIndex: 0, // 0ms offset
    dispersion: [
      { d: 'M 490 150 C 440 125 380 100 330 80 C 324 77 322 85 328 89 C 375 112 432 140 482 170 Z', opacity: 0.28 },
      { d: 'M 425 245 C 370 215 310 185 255 160 C 248 157 246 166 253 171 C 305 200 362 232 415 270 Z', opacity: 0.22 },
      { d: 'M 460 345 C 415 320 365 295 315 275 C 309 272 307 280 313 284 C 360 307 408 333 450 365 Z', opacity: 0.16 },
    ],
  },
  {
    id: 'yellow-person-1',
    path: PATH_YELLOW_PERSON_1,
    fill: '#FEBA02',
    initial: { x: 145, y: -100, rotate: 18 },
    staggerIndex: 1, // 25ms offset
    dispersion: [
      { d: 'M 1010 150 C 1060 125 1120 100 1170 80 C 1176 77 1178 85 1172 89 C 1125 112 1068 140 1018 170 Z', opacity: 0.28 },
      { d: 'M 1075 245 C 1130 215 1190 185 1245 160 C 1252 157 1254 166 1247 171 C 1195 200 1138 232 1085 270 Z', opacity: 0.22 },
      { d: 'M 1040 345 C 1085 320 1135 295 1185 275 C 1191 272 1193 280 1187 284 C 1140 307 1092 333 1050 365 Z', opacity: 0.16 },
    ],
  },
  {
    id: 'green-person-2',
    path: PATH_GREEN_PERSON_2,
    fill: '#037F35',
    initial: { x: 165, y: 0, rotate: 15 },
    staggerIndex: 2, // 50ms offset
    dispersion: [
      { d: 'M 1260 610 C 1320 595 1390 580 1450 570 C 1457 568 1459 577 1452 581 C 1388 600 1315 620 1250 635 Z', opacity: 0.28 },
      { d: 'M 1320 740 C 1385 735 1460 730 1530 725 C 1538 724 1539 734 1531 737 C 1458 750 1380 762 1310 770 Z', opacity: 0.24 },
      { d: 'M 1270 890 C 1330 905 1400 920 1460 935 C 1467 937 1465 946 1458 944 C 1392 925 1320 908 1258 890 Z', opacity: 0.16 },
    ],
  },
  {
    id: 'yellow-person-2',
    path: PATH_YELLOW_PERSON_2,
    fill: '#FEBA02',
    initial: { x: 125, y: 115, rotate: -18 },
    staggerIndex: 3, // 75ms offset
    dispersion: [
      { d: 'M 945 765 C 995 815 1050 870 1100 920 C 1106 926 1098 932 1092 926 C 1040 872 982 818 930 765 Z', opacity: 0.28 },
      { d: 'M 865 860 C 910 920 960 980 1005 1040 C 1011 1047 1003 1053 996 1046 C 950 982 898 920 850 860 Z', opacity: 0.22 },
      { d: 'M 770 760 C 810 820 855 880 895 940 C 900 946 892 951 886 945 C 842 882 795 820 750 760 Z', opacity: 0.16 },
    ],
  },
  {
    id: 'green-person-3',
    path: PATH_GREEN_PERSON_3,
    fill: '#037F35',
    initial: { x: -125, y: 115, rotate: 18 },
    staggerIndex: 4, // 100ms offset
    dispersion: [
      { d: 'M 555 765 C 505 815 450 870 400 920 C 394 926 402 932 408 926 C 460 872 518 818 570 765 Z', opacity: 0.28 },
      { d: 'M 635 860 C 590 920 540 980 495 1040 C 489 1047 481 1053 488 1046 C 550 982 602 920 650 860 Z', opacity: 0.22 },
      { d: 'M 730 760 C 690 820 645 880 605 940 C 600 946 608 951 614 945 C 658 882 705 820 750 760 Z', opacity: 0.16 },
    ],
  },
  {
    id: 'yellow-person-3',
    path: PATH_YELLOW_PERSON_3,
    fill: '#FEBA02',
    initial: { x: -165, y: 0, rotate: -15 },
    staggerIndex: 5, // 125ms offset
    dispersion: [
      { d: 'M 240 610 C 180 595 110 580 50 570 C 43 568 41 577 48 581 C 112 600 185 620 250 635 Z', opacity: 0.28 },
      { d: 'M 180 740 C 115 735 40 730 -30 725 C -38 724 -39 734 -31 737 C 42 750 120 762 190 770 Z', opacity: 0.24 },
      { d: 'M 230 890 C 170 905 100 920 40 935 C 33 937 35 946 42 944 C 108 925 180 908 242 890 Z', opacity: 0.16 },
    ],
  },
];

export function CompletedSarvamLogo() {
  return (
    <div className="relative flex items-center justify-center w-[90vw] max-w-[480px] sm:max-w-[540px] md:max-w-[620px] aspect-[2134/738]">
      {/* ── Left: Official Six-Person Symbol (35.33%) ──────────────── */}
      <div className="relative w-[35.33%] h-full flex items-center justify-center">
        <svg
          viewBox="0 0 754 738"
          width="100%"
          height="100%"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full object-contain overflow-visible"
        >
          <g id="center-icon">
            <path d={PATH_CENTER_GRAPH} fill="#037F35" transform="scale(0.5)" />
            <path d={PATH_CENTER_ARROW} fill="#FEBA02" transform="scale(0.5)" />
          </g>
          {FIGURES.map((fig) => (
            <g key={fig.id} id={fig.id}>
              <path d={fig.path} fill={fig.fill} transform="scale(0.5)" />
            </g>
          ))}
        </svg>
      </div>

      {/* ── Right: Official Wordmark (64.67%) ──────────────────────── */}
      <div className="relative w-[64.67%] h-full flex items-center justify-center select-none pointer-events-none">
        <Image
          src="/Sarvam_wordmark.png"
          alt="Sarvam Charitable Trust"
          width={1380}
          height={738}
          priority
          className="w-full h-full object-contain"
        />
      </div>
    </div>
  );
}

export function SarvamLoginTransition({ onComplete }: SarvamLoginTransitionProps) {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    // Sequence:
    // 0ms-820ms: 6 figures assemble + green graph builds + yellow arrow rises (center screen)
    // 820ms-900ms: Brief hold (~80ms) on completed symbol
    // 900ms-1170ms: Symbol gently shifts LEFT (270ms)
    // 920ms-1160ms: SARVAM reveals from right (240ms)
    // 950ms-1170ms: Underline width reveal (220ms)
    // 990ms-1160ms: CHARITABLE TRUST reveals upwards (170ms)
    // 1170ms: Full brand lockup completed & settled
    // 1170ms-1260ms: ~90ms stationary hold on settled logo
    // 1260ms-1640ms: Refined soft polished light reflection sweeps left-to-right (380ms, peak opacity ~85%, 15° angle, bright center, fully exits right)
    // 1640ms-1720ms: ~80ms stationary hold on completed logo
    // 1720ms: Navigate / onComplete() triggers smooth dashboard crossfade
    // Reduced motion: 150ms settle -> 150ms transform -> 150ms hold -> navigate at 450ms
    const totalDuration = shouldReduceMotion ? 450 : 1720;
    const timer = setTimeout(() => {
      onComplete();
    }, totalDuration);

    return () => clearTimeout(timer);
  }, [onComplete, shouldReduceMotion]);

  return (
    <div
      className="fixed inset-0 z-[150] flex flex-col items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#F7FBF8' }}
      aria-label="Login transition"
      role="status"
    >
      {/* ── Official Full Brand Lockup Container (2134x738 Proportions) — sized ~1.6x vs. the original 440px cap ── */}
      <div className="relative flex items-center justify-center w-[94vw] max-w-[704px] aspect-[2134/738]">
        {/* ── Left: Assembled Six-Person Symbol (35.33%) ─────────────── */}
        <motion.div
          className="relative w-[35.33%] h-full flex items-center justify-center z-10"
          initial={{ x: '91.51%' }}
          animate={{ x: 0 }}
          transition={
            shouldReduceMotion
              ? { duration: 0.15, delay: 0.15, ease: 'easeOut' }
              : { duration: 0.27, delay: 0.90, ease: EXPAND_EASE }
          }
        >
          <svg
            viewBox="0 0 754 738"
            width="100%"
            height="100%"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-full object-contain overflow-visible"
          >
            {/* ── 7. Center Icon: Upward Building Green Graph & Rising Yellow Arrow ── */}
            <g id="center-icon">
              {/* Green Growth Graph: Builds upward into position without scaleY distortion (~500ms - ~720ms) */}
              <motion.g
                id="center-growth-graph"
                initial={{ y: 18, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0.15, delay: 0.25, ease: 'easeOut' }
                    : { duration: 0.22, delay: 0.50, ease: SNAP_EASE }
                }
              >
                <path d={PATH_CENTER_GRAPH} fill="#037F35" transform="scale(0.5)" />
              </motion.g>

              {/* Yellow Upward Arrow: Rises cleanly upward into position without stretching (~600ms - ~820ms) */}
              <motion.g
                id="center-yellow-arrow"
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={
                  shouldReduceMotion
                    ? { duration: 0.15, delay: 0.30, ease: 'easeOut' }
                    : { duration: 0.22, delay: 0.60, ease: SNAP_EASE }
                }
              >
                <path d={PATH_CENTER_ARROW} fill="#FEBA02" transform="scale(0.5)" />
              </motion.g>
            </g>

            {/* ── 6 Human Figures: Direct Fast Snap Assembly (0.40s, [0.22, 1, 0.36, 1]) ── */}
            {FIGURES.map((fig) => {
              const baseDelay = 0.10 + fig.staggerIndex * 0.025;
              return (
                <motion.g
                  key={fig.id}
                  id={fig.id}
                  style={{
                    transformBox: 'fill-box',
                    transformOrigin: 'center center',
                  }}
                  initial={{ x: fig.initial.x, y: fig.initial.y, rotate: fig.initial.rotate, opacity: 1 }}
                  animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.18, delay: 0.15, ease: 'easeInOut' }
                      : { duration: 0.40, delay: baseDelay, ease: SNAP_EASE }
                  }
                >
                  {/* ── Attached Outward Color Dispersion Streaks (Dissolve on Snap) ── */}
                  {!shouldReduceMotion && (
                    <motion.g
                      initial={{ opacity: 1, scale: 1 }}
                      animate={{ opacity: 0, scale: 0.85 }}
                      transition={{
                        duration: 0.32,
                        delay: baseDelay,
                        ease: 'easeOut',
                      }}
                      aria-hidden="true"
                      className="pointer-events-none"
                    >
                      {fig.dispersion.map((streak, idx) => (
                        <path
                          key={idx}
                          d={streak.d}
                          fill={fig.fill}
                          fillOpacity={streak.opacity}
                          transform="scale(0.5)"
                        />
                      ))}
                    </motion.g>
                  )}

                  {/* ── Solid Human Vector Piece (Always 100% Crisp) ──── */}
                  <path d={fig.path} fill={fig.fill} transform="scale(0.5)" />
                </motion.g>
              );
            })}
          </svg>
        </motion.div>

        {/* ── Right: Official Wordmark Composition (64.67%) ─────────── */}
        <div className="relative w-[64.67%] h-full select-none pointer-events-none">
          {/* 1. SARVAM Wordmark Title (Reveals from RIGHT: opacity 0->1, x 18->0) */}
          <motion.div
            className="absolute inset-0 w-full h-full"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={
              shouldReduceMotion
                ? { duration: 0.15, delay: 0.18, ease: 'easeOut' }
                : { duration: 0.24, delay: 0.92, ease: EXPAND_EASE }
            }
          >
            <Image
              src="/Sarvam_wordmark_title.png"
              alt="SARVAM"
              width={1380}
              height={738}
              priority
              className="w-full h-full object-contain"
            />
          </motion.div>

          {/* 2. Official Green/Yellow Underline (Horizontal clip reveal) */}
          <motion.div
            className="absolute inset-0 w-full h-full"
            initial={{ clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={
              shouldReduceMotion
                ? { duration: 0.15, delay: 0.20, ease: 'easeOut' }
                : { duration: 0.22, delay: 0.95, ease: 'easeOut' }
            }
          >
            <Image
              src="/Sarvam_wordmark_line.png"
              alt="Divider line"
              width={1380}
              height={738}
              priority
              className="w-full h-full object-contain"
            />
          </motion.div>

          {/* 3. CHARITABLE TRUST Sub-label (Reveals upwards: opacity 0->1, y 4->0) */}
          <motion.div
            className="absolute inset-0 w-full h-full"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              shouldReduceMotion
                ? { duration: 0.15, delay: 0.22, ease: 'easeOut' }
                : { duration: 0.17, delay: 0.99, ease: 'easeOut' }
            }
          >
            <Image
              src="/Sarvam_wordmark_sub.png"
              alt="CHARITABLE TRUST"
              width={1380}
              height={738}
              priority
              className="w-full h-full object-contain"
            />
          </motion.div>
        </div>

        {/* ── 4. Soft Polished Light Reflection (Single Pass Across Completed Lockup) ── */}
        {!shouldReduceMotion && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-30" aria-hidden="true">
            <motion.div
              className="absolute -top-6 -bottom-6 w-[30%] mix-blend-screen"
              style={{
                background:
                  'linear-gradient(105deg, rgba(255, 255, 255, 0) 0%, rgba(255, 255, 255, 0.05) 18%, rgba(255, 255, 255, 0.18) 30%, rgba(255, 255, 255, 0.42) 40%, rgba(255, 255, 255, 0.65) 46%, rgba(255, 255, 255, 0.85) 50%, rgba(255, 255, 255, 0.65) 54%, rgba(255, 255, 255, 0.42) 60%, rgba(255, 255, 255, 0.18) 70%, rgba(255, 255, 255, 0.05) 82%, rgba(255, 255, 255, 0) 100%)',
                filter: 'brightness(1.35) contrast(1.15)',
              }}
              initial={{ x: '-180%', opacity: 0 }}
              animate={{
                x: ['-180%', '520%'],
                opacity: [1, 1, 0],
              }}
              transition={{
                x: { duration: 0.38, delay: 1.26, ease: [0.42, 0, 0.58, 1] },
                opacity: { duration: 0.38, delay: 1.26, times: [0, 0.90, 1], ease: 'linear' },
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
`;

  fs.writeFileSync('components/SarvamLoginTransition.tsx', componentTsx);
  console.log('Successfully created components/SarvamLoginTransition.tsx');
}

buildComponent();
