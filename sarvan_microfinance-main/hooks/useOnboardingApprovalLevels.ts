'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/app/lib/api-client';
import { hasReportingHierarchy } from '@/app/lib/hr/reporting-hierarchy';

/**
 * Whether the hr-onboarding approval chain (Approval Settings) has more than
 * one level — i.e. whether Reporting Manager L1/L2/L3 fields should exist at
 * all. `showReportingManagers` stays false until the answer arrives (and if
 * the request fails), so those fields never flash in for a single-stage chain.
 */
export function useOnboardingApprovalLevels() {
  const [stageCount, setStageCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ stageCount: number }>('/hr/onboarding/approval-levels')
      .then((res) => {
        if (!cancelled && res.success && res.data) setStageCount(res.data.stageCount);
      })
      .catch(() => { /* leave null — fields stay hidden */ });
    return () => { cancelled = true; };
  }, []);

  return { stageCount, showReportingManagers: hasReportingHierarchy(stageCount) };
}
