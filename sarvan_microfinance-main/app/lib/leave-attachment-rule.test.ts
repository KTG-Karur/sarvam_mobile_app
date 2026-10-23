import { describe, expect, it } from 'vitest';
import { attachmentRequiredMessage, isAttachmentRequired, sniffMime } from '@/app/lib/leave-attachment-rule';

describe('isAttachmentRequired', () => {
    it('never required when there is no rule', () => {
        expect(isAttachmentRequired(null, 10)).toBe(false);
        expect(isAttachmentRequired(undefined, 10)).toBe(false);
    });

    it('is required only for MORE than the threshold (threshold 2)', () => {
        expect(isAttachmentRequired(2, 1)).toBe(false);
        expect(isAttachmentRequired(2, 2)).toBe(false);
        expect(isAttachmentRequired(2, 2.5)).toBe(true);
        expect(isAttachmentRequired(2, 3)).toBe(true);
    });

    it('threshold 0 means always required, including a half-day', () => {
        expect(isAttachmentRequired(0, 0.5)).toBe(true);
        expect(isAttachmentRequired(0, 1)).toBe(true);
    });

    it('a half-day is not more than 2', () => {
        expect(isAttachmentRequired(2, 0.5)).toBe(false);
    });

    it('accepts Prisma Decimal-like and string thresholds', () => {
        expect(isAttachmentRequired('2.00', 3)).toBe(true);
        expect(isAttachmentRequired({ toString: () => '2' }, 2)).toBe(false);
        expect(isAttachmentRequired('abc', 3)).toBe(false);
    });
});

describe('attachmentRequiredMessage', () => {
    it('names the leave type and the threshold', () => {
        expect(attachmentRequiredMessage('SICK', 2)).toContain('SICK for more than 2 days');
        expect(attachmentRequiredMessage('SICK', 1)).toContain('more than 1 day needs');
        expect(attachmentRequiredMessage('SICK', 0)).toBe('SICK needs a proof attachment (for example a medical certificate).');
    });
});

describe('sniffMime', () => {
    it('recognises PDF, JPEG and PNG by their first bytes', () => {
        expect(sniffMime(Buffer.from('%PDF-1.7 ...'))).toBe('application/pdf');
        expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('image/jpeg');
        expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe('image/png');
    });

    it('rejects anything else, including a renamed script or text file', () => {
        expect(sniffMime(Buffer.from('<script>alert(1)</script>'))).toBeNull();
        expect(sniffMime(Buffer.from('hello'))).toBeNull();
        expect(sniffMime(Buffer.alloc(0))).toBeNull();
    });
});
