import { tokenStorage } from '@/app/lib/token-storage';

/**
 * Downloads a binary file (such as a PDF) directly in the user's browser via an authenticated GET request.
 * Extracts the suggested filename from the response's Content-Disposition header if present,
 * or falls back to `defaultFilename`.
 */
export async function downloadBlobFile(endpoint: string, defaultFilename: string): Promise<void> {
    const token = tokenStorage.getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const normalizedPath = endpoint.startsWith('/api/')
        ? endpoint
        : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

    const res = await fetch(normalizedPath, {
        method: 'GET',
        headers,
        credentials: 'include',
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Failed to download file (${res.status})`);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition');
    let filename = defaultFilename;

    if (disposition) {
        const match = disposition.match(/filename="?([^";]+)"?/i);
        if (match?.[1]) {
            filename = match[1];
        }
    }

    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

