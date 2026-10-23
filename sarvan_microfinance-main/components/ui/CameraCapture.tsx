'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Camera, X, RefreshCw, Check, FlipHorizontal, Loader2, Crop, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { ImageCropModal } from '@/components/ui/ImageCropModal';

const CAPTURE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const CAPTURE_MAX_DIM = 2048;

function compressCanvas(canvas: HTMLCanvasElement): Promise<File> {
    return new Promise((resolve) => {
        let quality = 0.85;
        const compress = () => {
            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        resolve(new File([], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }));
                        return;
                    }
                    if (blob.size <= CAPTURE_MAX_BYTES || quality <= 0.1) {
                        resolve(new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }));
                    } else {
                        quality = Math.max(0.1, quality - 0.1);
                        compress();
                    }
                },
                'image/jpeg',
                quality,
            );
        };
        compress();
    });
}

function drawToCanvas(source: CanvasImageSource, sourceW: number, sourceH: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    let w = sourceW || 1280;
    let h = sourceH || 720;

    if (w > CAPTURE_MAX_DIM || h > CAPTURE_MAX_DIM) {
        if (w > h) { h = Math.round((h * CAPTURE_MAX_DIM) / w); w = CAPTURE_MAX_DIM; }
        else { w = Math.round((w * CAPTURE_MAX_DIM) / h); h = CAPTURE_MAX_DIM; }
    }

    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
    return canvas;
}

async function captureFrame(video: HTMLVideoElement): Promise<File> {
    const canvas = drawToCanvas(video, video.videoWidth, video.videoHeight);
    return compressCanvas(canvas);
}

/** Downscale + re-compress a gallery-picked image so uploads match camera-captured photos. */
async function compressUploadedFile(file: File): Promise<File> {
    const objectUrl = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = objectUrl;
        });
        const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight);
        return await compressCanvas(canvas);
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

type CameraCaptureProps = {
    open: boolean;
    onClose: () => void;
    /** Called with the compressed JPEG File when user confirms the photo */
    onCapture: (file: File) => void;
    /** Optional label shown in the dialog title */
    label?: string;
};

export function CameraCapture({ open, onClose, onCapture, label }: CameraCaptureProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [capturedFile, setCapturedFile] = useState<File | null>(null);
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
    const [cropOpen, setCropOpen] = useState(false);
    const [source, setSource] = useState<'camera' | 'upload'>('camera');

    const stopStream = useCallback(() => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
    }, []);

    const startCamera = useCallback(
        async (facing: 'environment' | 'user') => {
            stopStream();
            setCameraError(null);

            const dims = { width: { ideal: 1920 }, height: { ideal: 1080 } };
            // Try an exact match first — on phones with multiple cameras, an
            // `ideal` facingMode constraint is sometimes ignored and the browser
            // just picks its default (front) camera. Exact forces the requested
            // (usually back) camera when the device actually has one; if it
            // doesn't (e.g. a laptop webcam), fall back to `ideal`, then to
            // whatever camera is available at all.
            const attempts: MediaStreamConstraints[] = [
                { video: { facingMode: { exact: facing }, ...dims }, audio: false },
                { video: { facingMode: { ideal: facing }, ...dims }, audio: false },
                { video: dims, audio: false },
            ];

            for (const constraints of attempts) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia(constraints);
                    streamRef.current = stream;
                    if (videoRef.current) {
                        videoRef.current.srcObject = stream;
                    }
                    return;
                } catch {
                    // try the next, less strict constraint
                }
            }

            setCameraError(
                'Camera access denied or not available. Please allow camera permission in your browser, or use the file upload option.',
            );
        },
        [stopStream],
    );

    // Start camera when dialog opens; clean up when it closes or unmounts
    useEffect(() => {
        if (open) {
            startCamera(facingMode);
        }
        return () => stopStream();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Revoke object URL on unmount
    useEffect(() => {
        return () => {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const handleCapture = async () => {
        if (!videoRef.current || isProcessing) return;
        setIsProcessing(true);
        try {
            const file = await captureFrame(videoRef.current);
            stopStream();
            setSource('camera');
            setPreviewUrl(URL.createObjectURL(file));
            setCapturedFile(file);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRetake = () => {
        if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
        setCapturedFile(null);
        // Restart the camera regardless of source, so both options are live again —
        // if the source was an upload, also reopen the file picker for convenience.
        startCamera(facingMode);
        if (source === 'upload') {
            fileInputRef.current?.click();
        }
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;
        setIsProcessing(true);
        try {
            stopStream();
            const compressed = await compressUploadedFile(file);
            setSource('upload');
            setPreviewUrl(URL.createObjectURL(compressed));
            setCapturedFile(compressed);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFlip = () => {
        const next: 'environment' | 'user' = facingMode === 'environment' ? 'user' : 'environment';
        setFacingMode(next);
        startCamera(next);
    };

    const handleUse = () => {
        if (!capturedFile) return;
        onCapture(capturedFile);
        handleClose();
    };

    const handleClose = () => {
        if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
        setCapturedFile(null);
        setCameraError(null);
        setIsProcessing(false);
        setCropOpen(false);
        stopStream();
        onClose();
    };

    return (
        <>
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
            <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-2">
                    <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                        <Camera className="h-4 w-4" />
                        {label ? `Take Photo — ${label}` : 'Take Photo'}
                    </DialogTitle>
                </DialogHeader>

                {/* Camera / Preview */}
                <div className="relative bg-black w-full" style={{ aspectRatio: '4/3' }}>
                    {previewUrl ? (
                        <img
                            src={previewUrl}
                            alt="Captured photo preview"
                            className="w-full h-full object-contain"
                        />
                    ) : (
                        <video
                            ref={videoRef}
                            className="w-full h-full object-cover"
                            playsInline
                            muted
                            autoPlay
                        />
                    )}

                    {cameraError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/90 px-6 text-center text-xs leading-relaxed text-white">
                            {cameraError}
                        </div>
                    )}

                    {isProcessing && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                            <Loader2 className="h-10 w-10 animate-spin text-white" />
                        </div>
                    )}
                </div>

                {/* Controls */}
                <div className="flex items-center justify-between gap-2 border-t bg-background px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={handleClose}>
                        <X className="mr-1 h-4 w-4" />
                        Cancel
                    </Button>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileSelected}
                    />

                    {previewUrl ? (
                        <div className="flex gap-2 flex-wrap justify-end">
                            <Button variant="outline" size="sm" onClick={handleRetake}>
                                <RefreshCw className="mr-1 h-4 w-4" />
                                {source === 'upload' ? 'Choose Again' : 'Retake'}
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setCropOpen(true)}
                                className="border-sky-400 text-sky-700 hover:bg-sky-50"
                            >
                                <Crop className="mr-1 h-4 w-4" />
                                Crop &amp; Resize
                            </Button>
                            <Button
                                size="sm"
                                onClick={handleUse}
                                className="bg-green-600 text-white hover:bg-green-700"
                            >
                                <Check className="mr-1 h-4 w-4" />
                                Use Photo
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={isProcessing}
                            >
                                <Upload className="mr-1 h-4 w-4" />
                                Upload
                            </Button>
                            {!cameraError && (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-9 w-9"
                                    onClick={handleFlip}
                                    title={facingMode === 'environment' ? 'Switch to front camera' : 'Switch to back camera'}
                                >
                                    <FlipHorizontal className="h-4 w-4" />
                                </Button>
                            )}
                            <Button
                                size="sm"
                                onClick={handleCapture}
                                disabled={isProcessing || !!cameraError}
                                className="bg-primary text-white hover:bg-primary"
                            >
                                <Camera className="mr-1 h-4 w-4" />
                                Capture
                            </Button>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>

        {/* Crop & Resize modal — opens after a photo is captured */}
        {capturedFile && previewUrl && (
            <ImageCropModal
                open={cropOpen}
                imageUrl={previewUrl}
                originalFile={capturedFile}
                onClose={() => setCropOpen(false)}
                onConfirm={(croppedFile) => {
                    onCapture(croppedFile);
                    handleClose();
                }}
            />
        )}
        </>
    );
}
