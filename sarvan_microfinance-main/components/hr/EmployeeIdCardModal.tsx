'use client';

import React, { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
    Printer,
    Check,
    Copy,
    User,
    Loader2,
    X,
    Download,
    ArrowLeft,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBrandNames } from '@/app/lib/brand-context';

export interface IdCardData {
    fullName: string;
    employeeId: string;
    designation: string | null;
    department?: string | null;
    branchName: string | null;
    branchCode?: string | null;
    dateOfJoining?: string | null;
    dateOfBirth?: string | null;
    bloodGroup?: string | null;
    emergencyContactName?: string | null;
    emergencyContactRelation?: string | null;
    emergencyContactMobile?: string | null;
    mobileNumber?: string | null;
    photoUrl?: string | null;
    /** Current address — shown on the back, not the (often distant, less
     * relevant) permanent/native address. This card doubles as a trust/
     * introduction document when field staff visit a client's home. */
    address?: string | null;
}

interface EmployeeIdCardModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    data: IdCardData | null;
    /**
     * Called after the card is printed or a PDF is saved — the caller records
     * the issue (POST /api/hr/employees/[id]/id-card/issue) for reprint
     * tracking. Omitted for unofficial previews (not yet provisioned).
     */
    onIssued?: () => void;
}

type ViewMode = 'both' | 'front' | 'back';

// Single source of truth for the on-screen card footprint (native design
// size — the print/PDF paths derive their own scaling from this same 320×507
// box, see .id-card-print-frame below and exportIdCardPdf above). The preview
// area scales this box down (never crops it) to whatever space is actually
// available, per CARD_W/CARD_H/CARD_GAP.
const CARD_W = 320;
const CARD_H = 507;
const CARD_GAP = 40;

// html2canvas rasterizes whatever is in the DOM the instant it's called — an
// <img> whose src just changed (e.g. the employee photo swapping in from
// resolveIdCardPhotoUrl's background fetch) may not have finished decoding
// yet, which reads as a blank photo in the output even though the same
// element looks fine a moment later on screen. Wait for every image inside
// the captured card to actually finish (or fail) loading first.
function waitForImages(root: HTMLElement): Promise<void> {
    const images = Array.from(root.querySelectorAll('img'));
    return Promise.all(
        images.map((img) => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise<void>((resolve) => {
                const done = () => resolve();
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', done, { once: true });
                // Safety net — a stuck/broken image must never hang PDF export.
                setTimeout(done, 5000);
            });
        })
    ).then(() => undefined);
}

export function EmployeeIdCardModal({ open, onOpenChange, data, onIssued }: EmployeeIdCardModalProps) {
    const { toast } = useToast();
    const { companyNameShort: brandName } = useBrandNames();
    const [viewMode, setViewMode] = useState<ViewMode>('both');
    const [copied, setCopied] = useState(false);
    const [downloadingPdf, setDownloadingPdf] = useState(false);
    const [pdfTarget, setPdfTarget] = useState<'front' | 'back' | 'both' | null>(null);
    // True only while html2canvas is capturing — forces the preview's
    // responsive transform: scale() off during capture so an ancestor
    // transform is never in play while html2canvas measures text.
    const [pdfCapturing, setPdfCapturing] = useState(false);
    const printAreaRef = useRef<HTMLDivElement>(null);
    // Measures the preview area and scales the card(s) down to fit — width
    // AND height — so the complete card is always visible, never cropped,
    // regardless of viewport size or how many sides are shown at once.
    const workspaceRef = useRef<HTMLDivElement>(null);
    const [previewScale, setPreviewScale] = useState(1);
    useEffect(() => {
        const el = workspaceRef.current;
        if (!el) return;
        const totalW = viewMode === 'both' ? CARD_W * 2 + CARD_GAP : CARD_W;
        const compute = () => {
            const s = Math.min(1, el.clientWidth / totalW, el.clientHeight / CARD_H);
            setPreviewScale(Number.isFinite(s) && s > 0 ? s : 1);
        };
        compute();
        const ro = new ResizeObserver(compute);
        ro.observe(el);
        return () => ro.disconnect();
    }, [viewMode, open]);

    if (!data) return null;

    // Live verification link — the configured public URL, so a card printed from
    // a dev/staging machine still points scanners at production.
    const origin =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '') ||
        (typeof window !== 'undefined' ? window.location.origin : '');
    const verifyUrl = `${origin}/verify-employee/${encodeURIComponent(data.employeeId)}`;

    const formatDateDMY = (d?: string | null) => {
        if (!d) return '—';
        const date = new Date(d);
        if (isNaN(date.getTime())) return '—';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}-${month}-${date.getFullYear()}`;
    };

    const handleCopyVerifyUrl = () => {
        navigator.clipboard.writeText(verifyUrl);
        setCopied(true);
        toast({ title: 'Link Copied', description: 'Public verification URL copied to clipboard.' });
        setTimeout(() => setCopied(false), 2500);
    };

    const handlePrint = () => {
        window.print();
        // window.print() blocks until the dialog closes; the browser doesn't say
        // whether it was printed or cancelled, so treat opening it as issuing.
        onIssued?.();
    };

    // Exports the requested card side(s) to PDF at true CR80 size (54x85.6mm)
    // with centered, symmetric placement:
    //   • Single card  : A6 PORTRAIT (105 x 148 mm); x = 25.5 mm, y = 31.2 mm
    //   • Both cards   : A6 LANDSCAPE (148 x 105 mm); two 54 mm cards with 10 mm gap;
    //                    x = 15 mm, y = 9.7 mm
    // Client-only, so a failure never blocks Print, which stays the primary path.
    const exportIdCardPdf = async (sides: ('front' | 'back')[]) => {
        if (!sides.length) return;
        setDownloadingPdf(true);
        const target = sides.length === 1 ? sides[0] : 'both';
        setPdfTarget(target);
        try {
            // If any requested card isn't currently mounted in the DOM due to viewMode,
            // temporarily switch viewMode to 'both' so html2canvas can capture it. Also
            // force the responsive preview's transform: scale() off for the capture —
            // html2canvas walking a scaled ancestor is one more variable in its text-box
            // math, and the browser card itself is unaffected either way.
            const needFront = sides.includes('front');
            const needBack = sides.includes('back');
            const hasFront = !!document.getElementById('id-card-front');
            const hasBack = !!document.getElementById('id-card-back');
            let restoredViewMode: ViewMode | null = null;
            if ((needFront && !hasFront) || (needBack && !hasBack)) {
                restoredViewMode = viewMode;
                setViewMode('both');
            }
            setPdfCapturing(true);
            await new Promise((resolve) => setTimeout(resolve, 80));

            // Guards against a known html2canvas issue where text is captured before a
            // webfont (Poppins here) has actually finished loading, using fallback-font
            // metrics that don't match — a common cause of glyphs rendering clipped/
            // misaligned in the output image even though the live page looks correct.
            if (typeof document !== 'undefined' && document.fonts) {
                await Promise.allSettled([
                    document.fonts.load('17px Poppins'),
                    document.fonts.load('bold 17px Poppins'),
                    document.fonts.load('12px Poppins'),
                    document.fonts.load('bold 12px Poppins'),
                    document.fonts.ready,
                ]);
            }

            // html2canvas-pro, not html2canvas — Tailwind v4's default palette
            // reports out-of-sRGB-gamut colors via getComputedStyle as lab()/
            // oklch(), which plain html2canvas's CSS color parser doesn't
            // recognize at all (throws "unsupported color function" and aborts
            // before the card ever renders). html2canvas-pro is a drop-in fork
            // that adds support for those modern CSS Color 4 functions.
            const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
                import('html2canvas-pro'),
                import('jspdf'),
            ]);

            const single = sides.length === 1;
            const pageW = single ? 105 : 148;
            const pageH = single ? 148 : 105;
            const doc = new jsPDF({
                orientation: single ? 'portrait' : 'landscape',
                unit: 'mm',
                format: [pageW, pageH],
            });

            const cardW = 54;
            const cardH = 85.6;
            const totalW = cardW * sides.length + (sides.length > 1 ? 10 : 0);
            const x0 = (pageW - totalW) / 2;
            const y0 = (pageH - cardH) / 2;

            for (let i = 0; i < sides.length; i++) {
                const el = document.getElementById(sides[i] === 'front' ? 'id-card-front' : 'id-card-back');
                if (!el) continue;
                await waitForImages(el);
                const canvas = await (html2canvas as unknown as (element: HTMLElement, options?: Record<string, unknown>) => Promise<HTMLCanvasElement>)(el, {
                    scale: 2,
                    backgroundColor: '#ffffff',
                    // The employee photo now loads through /api/storage/proxy (see
                    // resolveIdCardPhotoUrl in OnboardingQueueClient.tsx /
                    // EmployeeMasterForm.tsx) specifically so it's same-origin —
                    // useCORS is kept as a harmless second line of defense for any
                    // other image that might end up cross-origin.
                    useCORS: true,
                    ignoreElements: (candidate: Element) => candidate.classList.contains('print-label-hidden'),
                    onclone: (clonedDoc: Document) => {
                        clonedDoc.querySelectorAll<HTMLElement>('.truncate').forEach((node) => {
                            if (node.scrollWidth <= node.clientWidth + 1) {
                                node.style.overflow = 'visible';
                            }
                        });
                    },
                });
                const x = x0 + i * (cardW + 10);
                doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y0, cardW, cardH);
            }

            if (restoredViewMode) {
                setViewMode(restoredViewMode);
                restoredViewMode = null;
            }

            const suffix =
                sides.length === 1
                    ? sides[0] === 'front'
                        ? 'Front'
                        : 'Back'
                    : 'Both';
            doc.save(`Sarvam-ID-Card-${data.employeeId}-${suffix}.pdf`);
            onIssued?.();
        } catch (err) {
            console.error('PDF EXPORT ERROR:', err);
            toast({ title: 'Error', description: 'Failed to generate PDF.', variant: 'destructive' });
        } finally {
            setDownloadingPdf(false);
            setPdfTarget(null);
            setPdfCapturing(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="id-card-dialog-content fixed inset-0 top-0 left-0 right-0 bottom-0 translate-x-0 translate-y-0 w-screen h-screen h-[100dvh] max-w-none sm:max-w-none max-h-none rounded-none border-0 p-0 sm:p-0 gap-0 flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden shadow-none z-[90]"
            >
                {/* ── HEADER — compact, fixed height (~64px); Back/title/close only.
                    View-mode + action controls live in their own bar at the bottom,
                    so this row never wraps to multiple lines regardless of screen width. ── */}
                <div className="print-label-hidden flex-shrink-0 w-full h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-3 sm:px-6 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onOpenChange(false)}
                            className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 -ml-1.5 flex-shrink-0"
                            title="Back"
                        >
                            <ArrowLeft className="h-5 w-5" />
                            <span className="sr-only">Back</span>
                        </Button>
                        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block flex-shrink-0" />
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/Sarvam_icon.png" alt="Sarvam" className="h-7 w-7 object-contain hidden sm:block flex-shrink-0" />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <DialogTitle className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-none truncate">
                                    Employee Identity Card
                                </DialogTitle>
                                <span className="text-[11px] px-2 py-0.5 rounded font-mono font-bold bg-[#E6F5EC] text-[#025C27] border border-[#037F35]/20 flex-shrink-0">
                                    {data.employeeId}
                                </span>
                            </div>
                            <DialogDescription className="hidden sm:flex text-slate-500 dark:text-slate-400 text-xs mt-0.5 items-center gap-1.5 truncate">
                                <span className="font-medium text-slate-700 dark:text-slate-300">{data.fullName}</span>
                                {[data.designation, data.branchName].filter(Boolean).map((part, i) => (
                                    <React.Fragment key={`${i}-${part}`}>
                                        <span>•</span>
                                        <span>{part}</span>
                                    </React.Fragment>
                                ))}
                            </DialogDescription>
                        </div>
                    </div>

                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onOpenChange(false)}
                        className="h-9 w-9 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex-shrink-0"
                        title="Close"
                    >
                        <X className="h-5 w-5" />
                        <span className="sr-only">Close</span>
                    </Button>
                </div>

                {/* ── CARD DISPLAY WORKSPACE (FULL COVERAGE STUDIO) — the only
                    scrollable region. The card itself never scrolls or clips: its
                    footprint is measured against this area and scaled down (via
                    previewScale) to always fit completely, both dimensions. ── */}
                <div className="id-card-workspace flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden bg-slate-100 dark:bg-slate-950/80 px-4 py-6 sm:px-8 sm:py-8">
                    <div ref={workspaceRef} className="w-full h-full flex items-start justify-center">
                        <div
                            className="id-card-scale-wrapper"
                            style={{
                                width: (viewMode === 'both' ? CARD_W * 2 + CARD_GAP : CARD_W) * previewScale,
                                height: CARD_H * previewScale,
                            }}
                        >
                    <div
                        ref={printAreaRef}
                        id="id-card-print-area"
                        className="flex items-start justify-center gap-10"
                        style={{
                            width: viewMode === 'both' ? CARD_W * 2 + CARD_GAP : CARD_W,
                            transform: pdfCapturing ? 'none' : `scale(${previewScale})`,
                            transformOrigin: 'top left',
                        }}
                    >
                    {/* ════════ FRONT SIDE (PORTRAIT CR80: 54mm × 85.6mm) ════════ */}
                    {(viewMode === 'both' || viewMode === 'front') && (
                        <div className="flex flex-col items-center">
                            <span className="print-label-hidden text-[11px] font-semibold tracking-wider text-slate-500 uppercase mb-2">
                                Front View
                            </span>
                            {/* Print-only physical frame — see .id-card-print-frame in the print
                                stylesheet below. On screen this is a plain, unstyled wrapper. */}
                            <div className="id-card-print-frame">
                            <div
                                id="id-card-front"
                                className="id-card-element w-[320px] h-[507px] rounded-[16px] bg-white border border-slate-300 shadow-[0_4px_16px_rgba(2,92,39,0.10),0_1px_4px_rgba(0,0,0,0.06)] relative overflow-hidden flex flex-col justify-start select-none text-slate-800 font-['Poppins',sans-serif]"
                            >
                                {/* Organic Curved Wave Accents */}
                                <svg
                                    className="absolute top-0 left-0 pointer-events-none z-0"
                                    width="34"
                                    height="330"
                                    viewBox="0 0 34 330"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M0 0 H20 C30 14 34 34 30 68 C25 105 16 155 12 210 C8 260 3 300 0 330 Z"
                                        fill="#037F35"
                                    />
                                </svg>
                                <svg
                                    className="absolute bottom-0 right-0 pointer-events-none z-0"
                                    width="34"
                                    height="260"
                                    viewBox="0 0 34 260"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M34 260 H14 C4 246 0 226 5 195 C9 160 18 110 24 60 C28 28 31 12 34 0 Z"
                                        fill="#FEBA02"
                                    />
                                </svg>

                                {/* Top Header: Logo & SARVAM Brand */}
                                <div className="relative z-10 pt-7 pb-1 w-[256px] mx-auto text-center">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/Sarvam_icon.png"
                                        alt="Sarvam"
                                        className="w-14 h-14 object-contain mx-auto"
                                    />
                                    <h1 className="text-[19px] font-bold tracking-[0.08em] text-slate-900 uppercase mt-1.5 leading-none text-center">
                                        {brandName}
                                    </h1>
                                </div>

                                {/* Middle Section: Photo & Employee Identity */}
                                <div className="relative z-10 flex flex-col items-center mt-5">
                                    {/* Prominent Employee Photograph */}
                                    <div className="relative">
                                        <div className="w-[124px] h-[138px] rounded-[18px] bg-[#E6F5EC]/30 border border-slate-200 shadow-xs overflow-hidden flex items-center justify-center">
                                            {data.photoUrl ? (
                                                // eslint-disable-next-line @next/next/no-img-element
                                                <img
                                                    src={data.photoUrl}
                                                    alt={data.fullName}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center justify-center text-slate-400 p-2 text-center h-full">
                                                    <User className="h-10 w-10 text-slate-300 mb-1" />
                                                    <span className="text-[7.5px] uppercase font-bold tracking-wider text-slate-400">
                                                        PHOTO NOT AVAILABLE
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Employee Name & Code (Center-aligned with clear separation) */}
                                    <div className="w-full mt-5 text-center px-4 font-['Poppins',sans-serif]">
                                        <h2 className="text-[17px] font-bold text-slate-900 tracking-tight leading-none uppercase truncate">
                                            {data.fullName}
                                        </h2>
                                        <p className="text-[12.5px] font-bold text-slate-900 tracking-wide mt-4 leading-none">
                                            Employee Code : <span className="font-bold">{data.employeeId}</span>
                                        </p>
                                    </div>

                                    {/* Blood Group & Emergency Contact — positioned downward to reduce excessive bottom whitespace */}
                                    <div className="w-[256px] mx-auto mt-12 font-['Poppins',sans-serif]">
                                        <div className="grid grid-cols-[136px_12px_1fr] items-center gap-y-2.5 text-[12px]">
                                            <span className="font-bold text-[#037F35]">Blood Group</span>
                                            <span className="font-bold text-slate-900 text-center">:</span>
                                            <span className="font-bold text-slate-900">{data.bloodGroup || '—'}</span>

                                            <span className="font-bold text-[#037F35]">Emergency Contact</span>
                                            <span className="font-bold text-slate-900 text-center">:</span>
                                            <span className="font-bold text-slate-900 tracking-tight">
                                                {data.emergencyContactMobile || '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                    )}

                    {/* ════════ BACK SIDE (PORTRAIT CR80: 54mm × 85.6mm) ════════ */}
                    {(viewMode === 'both' || viewMode === 'back') && (
                        <div className="flex flex-col items-center">
                            <span className="print-label-hidden text-[11px] font-semibold tracking-wider text-slate-500 uppercase mb-2">
                                Back View
                            </span>
                            <div className="id-card-print-frame">
                            <div
                                id="id-card-back"
                                className="id-card-element w-[320px] h-[507px] rounded-[16px] bg-white border border-slate-300 shadow-[0_4px_16px_rgba(2,92,39,0.10),0_1px_4px_rgba(0,0,0,0.06)] relative overflow-hidden flex flex-col justify-start select-none text-slate-800 font-['Poppins',sans-serif]"
                            >
                                {/* Organic Curved Wave Accents */}
                                <svg
                                    className="absolute top-0 left-0 pointer-events-none z-0"
                                    width="34"
                                    height="330"
                                    viewBox="0 0 34 330"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M0 0 H20 C30 14 34 34 30 68 C25 105 16 155 12 210 C8 260 3 300 0 330 Z"
                                        fill="#037F35"
                                    />
                                </svg>
                                <svg
                                    className="absolute bottom-0 right-0 pointer-events-none z-0"
                                    width="34"
                                    height="260"
                                    viewBox="0 0 34 260"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                >
                                    <path
                                        d="M34 260 H14 C4 246 0 226 5 195 C9 160 18 110 24 60 C28 28 31 12 34 0 Z"
                                        fill="#FEBA02"
                                    />
                                </svg>

                                {/* 1. Top Metadata Section — reserved min-h-[96px] ensuring multi-line address never pushes or overlaps signature */}
                                <div className="relative z-10 w-[252px] ml-[42px] pt-8 min-h-[96px] font-['Poppins',sans-serif]">
                                    <div className="grid grid-cols-[124px_12px_1fr] items-start gap-y-2 text-[10.5px] leading-[18px]">
                                        <span className="font-bold text-[#4B5563] tracking-tight">Date of Joining</span>
                                        <span className="font-bold text-[#4B5563] text-center">:</span>
                                        <span className="font-bold text-slate-900 text-[9.5px]">{formatDateDMY(data.dateOfJoining)}</span>

                                        <span className="font-bold text-[#4B5563] tracking-tight">Date of Birth</span>
                                        <span className="font-bold text-[#4B5563] text-center">:</span>
                                        <span className="font-bold text-slate-900 text-[9.5px]">{formatDateDMY(data.dateOfBirth)}</span>

                                        <span className="font-bold text-[#4B5563] tracking-tight">Residential Address</span>
                                        <span className="font-bold text-[#4B5563] text-center">:</span>
                                        <span className="font-bold text-slate-900 text-[9.5px] leading-[15px] break-words line-clamp-3">
                                            {data.address || '—'}
                                        </span>
                                    </div>
                                </div>

                                {/* 2. Middle Section: Scannable QR Code & Authorised Signatory — shifted slightly below */}
                                <div className="relative z-10 w-[256px] mx-auto mt-10 flex items-start justify-between font-['Poppins',sans-serif]">
                                    {/* QR Code Block */}
                                    <div className="flex flex-col items-center">
                                        <div className="w-[74px] h-[74px] p-1 bg-white rounded border border-emerald-600/30 shadow-xs flex items-center justify-center">
                                            <QRCodeSVG
                                                value={verifyUrl}
                                                size={66}
                                                level="M"
                                                fgColor="#01401B"
                                                bgColor="#FFFFFF"
                                                includeMargin={false}
                                            />
                                        </div>
                                        <div className="h-[14px] flex items-center justify-center mt-1.5">
                                            <span className="text-[8px] font-bold tracking-wider text-[#037F35] uppercase leading-none text-center block whitespace-nowrap">
                                                SCAN TO VERIFY
                                            </span>
                                        </div>
                                    </div>

                                    {/* Authorised Signatory Block */}
                                    <div className="flex flex-col items-center">
                                        <div className="w-[110px] h-[74px] flex items-center justify-center">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img
                                                src="/api/branding/asset/authorised-signatory"
                                                alt="Authorised Signatory"
                                                className="h-[52px] max-w-[104px] w-auto object-contain translate-y-1.5"
                                            />
                                        </div>
                                        <div className="h-[14px] flex items-center justify-center mt-1.5">
                                            <span className="text-[9px] font-bold text-black tracking-tight leading-none text-center block whitespace-nowrap">
                                                Authorised Signatory
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* 3. Bottom Section: Logo, Wordmark, Head Office & Contact — shifted slightly below */}
                                <div className="relative z-10 w-[256px] mx-auto mt-14 pb-6 flex flex-col items-center text-center font-['Poppins',sans-serif]">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src="/Sarvam_icon.png"
                                        alt="Sarvam"
                                        className="w-11 h-11 object-contain mx-auto"
                                    />
                                    <div className="text-[16px] font-bold tracking-wider text-slate-900 uppercase mt-1.5 leading-none text-center">
                                        {brandName}
                                    </div>

                                    {/* Divider with HEAD OFFICE : */}
                                    <div className="w-full flex items-center justify-center gap-2 my-2.5">
                                        <div className="flex-1 h-[1px] bg-slate-300" />
                                        <span className="text-[7.5px] font-bold tracking-wider text-slate-700 uppercase whitespace-nowrap px-1">
                                            HEAD OFFICE :
                                        </span>
                                        <div className="flex-1 h-[1px] bg-slate-300" />
                                    </div>

                                    {/* Address */}
                                    <div className="text-[8.5px] font-bold text-slate-900 leading-tight max-w-[240px] mx-auto text-center">
                                        No-188C, Naganampatty Fire Service Road,<br />
                                        KVP Anna Nagar Opposite, Oddanchatram - 624619.
                                    </div>

                                    {/* Contact info */}
                                    <div className="flex items-center justify-center gap-2 text-[8px] font-bold text-slate-900 mt-2 text-center">
                                        <span>☎ 04553 243227</span>
                                        <span className="text-slate-400">•</span>
                                        <span>✉ sarvamheadoffice@gmail.com</span>
                                    </div>
                                </div>
                            </div>
                            </div>
                        </div>
                    )}
                    </div>
                        </div>
                    </div>
                </div>

                {/* ── BOTTOM ACTION / CONTROL BAR — view-mode switcher + actions.
                    Wraps on desktop; scrolls horizontally on narrow screens (the
                    card preview above is never affected by this). ── */}
                <div className="print-label-hidden flex-shrink-0 w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 sm:px-6 py-2.5">
                    <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible">
                        {/* View Switcher Segmented Control */}
                        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => setViewMode('both')}
                                className={`px-3 py-1 rounded-md font-medium text-xs transition-all whitespace-nowrap ${
                                    viewMode === 'both'
                                        ? 'bg-white dark:bg-slate-900 text-[#025C27] dark:text-emerald-300 shadow-sm font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                Side-by-Side
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('front')}
                                className={`px-3 py-1 rounded-md font-medium text-xs transition-all whitespace-nowrap ${
                                    viewMode === 'front'
                                        ? 'bg-white dark:bg-slate-900 text-[#025C27] dark:text-emerald-300 shadow-sm font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                Front Side
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('back')}
                                className={`px-3 py-1 rounded-md font-medium text-xs transition-all whitespace-nowrap ${
                                    viewMode === 'back'
                                        ? 'bg-white dark:bg-slate-900 text-[#025C27] dark:text-emerald-300 shadow-sm font-semibold'
                                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                                }`}
                            >
                                Back Side
                            </button>
                        </div>

                        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 flex-shrink-0" />

                        {/* Action Buttons */}
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCopyVerifyUrl}
                            className="h-8 text-xs border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 gap-1.5 flex-shrink-0"
                        >
                            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            Copy QR Link
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => exportIdCardPdf(['front'])}
                            disabled={downloadingPdf}
                            className="h-8 text-xs border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 gap-1.5 flex-shrink-0"
                        >
                            {pdfTarget === 'front' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            PDF Front
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => exportIdCardPdf(['back'])}
                            disabled={downloadingPdf}
                            className="h-8 text-xs border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 gap-1.5 flex-shrink-0"
                        >
                            {pdfTarget === 'back' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            PDF Back
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => exportIdCardPdf(['front', 'back'])}
                            disabled={downloadingPdf}
                            className="h-8 text-xs border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 gap-1.5 flex-shrink-0"
                        >
                            {pdfTarget === 'both' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                            PDF Both Sides
                        </Button>
                        <Button
                            size="sm"
                            onClick={handlePrint}
                            className="h-8 text-xs bg-[#037F35] hover:bg-[#025C27] text-white font-medium gap-1.5 shadow-sm flex-shrink-0"
                        >
                            <Printer className="h-3.5 w-3.5" />
                            Print ID Card
                        </Button>
                    </div>
                </div>

                {/* ID Card Typography & Print Stylesheet */}
                <style jsx global>{`
                    @font-face {
                        font-family: 'Poppins';
                        font-style: normal;
                        font-weight: 400;
                        font-display: swap;
                        src: url('/fonts/Poppins-400.woff2') format('woff2'),
                             url('/fonts/Poppins-Regular.ttf') format('truetype');
                    }
                    @font-face {
                        font-family: 'Poppins';
                        font-style: normal;
                        font-weight: 500;
                        font-display: swap;
                        src: url('/fonts/Poppins-500.woff2') format('woff2'),
                             url('/fonts/Poppins-Medium.ttf') format('truetype');
                    }
                    @font-face {
                        font-family: 'Poppins';
                        font-style: normal;
                        font-weight: 600;
                        font-display: swap;
                        src: url('/fonts/Poppins-600.woff2') format('woff2'),
                             url('/fonts/Poppins-SemiBold.ttf') format('truetype');
                    }
                    @font-face {
                        font-family: 'Poppins';
                        font-style: normal;
                        font-weight: 700;
                        font-display: swap;
                        src: url('/fonts/Poppins-700.woff2') format('woff2'),
                             url('/fonts/Poppins-Bold.ttf') format('truetype');
                    }
                    @font-face {
                        font-family: 'Poppins';
                        font-style: normal;
                        font-weight: 800;
                        font-display: swap;
                        src: url('/fonts/Poppins-ExtraBold.ttf') format('truetype');
                    }
                    .id-card-element,
                    .id-card-element * {
                        font-family: 'Poppins', var(--font-app-sans), sans-serif !important;
                    }
                    @media print {
                        @page {
                            size: A4 portrait;
                            margin: 15mm;
                        }
                        body * {
                            visibility: hidden !important;
                        }
                        #id-card-print-area, #id-card-print-area * {
                            visibility: visible !important;
                        }
                        .id-card-workspace {
                            overflow: visible !important;
                            padding: 0 !important;
                            margin: 0 !important;
                            background: transparent !important;
                        }
                        /* Both are screen-only sizing helpers for the responsive
                           scale-to-fit preview (see previewScale in the component) —
                           neutralized here so they can never affect the print layout,
                           which computes its own fixed scale below. */
                        .id-card-scale-wrapper {
                            width: auto !important;
                            height: auto !important;
                        }
                        /* The dialog wrapper is fixed-positioned with a translate transform
                           centering it on screen. Two things must both be true for the print
                           area's absolute position below to land in the right place:
                           (1) it must stay OUT of normal document flow (position: static would
                           let it flow in normal document order — after everything else on the
                           page, which is only invisible via visibility:hidden, not removed from
                           layout, so it still occupies real height and pushes this element onto
                           a later page); position: fixed already gives us that.
                           (2) per the CSS Paged Media spec, a fixed-position element's
                           containing block during print is each page's own box — so once its
                           own top/left/transform are zeroed out (removing the on-screen
                           centering), it sits exactly at the page's top-left corner, and the
                           print area's left/top offsets below then resolve correctly against
                           the actual printed page rather than the on-screen dialog box. */
                        .id-card-dialog-content {
                            position: fixed !important;
                            top: 0 !important;
                            left: 0 !important;
                            right: 0 !important;
                            bottom: auto !important;
                            transform: none !important;
                            width: 100% !important;
                            max-width: none !important;
                            max-height: none !important;
                            overflow: visible !important;
                            box-shadow: none !important;
                            border: none !important;
                            background: transparent !important;
                            padding: 0 !important;
                            margin: 0 !important;
                        }
                        #id-card-print-area {
                            position: absolute !important;
                            top: 0 !important;
                            left: 0 !important;
                            right: 0 !important;
                            bottom: auto !important;
                            width: auto !important;
                            /* Cancels the responsive preview's inline transform:scale() —
                               print always uses .id-card-element's own fixed scale below. */
                            transform: none !important;
                            display: flex !important;
                            flex-direction: row !important;
                            flex-wrap: nowrap !important;
                            align-items: flex-start !important;
                            justify-content: center !important;
                            gap: 15mm !important;
                            padding-top: 15mm !important;
                            margin: 0 !important;
                            background: transparent !important;
                            border: none !important;
                        }
                        /* .id-card-element is authored at a fixed 320×507px on-screen size —
                           every child (photo box, info-row widths, font sizes) is a fixed px
                           value tuned for that 320px box, not a proportion of it. Forcing the
                           OUTER box down to 54mm (~204px) while leaving children at their
                           320px-relative sizes made children overflow the shrunk box on both
                           sides (centered content overflows symmetrically) and get clipped by
                           its own overflow-hidden — that was the cause of text being cut off
                           mid-word in print/PDF output. Fixing that without rewriting every
                           child to relative units: keep .id-card-element at its native 320×507px
                           and uniformly transform: scale() it down inside a separate,
                           correctly-sized .id-card-print-frame — scaling (unlike resizing)
                           shrinks every descendant in proportion, so nothing overflows. */
                        .id-card-print-frame {
                            width: 54mm !important;
                            height: 85.6mm !important;
                            overflow: hidden !important;
                            position: relative !important;
                            flex: 0 0 auto !important;
                            margin: 0 !important;
                            padding: 0 !important;
                            border: 0.5pt solid #94a3b8 !important;
                            border-radius: 3.18mm !important;
                            background: #fff !important;
                            page-break-inside: avoid !important;
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        .id-card-element {
                            width: 320px !important;
                            height: 507px !important;
                            min-width: 320px !important;
                            min-height: 507px !important;
                            max-width: none !important;
                            max-height: none !important;
                            /* 54mm at 96dpi ≈ 204.1px; 204.1 / 320 ≈ 0.6378 */
                            transform: scale(0.6378) !important;
                            transform-origin: top left !important;
                            box-shadow: none !important;
                            border: none !important;
                            border-radius: 0 !important;
                            margin: 0 !important;
                            -webkit-print-color-adjust: exact !important;
                            print-color-adjust: exact !important;
                        }
                        .print-label-hidden {
                            display: none !important;
                        }
                    }
                `}</style>
            </DialogContent>
        </Dialog>
    );
}
