/**
 * Proof / attachment rule for leave applications — see attendance-hr/plan-leave-proof-attachment.md.
 * One shared definition for the server routes, the tests and (mirrored) the apply form.
 */

export const LEAVE_PROOF_MAX_FILES = 3;
export const LEAVE_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const LEAVE_PROOF_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'] as const;

/**
 * `threshold` is LeaveType.attachmentRequiredAboveDays: null/undefined = never required,
 * N = required when `numberOfDays` is MORE THAN N (2 => 2 days is fine, 2.5 or 3 needs proof),
 * 0 = always required. A half-day counts as 0.5.
 */
export function isAttachmentRequired(threshold: number | string | { toString(): string } | null | undefined, numberOfDays: number): boolean {
    if (threshold === null || threshold === undefined) return false;
    const n = Number(threshold.toString());
    if (Number.isNaN(n)) return false;
    return numberOfDays > n;
}

export function attachmentRequiredMessage(leaveTypeName: string, threshold: number | string | { toString(): string }): string {
    const n = Number(threshold.toString());
    return n <= 0
        ? `${leaveTypeName} needs a proof attachment (for example a medical certificate).`
        : `${leaveTypeName} for more than ${n} day${n === 1 ? '' : 's'} needs a proof attachment (for example a medical certificate).`;
}

/** Cheap content sniffing so a renamed file can't pass as a PDF/image. */
export function sniffMime(buffer: Buffer): (typeof LEAVE_PROOF_ALLOWED_MIME)[number] | null {
    if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    return null;
}
