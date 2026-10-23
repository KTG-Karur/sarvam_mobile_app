/**
 * Token Refresh Utility
 * Handles automatic token refresh in the background
 */

import { tokenStorage } from './token-storage';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';
const REFRESH_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

let refreshIntervalId: NodeJS.Timeout | null = null;
let isRefreshing = false;

/**
 * Check and refresh token if needed
 */
async function checkAndRefreshToken(): Promise<boolean> {
  // Don't refresh if already refreshing or no valid refresh session
  if (isRefreshing || !tokenStorage.hasValidRefreshToken()) {
    return false;
  }

  // Check if token is expiring soon
  if (!tokenStorage.isAccessTokenExpiringSoon(5)) {
    return false; // Token is still valid
  }

  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken || tokenStorage.isRefreshTokenExpired()) {
    tokenStorage.clear();
    return false;
  }

  isRefreshing = true;

  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ refreshToken }),
    });

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      return false;
    }

    const data = await response.json();

    if (data.success && data.data) {
      tokenStorage.setAccessToken(data.data.accessToken);
      tokenStorage.setRefreshToken(data.data.refreshToken);
      
      if (data.data.user) {
        tokenStorage.setUser(data.data.user);
      }

      return true;
    }
  } catch (error) {
    console.error('Background token refresh failed:', error);
  } finally {
    isRefreshing = false;
  }

  // Refresh failed - clear session to avoid repeated invalid calls
  tokenStorage.clear();
  return false;
}

/**
 * Start automatic token refresh interval
 */
export function startTokenRefreshInterval(): void {
  // Clear existing interval if any
  stopTokenRefreshInterval();

  // Check immediately
  checkAndRefreshToken();

  // Set up interval to check periodically
  refreshIntervalId = setInterval(() => {
    checkAndRefreshToken();
  }, REFRESH_CHECK_INTERVAL);
}

/**
 * Stop automatic token refresh interval
 */
export function stopTokenRefreshInterval(): void {
  if (refreshIntervalId) {
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
  }
}

/**
 * Refresh token manually
 */
export async function refreshTokenManually(): Promise<boolean> {
  return await checkAndRefreshToken();
}
