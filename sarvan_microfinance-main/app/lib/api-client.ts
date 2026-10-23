/**
 * API Client
 * Handles all API requests with automatic token management and proactive refresh
 */

import { tokenStorage } from './token-storage';
import { branchStorage } from './branch-storage';
import { ApiResponse } from '@/app/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

class ApiClient {
  private refreshPromise: Promise<boolean> | null = null;

  /**
   * Ensure access token is valid before making request
   * Proactively refreshes if token is expiring soon
   */
  private async ensureValidToken(): Promise<boolean> {
    // If token is expiring soon, refresh it proactively
    if (tokenStorage.isAccessTokenExpiringSoon(5)) {
      return await this.refreshToken();
    }
    return true;
  }

  /**
   * Make an authenticated API request
   */
  async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    // Skip token check for auth endpoints
    const isAuthEndpoint = endpoint.startsWith('/auth/');

    if (!isAuthEndpoint) {
      // Ensure token is valid before request
      const tokenReady = await this.ensureValidToken();
      if (!tokenReady) {
        return {
          success: false,
          error: 'Authentication failed. Please login again.',
        } as ApiResponse<T>;
      }
    }

    const token = tokenStorage.getAccessToken();
    const activeBranch = branchStorage.getActiveBranch();

    const headers: Record<string, string> = {};

    // Only set Content-Type if body is not FormData (let browser handle FormData)
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    // Merge with provided headers
    if (options.headers) {
      Object.assign(headers, options.headers);
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Add X-Branch-Id header if an active branch is selected
    if (activeBranch?.id) {
      headers['X-Branch-Id'] = activeBranch.id;
    }

    const normalizedPath = endpoint.startsWith('/api/') ? endpoint.substring(4) : endpoint;

    try {
      const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
        ...options,
        credentials: 'include',
        headers,
      });

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json');

      if (!isJson) {
        // If not JSON (likely HTML error page), return error response
        const text = await response.text();
        console.error(
          `Non-JSON response received from ${endpoint} (Status: ${response.status}, Content-Type: ${contentType || 'unknown'}):\n${text.substring(0, 200)}`
        );

        return {
          success: false,
          error: response.status === 404
            ? `Endpoint not found: ${endpoint}`
            : `Unexpected response format (${response.status})`,
        } as ApiResponse<T>;
      }

      const data: ApiResponse<T> = await response.json();

      // Handle token refresh on auth failures (fallback for edge cases)
      // Only retry once to prevent infinite loops
      const errorText = (data?.error || '').toLowerCase();
      const isLikelyAuthFailure =
        response.status === 401 ||
        (
          response.status === 403 &&
          (
            errorText.includes('invalid or expired token') ||
            errorText.includes('authentication required') ||
            errorText.includes('branch context missing')
          )
        );

      if (isLikelyAuthFailure && token && !isAuthEndpoint && !(options as any)._retried) {
        const refreshed = await this.refreshToken();
        if (refreshed) {
          // Retry original request with new token (mark as retried)
          return this.request<T>(endpoint, { ...options, _retried: true } as RequestInit);
        }
        // If refresh failed, clear storage and return error
        tokenStorage.clear();
        return {
          success: false,
          error: 'Authentication failed. Please login again.',
        } as ApiResponse<T>;
      }

      return data;
    } catch (error) {
      console.error('API request failed:', error);
      // If JSON parsing fails, return error response
      if (error instanceof SyntaxError) {
        return {
          success: false,
          error: 'Invalid JSON response from server',
        } as ApiResponse<T>;
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error occurred',
      } as ApiResponse<T>;
    }
  }

  /**
   * Refresh access token
   * Uses promise caching to prevent concurrent refresh calls
   */
  private async refreshToken(): Promise<boolean> {
    // If refresh is already in progress, wait for it
    if (this.refreshPromise) {
      return await this.refreshPromise;
    }

    // Create new refresh promise
    this.refreshPromise = this._performRefresh();

    try {
      const result = await this.refreshPromise;
      return result;
    } finally {
      // Clear promise after completion
      this.refreshPromise = null;
    }
  }

  /**
   * Perform the actual token refresh
   */
  private async _performRefresh(): Promise<boolean> {
    const refreshToken = tokenStorage.getRefreshToken();

    if (!refreshToken) {
      tokenStorage.clear();
      return false;
    }

    // Check if refresh token is expired
    if (tokenStorage.isRefreshTokenExpired()) {
      tokenStorage.clear();
      return false;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ refreshToken }),
      });

      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type');
      const isJson = contentType?.includes('application/json');

      if (!isJson) {
        console.error('Non-JSON response from refresh endpoint');
        return false;
      }

      const data: ApiResponse<{ accessToken: string; refreshToken: string; user: unknown }> =
        await response.json();

      if (data.success && data.data) {
        tokenStorage.setAccessToken(data.data.accessToken);
        tokenStorage.setRefreshToken(data.data.refreshToken);

        // Update user if provided
        if (data.data.user) {
          tokenStorage.setUser(data.data.user as Parameters<typeof tokenStorage.setUser>[0]);
        }

        return true;
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }

    // Refresh failed - clear storage
    tokenStorage.clear();
    return false;
  }

  /**
   * GET request
   */
  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    // Don't stringify FormData - let browser handle it
    const processedBody = body instanceof FormData ? body : JSON.stringify(body);
    return this.request<T>(endpoint, {
      method: 'POST',
      body: processedBody,
    });
  }

  /**
   * POST that returns a file (CSV/XLSX/JSON/CDF …) instead of a JSON envelope.
   * Same auth/branch headers and one-shot token refresh as `request`; JSON error bodies are
   * surfaced as `{ success: false, error }`.
   */
  async postForFile(
    endpoint: string,
    body?: unknown,
    onChunk?: (chunk: Uint8Array, headers: Headers) => void
  ): Promise<
    | { success: true; blob: Blob; filename: string | null; headers: Headers }
    | { success: false; error: string }
  > {
    const normalizedPath = endpoint.startsWith('/api/') ? endpoint.substring(4) : endpoint;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await this.ensureValidToken())) {
        return { success: false, error: 'Authentication failed. Please login again.' };
      }
      const token = tokenStorage.getAccessToken();
      const activeBranch = branchStorage.getActiveBranch();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      if (activeBranch?.id) headers['X-Branch-Id'] = activeBranch.id;

      try {
        const response = await fetch(`${API_BASE_URL}${normalizedPath}`, {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify(body),
        });
        if (response.status === 401 && attempt === 0 && token && (await this.refreshToken())) continue;
        if (!response.ok) {
          const isJson = response.headers.get('content-type')?.includes('application/json');
          const data = isJson ? await response.json().catch(() => null) : null;
          return { success: false, error: data?.error || `Request failed (${response.status})` };
        }
        const disposition = response.headers.get('content-disposition') ?? '';
        const match = /filename="?([^";]+)"?/i.exec(disposition);
        if (onChunk && response.body) {
          // Read the stream ourselves so the caller can show progress; the bytes are kept exactly as received.
          const reader = response.body.getReader();
          const parts: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              parts.push(value);
              onChunk(value, response.headers);
            }
          }
          const type = response.headers.get('content-type') ?? '';
          return { success: true, blob: new Blob(parts as BlobPart[], { type }), filename: match ? match[1] : null, headers: response.headers };
        }
        return { success: true, blob: await response.blob(), filename: match ? match[1] : null, headers: response.headers };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Network error occurred' };
      }
    }
    return { success: false, error: 'Authentication failed. Please login again.' };
  }

  /**
   * PUT request
   */
  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    // Don't stringify FormData - let browser handle it
    const processedBody = body instanceof FormData ? body : JSON.stringify(body);
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: processedBody,
    });
  }

  /**
   * PATCH request
   */
  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export const apiClient = new ApiClient();
