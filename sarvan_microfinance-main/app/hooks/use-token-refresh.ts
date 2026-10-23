'use client';

import { useEffect } from 'react';
import { startTokenRefreshInterval, stopTokenRefreshInterval } from '@/app/lib/token-refresh';
import { tokenStorage } from '@/app/lib/token-storage';

/**
 * React hook for automatic token refresh
 * Starts background token refresh when component mounts
 * Stops when component unmounts or user logs out
 */
export function useTokenRefresh() {
  useEffect(() => {
    const syncRefreshLifecycle = () => {
      if (tokenStorage.hasValidRefreshToken()) {
        startTokenRefreshInterval();
      } else {
        stopTokenRefreshInterval();
      }
    };

    // Initial sync on mount
    syncRefreshLifecycle();

    // Keep lifecycle correct across tab/session events
    window.addEventListener('storage', syncRefreshLifecycle);
    window.addEventListener('focus', syncRefreshLifecycle);
    document.addEventListener('visibilitychange', syncRefreshLifecycle);

    return () => {
      window.removeEventListener('storage', syncRefreshLifecycle);
      window.removeEventListener('focus', syncRefreshLifecycle);
      document.removeEventListener('visibilitychange', syncRefreshLifecycle);
      stopTokenRefreshInterval();
    };
  }, []);
}
