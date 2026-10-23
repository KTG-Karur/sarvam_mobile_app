import { describe, expect, it } from 'vitest';
import {
    appendKycUploadOwnerAndCategory,
    resolveKycUploadCategory,
    resolveKycUploadOwner,
} from '@/app/lib/kyc-document-types';

describe('resolveKycUploadOwner', () => {
    it('uses explicit nominee when provided', () => {
        expect(
            resolveKycUploadOwner({ documentType: 'aadhaar_front', explicitOwner: 'nominee' }),
        ).toBe('nominee');
    });

    it('infers coApplicant from document type prefix', () => {
        expect(resolveKycUploadOwner({ documentType: 'co_applicant_pan_card' })).toBe('coApplicant');
    });

    it('defaults to client for primary KYC types', () => {
        expect(resolveKycUploadOwner({ documentType: 'client_photo' })).toBe('client');
        expect(resolveKycUploadOwner({ documentType: 'aadhaar_front' })).toBe('client');
    });
});

describe('resolveKycUploadCategory', () => {
    it('uses photos when document type includes photo', () => {
        expect(
            resolveKycUploadCategory({ documentType: 'client_photo', owner: 'client' }),
        ).toBe('photos');
        expect(
            resolveKycUploadCategory({ documentType: 'co_applicant_photo', owner: 'coApplicant' }),
        ).toBe('photos');
    });

    it('uses nominee folder for nominee owner', () => {
        expect(
            resolveKycUploadCategory({ documentType: 'aadhaar_front', owner: 'nominee' }),
        ).toBe('nominee');
    });

    it('defaults to kyc', () => {
        expect(
            resolveKycUploadCategory({ documentType: 'pan_card', owner: 'client' }),
        ).toBe('kyc');
    });
});

describe('appendKycUploadOwnerAndCategory', () => {
    it('appends owner and category to FormData', () => {
        const fd = new FormData();
        appendKycUploadOwnerAndCategory(fd, 'client_photo');
        expect(fd.get('owner')).toBe('client');
        expect(fd.get('category')).toBe('photos');
    });
});
