'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { PageLoader } from '@/components/ui/page-loader';
import { RotateCcw, ScanFace } from 'lucide-react';
import { useFaceTemplates } from '@/app/hooks/use-face-templates';
import { toDisplayDateTime } from '@/app/lib/date-format';

interface TrainedFaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; firstName: string; lastName: string } | null;
  /** Called after the admin revokes the enrollment, so the caller can refresh its own list. */
  onRevoked?: () => void;
}

/**
 * Shows one employee's trained-face status: photo, quality score, and recent
 * punch verification attempts, with a revoke action. Shared between the
 * standalone "Trained Faces" admin page and the per-employee actions
 * dropdown on the User Management page.
 */
export function TrainedFaceModal({ open, onOpenChange, user, onRevoked }: TrainedFaceModalProps) {
  const { selected, setSelected, isLoading, fetchDetail, revokeTemplate } = useFaceTemplates();
  const [revokeConfirmOpen, setRevokeConfirmOpen] = useState(false);

  useEffect(() => {
    if (open && user) {
      fetchDetail(user.id);
    } else if (!open) {
      setSelected(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user?.id]);

  const confirmRevoke = async () => {
    if (!user) return;
    const ok = await revokeTemplate(user.id);
    setRevokeConfirmOpen(false);
    if (ok) {
      onOpenChange(false);
      onRevoked?.();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanFace className="h-5 w-5" />
              {user ? `${user.firstName} ${user.lastName} — Trained Face` : 'Trained Face'}
            </DialogTitle>
          </DialogHeader>
          {isLoading || !selected ? (
            <PageLoader fullScreen={false} />
          ) : !selected.trained ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              This employee has not registered their face biometric yet.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-20 w-20">
                  <AvatarImage src={selected.photoUrl ?? undefined} />
                  <AvatarFallback className="text-lg">
                    {selected.firstName[0]}
                    {selected.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div className="text-sm space-y-1">
                  <p><span className="text-muted-foreground">Employee ID:</span> {selected.employeeId ?? '—'}</p>
                  <p><span className="text-muted-foreground">Branch:</span> {selected.branchName ?? '—'}</p>
                  <p><span className="text-muted-foreground">Quality:</span> {selected.qualityScore != null ? `${selected.qualityScore.toFixed(0)}%` : '—'}</p>
                  <p><span className="text-muted-foreground">Captured:</span> {selected.capturedAt ? toDisplayDateTime(new Date(selected.capturedAt)) : '—'}</p>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">Recent punch attempts</h4>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {selected.recentLogs.length === 0 && (
                    <p className="text-sm text-muted-foreground">No verification attempts yet.</p>
                  )}
                  {selected.recentLogs.map((log) => (
                    <div key={log.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                      <span>{log.type === 'PUNCH_IN' ? 'Punch In' : 'Punch Out'}</span>
                      <span className={log.matched ? 'text-green-700' : 'text-red-600'}>
                        {log.matched ? 'Matched' : 'Rejected'} ({log.scorePercent.toFixed(0)}%)
                      </span>
                      <span className="text-muted-foreground">
                        {toDisplayDateTime(new Date(log.createdAt))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <Button variant="destructive" size="sm" onClick={() => setRevokeConfirmOpen(true)}>
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Revoke & Require Re-registration
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={revokeConfirmOpen}
        onOpenChange={setRevokeConfirmOpen}
        onConfirm={confirmRevoke}
        title="Revoke face enrollment?"
        description={`${user ? `${user.firstName} ${user.lastName}` : 'This employee'} will need to complete face registration again before their next punch in/out.`}
        confirmText="Revoke"
        type="delete"
        isLoading={isLoading}
      />
    </>
  );
}
