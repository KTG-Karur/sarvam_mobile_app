// hooks/useEodWorkingDate.ts
import { useState, useEffect } from 'react';

interface EodStatusResponse {
  workingDateYmd: string | null;
  eodCompletedForToday: boolean;
  branchLockedForEod: boolean;
}

/**
 * `branchId` (optional): scope the working-date lookup to a specific branch instead of the
 * caller's session-active branch — needed by pages with their own local branch selector (e.g.
 * an ADMIN/AREA_MANAGER switching branch via a page-local dropdown), so the working date tracks
 * that selection instead of staying pinned to whatever branch was active at mount. Omit for the
 * old session-branch behavior.
 */
export function useEodWorkingDate(branchId?: string) {
  const [eodWorkingDate, setEodWorkingDate] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEodWorkingDate = async () => {
      try {
        setIsLoading(true);
        const url = branchId
          ? `/api/utilities/eod-process?branchId=${branchId}`
          : '/api/utilities/eod-process';
        const response = await fetch(url);
        
        if (response.status === 423) {
          // Branch locked
          setEodWorkingDate(null);
          setError('Branch is locked');
          return;
        }
        
        if (!response.ok) {
          throw new Error('Failed to fetch EOD status');
        }
        
        const data = await response.json();
        const payload = data?.data ?? data;
        
        // Extract workingDateYmd from the response
        if (payload.workingDateYmd && /^\d{4}-\d{2}-\d{2}$/.test(payload.workingDateYmd)) {
          setEodWorkingDate(payload.workingDateYmd);
        } else {
          setEodWorkingDate(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        setEodWorkingDate(null);
      } finally {
        setIsLoading(false);
      }
    };

    fetchEodWorkingDate();
  }, [branchId]);

  return { eodWorkingDate, isLoading, error };
}