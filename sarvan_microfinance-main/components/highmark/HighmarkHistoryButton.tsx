'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';
import { apiClient } from '@/app/lib/api-client';
import { HighmarkFullReportDialog } from './HighmarkFullReportDialog';
import type { HighmarkReportSummary } from './types';

interface HighmarkHistoryButtonProps {
  /** Client cuid or business clientId (e.g. "C000123") — either is accepted. */
  clientId: string;
  clientName: string;
  centerName?: string | null;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

/**
 * Drop-in "view Highmark (CRIF) report" trigger for any screen that already has
 * a client's id/name on hand — jumps straight to the full report view (most
 * recent pull) with a "Recheck" action in its header, instead of an intermediate
 * history list.
 */
export function HighmarkHistoryButton({ clientId, clientName, centerName, variant = 'ghost', size = 'sm', className }: HighmarkHistoryButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [latestReport, setLatestReport] = useState<HighmarkReportSummary | null>(null);

  async function handleOpen(e?: React.MouseEvent) {
    e?.stopPropagation();
    setIsOpen(true);
    setIsLoading(true);
    try {
      const res = await apiClient.get<HighmarkReportSummary[]>(`/highmark/history?clientId=${encodeURIComponent(clientId)}`);
      setLatestReport(res.success && res.data && res.data.length > 0 ? res.data[0] : null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={handleOpen} title="View Highmark Report">
        <ShieldCheck className="h-4 w-4 mr-1" />
        Highmark
      </Button>
      <HighmarkFullReportDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        report={latestReport}
        isLoading={isLoading}
        clientId={clientId}
        clientName={clientName}
        centerName={centerName}
        onRechecked={setLatestReport}
      />
    </>
  );
}
