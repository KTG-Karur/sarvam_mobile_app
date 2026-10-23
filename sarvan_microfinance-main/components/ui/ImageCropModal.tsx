'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { Check, X, Crop, Loader2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── types ────────────────────────────────────────────────────────────────────
/** Crop rectangle expressed as fractions (0–1) of the *image* dimensions */
type CropRect = { x: number; y: number; w: number; h: number };
type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

// ─── size presets ─────────────────────────────────────────────────────────────
const SIZE_OPTIONS = [
  { key: 'small',    label: 'Small',    sub: 'max 800 px',  maxDim: 800,  quality: 0.72 },
  { key: 'medium',   label: 'Medium',   sub: 'max 1200 px', maxDim: 1200, quality: 0.80 },
  { key: 'large',    label: 'Large',    sub: 'max 1920 px', maxDim: 1920, quality: 0.85 },
  { key: 'original', label: 'Original', sub: 'full size',   maxDim: 9999, quality: 0.90 },
] as const;

// ─── helpers ──────────────────────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const pct   = (n: number) => `${(n * 100).toFixed(3)}%`;
const MIN_FRAC = 0.05; // minimum crop dimension as a fraction of image size

function pointerClientXY(e: MouseEvent | TouchEvent) {
  const src = 'touches' in e ? e.touches[0] : e;
  return { cx: src.clientX, cy: src.clientY };
}

// ─── individual resize handle ─────────────────────────────────────────────────
const HANDLE_CLASSES: Record<string, string> = {
  nw: 'top-0    left-0   -translate-x-1/2 -translate-y-1/2 cursor-nw-resize',
  n:  'top-0    left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-n-resize',
  ne: 'top-0    right-0  translate-x-1/2  -translate-y-1/2 cursor-ne-resize',
  e:  'top-1/2  right-0  translate-x-1/2  -translate-y-1/2 cursor-e-resize',
  se: 'bottom-0 right-0  translate-x-1/2   translate-y-1/2 cursor-se-resize',
  s:  'bottom-0 left-1/2 -translate-x-1/2  translate-y-1/2 cursor-s-resize',
  sw: 'bottom-0 left-0   -translate-x-1/2  translate-y-1/2 cursor-sw-resize',
  w:  'top-1/2  left-0   -translate-x-1/2 -translate-y-1/2 cursor-w-resize',
};

function CropHandle({
  id,
  onStart,
}: {
  id: HandleId;
  onStart: (e: React.MouseEvent | React.TouchEvent) => void;
}) {
  return (
    <div
      className={cn(
        'absolute z-10 h-4 w-4 rounded-full bg-white border-2 border-sky-500 shadow-md',
        HANDLE_CLASSES[id],
      )}
      onMouseDown={(e) => { e.stopPropagation(); onStart(e); }}
      onTouchStart={(e) => { e.stopPropagation(); onStart(e); }}
    />
  );
}

// ─── main export ──────────────────────────────────────────────────────────────
export type ImageCropModalProps = {
  open: boolean;
  /** Object-URL of the image to crop */
  imageUrl: string;
  /** Original File — used as fallback name and returned on canvas failure */
  originalFile: File;
  onClose: () => void;
  /** Called with the cropped + resized JPEG File when the user confirms */
  onConfirm: (file: File) => void;
};

export function ImageCropModal({
  open,
  imageUrl,
  originalFile,
  onClose,
  onConfirm,
}: ImageCropModalProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef  = useRef<HTMLImageElement>(null);

  /**
   * Where the image is actually rendered inside the wrap container,
   * expressed as fractions of the container dimensions.
   * Accounts for letterboxing when image aspect ≠ 4:3.
   */
  const [imgBounds, setImgBounds] = useState({ x: 0, y: 0, w: 1, h: 1 });

  /** Crop rectangle as fractions of the *image* (not the container) */
  const [crop, setCrop]     = useState<CropRect>({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
  const [sizeKey, setSizeKey]   = useState<string>('medium');
  const [processing, setProcessing] = useState(false);

  const dragRef = useRef<{
    handle: HandleId;
    startPx: number; startPy: number;  // pointer at drag-start (container fractions)
    startCrop: CropRect;
  } | null>(null);

  // ── compute image display bounds ───────────────────────────────────────────
  const recalcBounds = useCallback(() => {
    const wrap = wrapRef.current;
    const img  = imgRef.current;
    if (!wrap || !img || !img.naturalWidth) return;
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    const iw = img.naturalWidth,  ih = img.naturalHeight;
    const scale = Math.min(cw / iw, ch / ih);
    const rw = iw * scale, rh = ih * scale;
    setImgBounds({
      x: (cw - rw) / 2 / cw,
      y: (ch - rh) / 2 / ch,
      w: rw / cw,
      h: rh / ch,
    });
  }, []);

  // Reset to defaults every time the modal opens
  useEffect(() => {
    if (open) {
      setCrop({ x: 0.05, y: 0.05, w: 0.90, h: 0.90 });
      setSizeKey('medium');
      setProcessing(false);
    }
  }, [open]);

  useEffect(() => {
    recalcBounds();
    window.addEventListener('resize', recalcBounds);
    return () => window.removeEventListener('resize', recalcBounds);
  }, [recalcBounds, open]);

  // ── drag: start ────────────────────────────────────────────────────────────
  const startDrag = useCallback(
    (handle: HandleId, e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const wrap = wrapRef.current;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const src  = 'touches' in e.nativeEvent
        ? (e.nativeEvent as TouchEvent).touches[0]
        : (e.nativeEvent as MouseEvent);
      dragRef.current = {
        handle,
        startPx: (src.clientX - rect.left) / rect.width,
        startPy: (src.clientY - rect.top)  / rect.height,
        startCrop: { ...crop },
      };
    },
    [crop],
  );

  // ── drag: move & end (window-level listeners) ──────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragRef.current || !wrapRef.current) return;
      e.preventDefault();
      const rect = wrapRef.current.getBoundingClientRect();
      const { cx, cy } = pointerClientXY(e);
      // Delta in container fractions → convert to image fractions
      const dx = ((cx - rect.left) / rect.width  - dragRef.current.startPx) / imgBounds.w;
      const dy = ((cy - rect.top)  / rect.height - dragRef.current.startPy) / imgBounds.h;
      const { handle, startCrop: b } = dragRef.current;

      setCrop(() => {
        let { x, y, w, h } = b;
        switch (handle) {
          case 'move':
            x = clamp(b.x + dx, 0, 1 - b.w);
            y = clamp(b.y + dy, 0, 1 - b.h);
            break;
          case 'nw': {
            const dd = clamp(dx, -b.x, b.w - MIN_FRAC);
            const de = clamp(dy, -b.y, b.h - MIN_FRAC);
            x = b.x + dd; w = b.w - dd; y = b.y + de; h = b.h - de; break;
          }
          case 'n': {
            const de = clamp(dy, -b.y, b.h - MIN_FRAC);
            y = b.y + de; h = b.h - de; break;
          }
          case 'ne': {
            const de = clamp(dy, -b.y, b.h - MIN_FRAC);
            y = b.y + de; h = b.h - de; w = clamp(b.w + dx, MIN_FRAC, 1 - b.x); break;
          }
          case 'e': w = clamp(b.w + dx, MIN_FRAC, 1 - b.x); break;
          case 'se':
            w = clamp(b.w + dx, MIN_FRAC, 1 - b.x);
            h = clamp(b.h + dy, MIN_FRAC, 1 - b.y); break;
          case 's': h = clamp(b.h + dy, MIN_FRAC, 1 - b.y); break;
          case 'sw': {
            const dd = clamp(dx, -b.x, b.w - MIN_FRAC);
            x = b.x + dd; w = b.w - dd; h = clamp(b.h + dy, MIN_FRAC, 1 - b.y); break;
          }
          case 'w': {
            const dd = clamp(dx, -b.x, b.w - MIN_FRAC);
            x = b.x + dd; w = b.w - dd; break;
          }
        }
        return { x, y, w, h };
      });
    };

    const onUp = () => { dragRef.current = null; };

    window.addEventListener('mousemove', onMove, { passive: false });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchend',  onUp);
    };
  }, [imgBounds]);

  // ── apply crop + resize ────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (processing) return;
    setProcessing(true);
    try {
      const img = imgRef.current;
      if (!img) { onClose(); return; }

      const nw = img.naturalWidth, nh = img.naturalHeight;
      const srcX = Math.round(crop.x * nw);
      const srcY = Math.round(crop.y * nh);
      const srcW = Math.round(crop.w * nw);
      const srcH = Math.round(crop.h * nh);

      const preset = SIZE_OPTIONS.find((o) => o.key === sizeKey) ?? SIZE_OPTIONS[1];
      let outW = srcW, outH = srcH;
      if (outW > preset.maxDim || outH > preset.maxDim) {
        if (outW > outH) { outH = Math.round((outH * preset.maxDim) / outW); outW = preset.maxDim; }
        else              { outW = Math.round((outW * preset.maxDim) / outH); outH = preset.maxDim; }
      }

      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, outW);
      canvas.height = Math.max(1, outH);
      canvas.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', preset.quality),
      );

      if (!blob) {
        onConfirm(originalFile);
        onClose();
        return;
      }

      const baseName = originalFile.name.replace(/\.[^.]+$/, '');
      onConfirm(new File([blob], `${baseName}_crop.jpg`, { type: 'image/jpeg' }));
      onClose();
    } finally {
      setProcessing(false);
    }
  }, [processing, crop, sizeKey, originalFile, onConfirm, onClose]);

  // ── crop box in container-fraction coordinates (for CSS positioning) ────────
  const oc = {
    x: imgBounds.x + crop.x * imgBounds.w,
    y: imgBounds.y + crop.y * imgBounds.h,
    w: crop.w * imgBounds.w,
    h: crop.h * imgBounds.h,
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
            <Crop className="h-4 w-4" />
            Crop &amp; Resize Image
          </DialogTitle>
        </DialogHeader>

        {/* ── interactive crop canvas ──────────────────────────────────────── */}
        <div
          ref={wrapRef}
          className="relative bg-black select-none overflow-hidden touch-none"
          style={{ aspectRatio: '4/3' }}
        >
          {/* source image — rendered at its natural fit inside the container */}
          <img
            ref={imgRef}
            src={imageUrl}
            alt="Crop source"
            className="absolute pointer-events-none"
            style={{
              left:   pct(imgBounds.x),
              top:    pct(imgBounds.y),
              width:  pct(imgBounds.w),
              height: pct(imgBounds.h),
            }}
            draggable={false}
            onLoad={recalcBounds}
          />

          {/* dark mask — four pieces surrounding the crop box */}
          {/* top */}
          <div className="absolute inset-x-0 top-0 bg-black/60 pointer-events-none"
            style={{ height: pct(oc.y) }} />
          {/* bottom */}
          <div className="absolute inset-x-0 bottom-0 bg-black/60 pointer-events-none"
            style={{ height: pct(1 - oc.y - oc.h) }} />
          {/* left */}
          <div className="absolute bg-black/60 pointer-events-none"
            style={{ left: 0, top: pct(oc.y), width: pct(oc.x), height: pct(oc.h) }} />
          {/* right */}
          <div className="absolute bg-black/60 pointer-events-none"
            style={{ right: 0, top: pct(oc.y), width: pct(1 - oc.x - oc.w), height: pct(oc.h) }} />

          {/* crop box — draggable to move */}
          <div
            className="absolute border-2 border-white box-border cursor-move"
            style={{
              left:   pct(oc.x),
              top:    pct(oc.y),
              width:  pct(oc.w),
              height: pct(oc.h),
            }}
            onMouseDown={(e) => startDrag('move', e)}
            onTouchStart={(e) => startDrag('move', e)}
          >
            {/* rule-of-thirds grid */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <div className="absolute top-0 bottom-0 border-l border-white/30" style={{ left: '33.33%' }} />
              <div className="absolute top-0 bottom-0 border-l border-white/30" style={{ left: '66.66%' }} />
              <div className="absolute left-0 right-0 border-t border-white/30" style={{ top: '33.33%' }} />
              <div className="absolute left-0 right-0 border-t border-white/30" style={{ top: '66.66%' }} />
            </div>

            {/* corner accent brackets */}
            <div className="absolute top-0    left-0  w-5 h-5 border-t-2 border-l-2 border-sky-400 pointer-events-none" />
            <div className="absolute top-0    right-0 w-5 h-5 border-t-2 border-r-2 border-sky-400 pointer-events-none" />
            <div className="absolute bottom-0 left-0  w-5 h-5 border-b-2 border-l-2 border-sky-400 pointer-events-none" />
            <div className="absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-sky-400 pointer-events-none" />

            {/* 8 resize handles */}
            {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map((h) => (
              <CropHandle key={h} id={h} onStart={(e) => startDrag(h, e)} />
            ))}
          </div>
        </div>

        {/* ── output size selector ─────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-sidebar-accent">
            <Minimize2 className="h-3.5 w-3.5" />
            Output Size
          </div>
          <div className="flex gap-2 flex-wrap">
            {SIZE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSizeKey(opt.key)}
                className={cn(
                  'flex flex-col items-center px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors min-w-[62px]',
                  sizeKey === opt.key
                    ? 'bg-primary text-white border-primary shadow-sm'
                    : 'bg-white text-sidebar-accent border-primary/20 hover:border-primary',
                )}
              >
                <span>{opt.label}</span>
                <span
                  className={cn(
                    'text-[10px] font-normal mt-0.5',
                    sizeKey === opt.key ? 'text-green-100' : 'text-slate-400',
                  )}
                >
                  {opt.sub}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ── action buttons ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 border-t bg-background px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={processing}>
            <X className="mr-1 h-4 w-4" />
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={processing}
            className="bg-green-600 text-white hover:bg-green-700"
          >
            {processing ? (
              <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Processing…</>
            ) : (
              <><Check className="mr-1 h-4 w-4" />Apply &amp; Use</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
