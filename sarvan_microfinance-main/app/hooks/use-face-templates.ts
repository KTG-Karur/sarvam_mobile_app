'use client';

import { useState, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { apiClient } from '@/app/lib/api-client';

export interface FaceTemplateSummary {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  role: string;
  branchName: string | null;
  branchCode: string | null;
  trained: boolean;
  qualityScore: number | null;
  livenessVerified: boolean | null;
  photoKey: string | null;
  capturedAt: string | null;
}

export interface FaceVerificationLog {
  id: string;
  type: string;
  matched: boolean;
  scorePercent: number;
  createdAt: string;
}

export interface FaceTemplateDetail {
  id: string;
  employeeId: string | null;
  firstName: string;
  lastName: string;
  role: string;
  branchName: string | null;
  trained: boolean;
  qualityScore: number | null;
  livenessVerified: boolean | null;
  capturedAt: string | null;
  photoUrl: string | null;
  recentLogs: FaceVerificationLog[];
}

export function useFaceTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<FaceTemplateSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<FaceTemplateDetail | null>(null);

  const fetchTemplates = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await apiClient.get<FaceTemplateSummary[]>('/admin/face-templates');
      if (result.success && result.data) {
        setTemplates(result.data);
        return result.data;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to fetch trained faces',
        variant: 'destructive',
      });
      return [];
    } catch {
      toast({
        title: 'Error',
        description: 'Network error. Please try again.',
        variant: 'destructive',
      });
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchDetail = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      const result = await apiClient.get<FaceTemplateDetail>(`/admin/face-templates/${userId}`);
      if (result.success && result.data) {
        setSelected(result.data);
        return result.data;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to load employee details',
        variant: 'destructive',
      });
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const revokeTemplate = useCallback(async (userId: string) => {
    setIsLoading(true);
    try {
      const result = await apiClient.delete<null>(`/admin/face-templates/${userId}`);
      if (result.success) {
        toast({ title: 'Revoked', description: 'Employee must re-register their face.' });
        return true;
      }
      toast({
        title: 'Error',
        description: result.error || 'Failed to revoke face enrollment',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  return {
    templates,
    isLoading,
    selected,
    setSelected,
    fetchTemplates,
    fetchDetail,
    revokeTemplate,
  };
}
