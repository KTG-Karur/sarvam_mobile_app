'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RefreshCw, Loader2 } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import type { HighmarkReportSummary } from './types';

interface RecheckCreditButtonProps {
  /** Client cuid or business clientId (e.g. "C000123") — either is accepted. */
  clientId: string;
  clientName: string;
  onRechecked?: (report: HighmarkReportSummary) => void;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

/**
 * Drop-in "recheck Highmark" trigger for any screen that already shows a client's
 * existing Highmark history. Goes through the same freshness-window reuse as any
 * other check (Masters > Highmark Settings) — if the last report for this client
 * is still within that window it's reused as-is; otherwise a new one is pulled.
 */
export function RecheckCreditButton({ clientId, clientName, onRechecked, variant = 'outline', size = 'sm', className }: RecheckCreditButtonProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [consent, setConsent] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  function handleOpenChange(open: boolean) {
    if (isRunning) return;
    setIsOpen(open);
    if (!open) setConsent(false);
  }

  async function handleConfirm() {
    setIsRunning(true);
    try {
      const res = await apiClient.post<HighmarkReportSummary>('/highmark/recheck', {
        clientId,
        consentObtained: true,
      });
      if (res.success && res.data) {
        toast({ title: 'Highmark checked', description: res.message || `Updated report for ${clientName}.` });
        onRechecked?.(res.data);
        setIsOpen(false);
        setConsent(false);
      } else {
        toast({ title: 'Could not recheck', description: res.error, variant: 'destructive' });
      }
    } catch (error: any) {
      toast({ title: 'Could not recheck', description: error.message, variant: 'destructive' });
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setIsOpen(true)} title="Recheck Highmark">
        <RefreshCw className="h-4 w-4 mr-1" />
        Recheck
      </Button>

      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Recheck Highmark for {clientName}?</DialogTitle>
            <DialogDescription>
              Do you want to recheck the Highmark credit report for this client?
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-start gap-2 py-2">
            <Checkbox id="recheck-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
            <Label htmlFor="recheck-consent" className="text-sm font-normal leading-snug">
              The client has given explicit consent for this Highmark check to be run.
            </Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isRunning}>
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirm} disabled={!consent || isRunning}>
              {isRunning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Yes, recheck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
