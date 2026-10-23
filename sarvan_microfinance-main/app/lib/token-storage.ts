/**
 * Token Storage Utility
 * Handles storing and retrieving authentication tokens from localStorage
 */

const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';
const USER_KEY = 'user';

export interface StoredUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  branchId?: string | null;
  /**
   * All branch IDs this user is assigned to (AREA_MANAGER via AreaManagerBranch,
   * every other role via UserBranchAssignment). Absent or empty = single-branch
   * user (just `branchId`), not "no access". Use to decide whether to show a
   * branch picker at all — a user with 0 or 1 entries here has nothing to pick.
   */
  assignedBranchIds?: string[];
  /** Active RBAC role slug — e.g. 'background-verification-team', 'gold-loan-officer' */
  rbacRoleSlug?: string | null;
  /** Human-readable RBAC role name — e.g. 'Background Verification Team'. Use getRoleDisplayName() to display. */
  rbacRoleName?: string | null;
  /** True when the active RBAC role is flagged Role.isSubAdmin — grants final client-approval actions. */
  isSubAdmin?: boolean;
}

/**
 * Decode JWT token without verification (for expiration check)
 */
function decodeToken(token: string): { exp?: number; iat?: number } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Check if token is expired or will expire soon
 * @param token JWT token
 * @param bufferMinutes Minutes before expiration to consider token expired (default: 5)
 */
function isTokenExpiringSoon(token: string, bufferMinutes: number = 5): boolean {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return true; // If we can't decode, assume expired
  }

  const expirationTime = decoded.exp * 1000; // Convert to milliseconds
  const bufferTime = bufferMinutes * 60 * 1000; // Convert buffer to milliseconds
  const now = Date.now();

  return expirationTime - now < bufferTime;
}

export const tokenStorage = {
  /**
   * Save access token to localStorage
   */
  setAccessToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(ACCESS_TOKEN_KEY, token);
    }
  },

  /**
   * Get access token from localStorage
   */
  getAccessToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    }
    return null;
  },

  /**
   * Check if access token is expired or expiring soon
   */
  isAccessTokenExpiringSoon(bufferMinutes: number = 5): boolean {
    const token = this.getAccessToken();
    if (!token) {
      return true;
    }
    return isTokenExpiringSoon(token, bufferMinutes);
  },

  /**
   * Check if access token is expired
   */
  isAccessTokenExpired(): boolean {
    const token = this.getAccessToken();
    if (!token) {
      return true;
    }
    return isTokenExpiringSoon(token, 0);
  },

  /**
   * Save refresh token to localStorage
   */
  setRefreshToken(token: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    }
  },

  /**
   * Get refresh token from localStorage
   */
  getRefreshToken(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    }
    return null;
  },

  /**
   * Check if refresh token is expired
   */
  isRefreshTokenExpired(): boolean {
    const token = this.getRefreshToken();
    if (!token) {
      return true;
    }
    return isTokenExpiringSoon(token, 0);
  },

  /**
   * Check whether refresh token is present and still valid
   */
  hasValidRefreshToken(): boolean {
    const token = this.getRefreshToken();
    return !!token && !this.isRefreshTokenExpired();
  },

  /**
   * Save user data to localStorage
   */
  setUser(user: StoredUser): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    }
  },

  /**
   * Get user data from localStorage
   */
  getUser(): StoredUser | null {
    if (typeof window !== 'undefined') {
      const userStr = localStorage.getItem(USER_KEY);
      if (userStr) {
        try {
          return JSON.parse(userStr) as StoredUser;
        } catch {
          return null;
        }
      }
    }
    return null;
  },

  /**
   * Clear all authentication data
   */
  clear(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  },

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    const token = this.getAccessToken();
    return !!token && !this.isAccessTokenExpired();
  },
};
