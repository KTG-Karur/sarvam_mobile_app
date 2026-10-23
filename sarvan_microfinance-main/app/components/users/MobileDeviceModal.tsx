'use client';

import { useState, useEffect, useCallback } from 'react';
import { Smartphone, Loader2, ShieldAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';

interface MobileDeviceInfo {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  mobileDeviceId: string | null;
}

interface MobileDeviceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  userName: string;
  employeeId: string;
}

export function MobileDeviceModal({
  open,
  onOpenChange,
  userId,
  userName,
  employeeId,
}: MobileDeviceModalProps) {
  const { toast } = useToast();
  const [deviceInfo, setDeviceInfo] = useState<MobileDeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const fetchDeviceInfo = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<MobileDeviceInfo>(`/users/${userId}/mobile-device`);
      if (res.success && res.data) {
        setDeviceInfo(res.data);
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to load device info', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  }, [userId, toast]);

  useEffect(() => {
    if (open && userId) {
      fetchDeviceInfo();
    }
  }, [open, userId, fetchDeviceInfo]);

  useEffect(() => {
    if (!open) {
      setShowConfirm(false);
      setDeviceInfo(null);
    }
  }, [open]);

  const handleRemoveDevice = async () => {
    setShowConfirm(false);
    setIsRemoving(true);
    try {
      const res = await apiClient.delete(`/users/${userId}/mobile-device`);
      if (res.success) {
        toast({ title: 'Device Removed', description: 'The employee can register a new device on their next mobile login.' });
        await fetchDeviceInfo();
      } else {
        toast({ title: 'Error', description: res.error || 'Failed to remove device', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Network error', variant: 'destructive' });
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <>
      {/* Remove confirmation dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <ShieldAlert className="h-5 w-5" />
              Remove Registered Device?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm mt-1">
                <p className="text-sidebar-accent dark:text-slate-300">
                  Are you sure you want to remove this employee&apos;s registered mobile device?
                </p>
                <p className="text-sidebar-accent dark:text-slate-300">
                  After removing it, the employee can register a new device during the next mobile login.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={isRemoving}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleRemoveDevice}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Removing...
                </>
              ) : (
                'Remove Device'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Smartphone className="h-5 w-5 text-primary" />
              Mobile Device
            </DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-sidebar-accent dark:text-slate-200">{userName}</span>
              {employeeId ? ` (${employeeId})` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : deviceInfo?.mobileDeviceId ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-primary/20 bg-white px-4 py-3 shadow-sm dark:border-sidebar-accent dark:bg-brand-green-darker">
                  <p className="text-xs text-slate-500">Registered Mobile Device ID</p>
                  <p className="text-sm font-mono font-semibold text-sidebar-accent dark:text-slate-100 break-all">
                    {deviceInfo.mobileDeviceId}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                  onClick={() => setShowConfirm(true)}
                  disabled={isRemoving}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Device
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-primary/20 py-8 text-center dark:border-sidebar-accent">
                <Smartphone className="h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">No device registered</p>
                <p className="text-xs text-slate-400">A device will be bound on the employee&apos;s next mobile login</p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
