'use client';

import { useRef, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, RotateCcw, Upload } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

// Single, org-wide signature — not per-employee. Uploading here replaces the
// image embedded in every HR document that carries an authorised-signatory
// signature (currently: the Employee ID Card back side, and the Confirmation/
// Promotion/Relieving letters) for all 300+ employees at once, since every
// one of those reads the same GET /api/branding/asset/authorised-signatory
// endpoint / ThemePreset.authorisedSignatoryKey column rather than storing
// its own copy.
export function SignatureUploadDialog({ open, onOpenChange }: Props) {
    const { toast } = useToast();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewBust, setPreviewBust] = useState(() => Date.now());
    const [isSaving, setIsSaving] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);

    const resetPending = () => {
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingFile(null);
        setPendingPreviewUrl(null);
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) resetPending();
        onOpenChange(next);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast({ title: 'Error', description: 'Only image files are accepted.', variant: 'destructive' });
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast({ title: 'Error', description: 'Image must be under 5MB.', variant: 'destructive' });
            return;
        }
        if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
        setPendingFile(file);
        setPendingPreviewUrl(URL.createObjectURL(file));
    };

    const handleSave = async () => {
        if (!pendingFile) return;
        setIsSaving(true);
        try {
            const formData = new FormData();
            formData.append('image', pendingFile);
            const res = await apiClient.post('/hr/signature', formData);
            if (!res.success) throw new Error(res.error || 'Failed to upload signature');
            toast({
                title: 'Signature updated',
                description: 'Applied to the ID card and all HR letters for every employee.',
            });
            resetPending();
            setPreviewBust(Date.now());
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to upload signature.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = async () => {
        setIsSaving(true);
        try {
            const res = await apiClient.delete('/hr/signature');
            if (!res.success) throw new Error(res.error || 'Failed to reset signature');
            toast({ title: 'Signature reset', description: 'Reverted to the default signature.' });
            resetPending();
            setPreviewBust(Date.now());
        } catch (error: any) {
            toast({ title: 'Error', description: error.message || 'Failed to reset signature.', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Authorised Signatory Signature</DialogTitle>
                    <DialogDescription>
                        One signature, shared org-wide — updating it here applies immediately to the
                        Employee ID Card and every Confirmation, Promotion, and Relieving letter, for
                        all employees. No per-employee changes needed.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col items-center gap-4 py-2">
                    <div className="flex h-28 w-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={pendingPreviewUrl || `/api/branding/asset/authorised-signatory?v=${previewBust}`}
                            alt="Current authorised signatory signature"
                            className="max-h-full max-w-full object-contain"
                        />
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={handleFileChange}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSaving}
                        className="gap-2 w-full"
                    >
                        <Upload className="h-4 w-4" />
                        {pendingFile ? 'Choose a Different File' : 'Choose New Signature Image'}
                    </Button>
                    {pendingFile && (
                        <p className="text-xs text-slate-500 -mt-1 w-full truncate">Selected: {pendingFile.name}</p>
                    )}
                </div>

                <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        onClick={handleReset}
                        disabled={isSaving}
                        className="gap-2 text-slate-600 dark:text-slate-400"
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset to Default
                    </Button>
                    <Button type="button" onClick={handleSave} disabled={isSaving || !pendingFile} className="gap-2">
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {isSaving ? 'Saving...' : 'Save Signature'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
