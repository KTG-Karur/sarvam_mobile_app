import { Storage } from '@google-cloud/storage';
import path from 'path';
import fs from 'fs';

/**
 * Shared Google Cloud Storage client with automatic local disk fallback.
 *
 * If `GCS_BUCKET_NAME`, `GCS_PROJECT_ID` and a valid `gcs-service-account.json`
 * key file exist on disk, uploads go to Google Cloud Storage.
 * If the service account JSON key file is missing locally, uploads fall back to
 * local disk storage (`public/uploads/`) so local testing works seamlessly.
 */

const gcsBucketName = process.env.GCS_BUCKET_NAME;
const gcsProjectId = process.env.GCS_PROJECT_ID;
const gcsCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

function resolveKeyFilename(): string | null {
    if (!gcsCredentialsPath) return null;
    const resolved = path.isAbsolute(gcsCredentialsPath)
        ? gcsCredentialsPath
        : path.join(/* turbopackIgnore: true */ process.cwd(), gcsCredentialsPath);
    return fs.existsSync(resolved) ? resolved : null;
}

const keyFilename = resolveKeyFilename();
export const isGcsConfigValid = !!(gcsBucketName && gcsProjectId && keyFilename);

let _storage: Storage | null = null;

function getStorage(): Storage | null {
    if (!isGcsConfigValid || !keyFilename) return null;

    if (!_storage) {
        _storage = new Storage({
            projectId: gcsProjectId,
            keyFilename,
        });
    }
    return _storage;
}

function getBucket() {
    const storage = getStorage();
    return storage ? storage.bucket(gcsBucketName!) : null;
}

function getLocalFilePath(key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    return path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'uploads', cleanKey);
}

export async function uploadObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    const bucket = getBucket();
    if (bucket) {
        try {
            await bucket.file(key).save(buffer, {
                contentType,
                resumable: false,
            });
            return;
        } catch (error: unknown) {
            console.warn('[GCS Client] Primary GCS upload failed, falling back to local storage:', error);
        }
    }

    // Local Disk Fallback
    const localPath = getLocalFilePath(key);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
}

/**
 * Best-effort delete.
 */
export async function deleteObject(key: string | null | undefined): Promise<void> {
    if (!key) return;
    if (/^https?:\/\//i.test(key)) return;

    const bucket = getBucket();
    if (bucket) {
        try {
            await bucket.file(key).delete({ ignoreNotFound: true });
            return;
        } catch (_) {}
    }

    const localPath = getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
        try {
            fs.unlinkSync(localPath);
        } catch (_) {}
    }
}

export async function copyObject(sourceKey: string, destKey: string): Promise<void> {
    const bucket = getBucket();
    if (bucket) {
        try {
            await bucket.file(sourceKey).copy(bucket.file(destKey));
            return;
        } catch (_) {}
    }

    const srcPath = getLocalFilePath(sourceKey);
    const destPath = getLocalFilePath(destKey);
    if (fs.existsSync(srcPath)) {
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
    }
}

/**
 * Download an object's full contents plus its stored content type.
 */
export async function downloadObject(key: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const bucket = getBucket();
    if (bucket) {
        try {
            const file = bucket.file(key);
            const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
            return { buffer, contentType: metadata.contentType || 'application/octet-stream' };
        } catch (_) {}
    }

    const localPath = getLocalFilePath(key);
    if (fs.existsSync(localPath)) {
        const buffer = fs.readFileSync(localPath);
        return { buffer, contentType: 'image/jpeg' };
    }
    return null;
}

/**
 * Mint a signed URL or local static URL for reading a private object.
 */
export async function getSignedReadUrl(key: string, expiresInMs: number = 60 * 60 * 1000): Promise<string> {
    if (/^https?:\/\//i.test(key)) return key;

    const bucket = getBucket();
    if (bucket) {
        try {
            const [url] = await bucket.file(key).getSignedUrl({
                version: 'v4',
                action: 'read',
                expires: Date.now() + expiresInMs,
            });
            return url;
        } catch (_) {}
    }

    const cleanKey = key.replace(/^\/+/, '');
    return `/uploads/${cleanKey}`;
}

export { gcsBucketName, gcsProjectId };
