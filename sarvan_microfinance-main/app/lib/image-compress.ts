/**
 * image-compress.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Browser-side image compression engine for Sarvam Charitable Trust.
 *
 * Supports per-document-type settings so portrait photos, house images, and
 * KYC documents each compress to the right quality / dimension trade-off.
 *
 * Key exports:
 *   compressImage(file, documentType)  → CompressionResult (new API)
 *   compressImageFile(file, maxBytes)  → File (legacy shim — kept for back-compat)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import imageCompression from 'browser-image-compression';

// ─── Image-category types ────────────────────────────────────────────────────

/** High-level image category used to pick compression settings. */
export type ImageCategory = 'portrait' | 'house' | 'document' | 'other';

/** Per-category compression configuration. */
export interface ImageCompressionConfig {
  /** Category label (for logging/display). */
  category: ImageCategory;
  /** Maximum width in pixels (aspect ratio preserved). */
  maxWidthOrHeight: number;
  /** JPEG quality — 0.0–1.0. */
  initialQuality: number;
  /** Target file size in bytes.  Compression retries until met (or floor quality). */
  maxSizeBytes: number;
}

// ─── Per-category presets ─────────────────────────────────────────────────────

const PORTRAIT_CONFIG: ImageCompressionConfig = {
  category: 'portrait',
  // 600 × 600 square crop area is sufficient for client / co-applicant photos.
  maxWidthOrHeight: 600,
  initialQuality: 0.70,
  maxSizeBytes: 100 * 1024,   // 100 KB
};

const HOUSE_CONFIG: ImageCompressionConfig = {
  category: 'house',
  // 1280 wide gives good landscape clarity without huge files.
  maxWidthOrHeight: 1280,
  initialQuality: 0.75,
  maxSizeBytes: 250 * 1024,   // 250 KB
};

const DOCUMENT_CONFIG: ImageCompressionConfig = {
  category: 'document',
  // 1200 × 800 keeps text crisp for ID / passbook scans.
  maxWidthOrHeight: 1200,
  initialQuality: 0.82,
  maxSizeBytes: 200 * 1024,   // 200 KB
};

const OTHER_CONFIG: ImageCompressionConfig = {
  category: 'other',
  maxWidthOrHeight: 1200,
  initialQuality: 0.80,
  maxSizeBytes: 200 * 1024,   // 200 KB
};

// ─── Document-type → category mapping ────────────────────────────────────────

/**
 * Maps every KYC document type key to an image category.
 * Keys are the `value` strings from kyc-document-types.ts.
 */
const DOCUMENT_TYPE_CATEGORY_MAP: Record<string, ImageCategory> = {
  // Portrait photos
  client_photo: 'portrait',
  co_applicant_photo: 'portrait',

  // House / property images
  house_image_1: 'house',
  house_image_2: 'house',
  house_image_3: 'house',

  // KYC identity documents — text readability is critical
  aadhaar_front: 'document',
  aadhaar_back: 'document',
  pan_card: 'document',
  voter_id: 'document',
  voter_id_back: 'document',
  bank_passbook: 'document',
  signature: 'document',
  smart_card_front: 'document',
  smart_card_back: 'document',
  co_applicant_aadhaar_back: 'document',
  co_applicant_pan_card: 'document',
  co_applicant_voter_id: 'document',
  co_applicant_voter_id_back: 'document',
  co_applicant_other_id: 'document',
  co_applicant_other_id_front: 'document',
  co_applicant_other_id_back: 'document',
  co_applicant_signature: 'document',

  // Miscellaneous
  gas_bill: 'other',
  noc_image_1: 'other',
  noc_image_2: 'other',
  noc_image_3: 'other',
  location_qr: 'other',
};

/** Resolve a compression config directly from a category. */
function getConfigForCategory(category: ImageCategory): ImageCompressionConfig {
  switch (category) {
    case 'portrait': return PORTRAIT_CONFIG;
    case 'house':    return HOUSE_CONFIG;
    case 'document': return DOCUMENT_CONFIG;
    default:         return OTHER_CONFIG;
  }
}

/** Resolve a compression config from a document type string. */
export function getCompressionConfig(documentType: string): ImageCompressionConfig {
  const category = DOCUMENT_TYPE_CATEGORY_MAP[documentType] ?? 'other';
  return getConfigForCategory(category);
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface CompressionStats {
  /** Original file size in bytes. */
  originalSize: number;
  /** Compressed file size in bytes. */
  compressedSize: number;
  /** Size reduction as a percentage (0–100). */
  reductionPercent: number;
  /** Output dimensions. */
  dimensions: { width: number; height: number };
  /** Whether the file was actually compressed (false when unchanged). */
  wasCompressed: boolean;
}

export interface CompressionResult extends CompressionStats {
  /** The (possibly compressed) file ready for upload. */
  compressedFile: File;
  /** Object-URL for previewing the compressed image — caller must revoke when done. */
  previewUrl: string;
  /** Human-readable original size, e.g. "1.24 MB". */
  originalSizeLabel: string;
  /** Human-readable compressed size, e.g. "98 KB". */
  compressedSizeLabel: string;
  /** The compression category that was applied. */
  category: ImageCategory;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format bytes as "123 B", "1.24 KB", "2.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Supported image MIME types (non-image files are skipped). */
const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/** Measure the pixel dimensions of an image File using an off-screen Image element. */
function measureDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}

// ─── Core compression function ────────────────────────────────────────────────

/**
 * Compress an image file according to the rules for `documentType`.
 *
 * - Non-image files (PDF, Excel …) are returned unchanged with `wasCompressed: false`.
 * - Files already within the target size are returned as-is (no re-encode).
 * - Always outputs JPEG (accepted by every upload validator in the app).
 * - Preserves aspect ratio; never enlarges smaller images.
 *
 * @param file         Raw file from an <input type="file"> or camera capture.
 * @param documentType One of the KYC document type keys (e.g. "client_photo").
 * @returns            CompressionResult with the compressed file and stats.
 */
export async function compressImage(
  file: File,
  documentType: string,
): Promise<CompressionResult> {
  return compressImageForCategory(file, getCompressionConfig(documentType).category);
}

/**
 * Same as `compressImage`, but takes an `ImageCategory` directly instead of a
 * KYC document-type key. Use this for uploads that don't map to a KYC
 * document type (profile photos, audit photos, approval scans, etc.).
 *
 * @param file     Raw file from an <input type="file"> or camera capture.
 * @param category One of 'portrait' | 'house' | 'document' | 'other'.
 * @returns        CompressionResult with the compressed file and stats.
 */
export async function compressImageForCategory(
  file: File,
  category: ImageCategory,
): Promise<CompressionResult> {
  const config = getConfigForCategory(category);
  const originalSize = file.size;

  // ── Skip non-image files ──────────────────────────────────────────────────
  if (!SUPPORTED_MIME.has(file.type) && !file.type.startsWith('image/')) {
    return {
      compressedFile: file,
      previewUrl: URL.createObjectURL(file),
      originalSize,
      compressedSize: originalSize,
      reductionPercent: 0,
      dimensions: { width: 0, height: 0 },
      wasCompressed: false,
      originalSizeLabel: formatBytes(originalSize),
      compressedSizeLabel: formatBytes(originalSize),
      category: config.category,
    };
  }

  // ── Build browser-image-compression options ───────────────────────────────
  // Always output JPEG — WebP is rejected by every upload validator in the app
  // (KYCDocumentForm, KYCUpdateForm, CoApplicantForm, useFileUpload all only
  // allow image/jpeg | image/jpg | image/png).  The real size savings come from
  // maxWidthOrHeight + initialQuality, not the container format.
  const fileType = 'image/jpeg';

  const options = {
    maxSizeMB: config.maxSizeBytes / (1024 * 1024),
    maxWidthOrHeight: config.maxWidthOrHeight,
    initialQuality: config.initialQuality,
    fileType,
    // Preserve EXIF only for portrait photos where orientation matters.
    preserveExif: config.category === 'portrait',
    useWebWorker: true,
  };

  let compressedBlob: File;
  try {
    compressedBlob = await imageCompression(file, options);
  } catch {
    // If compression fails for any reason, fall back to the original file.
    const previewUrl = URL.createObjectURL(file);
    const dims = await measureDimensions(file);
    return {
      compressedFile: file,
      previewUrl,
      originalSize,
      compressedSize: originalSize,
      reductionPercent: 0,
      dimensions: dims,
      wasCompressed: false,
      originalSizeLabel: formatBytes(originalSize),
      compressedSizeLabel: formatBytes(originalSize),
      category: config.category,
    };
  }

  // browser-image-compression already names the blob; give it a .jpg extension.
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const outputFile = new File([compressedBlob], `${baseName}.jpg`, {
    type: fileType,
    lastModified: Date.now(),
  });

  const compressedSize = outputFile.size;
  const reductionPercent = Math.round(((originalSize - compressedSize) / originalSize) * 100);
  const dimensions = await measureDimensions(outputFile);
  const previewUrl = URL.createObjectURL(outputFile);

  return {
    compressedFile: outputFile,
    previewUrl,
    originalSize,
    compressedSize,
    reductionPercent: Math.max(0, reductionPercent),
    dimensions,
    wasCompressed: compressedSize < originalSize,
    originalSizeLabel: formatBytes(originalSize),
    compressedSizeLabel: formatBytes(compressedSize),
    category: config.category,
  };
}

// ─── Legacy shim ──────────────────────────────────────────────────────────────

/**
 * @deprecated  Use `compressImage(file, documentType)` instead.
 *
 * Kept for backward-compatibility with the old call-site in
 * `DocumentInputWithUpload.tsx` that passed a raw file without a doc type.
 * Falls back to the 'other' preset with a 5 MB ceiling.
 */
export async function compressImageFile(
  file: File,
  maxBytes = 5 * 1024 * 1024,
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= maxBytes) return file;

  const result = await compressImage(file, 'other');
  // Release the preview URL immediately — caller doesn't use it.
  URL.revokeObjectURL(result.previewUrl);
  return result.compressedFile;
}
