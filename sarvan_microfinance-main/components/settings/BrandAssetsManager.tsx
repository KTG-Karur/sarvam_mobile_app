'use client';

import { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { Image as ImageIcon, Upload, RotateCcw, Loader2 } from 'lucide-react';

interface BrandAssetSlotProps {
  presetId: string;
  type: 'logo-wordmark' | 'logo-icon' | 'favicon' | 'tamil-logo' | 'payment-qr' | 'page-loader';
  label: string;
  description: string;
  version: number;
  onChanged: () => void;
}

function BrandAssetSlot({ presetId, type, label, description, version, onChanged }: BrandAssetSlotProps) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append('presetId', presetId);
      fd.append('type', type);
      fd.append('image', file);
      const result = await apiClient.post(`/settings/brand/assets`, fd);
      if (result.success) {
        onChanged();
        window.location.reload();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to upload', variant: 'destructive' });
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleReset() {
    setIsResetting(true);
    try {
      const result = await apiClient.delete(`/settings/brand/assets?type=${type}&presetId=${presetId}`);
      if (result.success) {
        onChanged();
        window.location.reload();
      } else {
        toast({ title: 'Error', description: result.error ?? 'Failed to reset', variant: 'destructive' });
      }
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="flex items-center gap-4 py-3 border-b border-border last:border-0">
      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-slate-50 dark:bg-brand-green-darker flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/branding/asset/${type}?presetId=${presetId}&v=${version}`}
          alt={label}
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="gap-2"
        >
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isResetting}
          onClick={handleReset}
          title="Reset to default"
        >
          {isResetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export function BrandAssetsManager({ presetId }: { presetId: string }) {
  const [version, setVersion] = useState(() => Date.now());

  return (
    <Card className="border-primary/20 dark:border-sidebar-accent">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-2">
          <ImageIcon className="h-4 w-4 text-primary" />
          <p className="text-xs font-bold uppercase tracking-widest text-sidebar-accent dark:text-primary">
            Logo &amp; Favicon
          </p>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          These images replace the app logo everywhere it appears — sidebar, login page, browser
          tab, and every PDF/print report — once this theme is applied.
        </p>
        <BrandAssetSlot
          presetId={presetId}
          type="logo-wordmark"
          label="Logo (wordmark)"
          description="Used in headers, print vouchers, PDF/report headers"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
        <BrandAssetSlot
          presetId={presetId}
          type="logo-icon"
          label="Logo (icon)"
          description="Round sidebar icon"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
        <BrandAssetSlot
          presetId={presetId}
          type="favicon"
          label="Favicon"
          description="Browser tab icon"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
        <BrandAssetSlot
          presetId={presetId}
          type="tamil-logo"
          label="Tamil Logo"
          description="Header logo on the loan passbook PDF and collection receipt print"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
        <BrandAssetSlot
          presetId={presetId}
          type="payment-qr"
          label="Payment QR"
          description="This theme's own UPI/bank QR code, shown on the loan passbook PDF — no fallback, leave blank to omit"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
        <BrandAssetSlot
          presetId={presetId}
          type="page-loader"
          label="Page Loader"
          description="Icon shown while pages load, app-wide"
          version={version}
          onChanged={() => setVersion(Date.now())}
        />
      </CardContent>
    </Card>
  );
}
