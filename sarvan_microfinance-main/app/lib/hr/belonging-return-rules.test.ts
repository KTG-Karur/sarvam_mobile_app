import { describe, it, expect } from 'vitest';
import { validateBelongingReturn, BELONGING_PROOF_MAX_PHOTOS } from './belonging-return-rules';

describe('validateBelongingReturn', () => {
    it('accepts a return with a photo', () => {
        expect(validateBelongingReturn({ status: 'RETURNED', photoCount: 1 })).toBeNull();
    });

    it('rejects a return with no photo', () => {
        expect(validateBelongingReturn({ status: 'RETURNED', photoCount: 0 })).toMatch(/photo/);
    });

    it('rejects a damaged item without a photo', () => {
        expect(validateBelongingReturn({ status: 'DAMAGED', photoCount: 0 })).toMatch(/photo/);
    });

    it('lets a damaged item omit the recovery amount', () => {
        expect(validateBelongingReturn({ status: 'DAMAGED', photoCount: 2, recoveryAmount: null })).toBeNull();
    });

    it('needs no photo for a lost item, only the recovery amount (0 allowed when waived)', () => {
        expect(validateBelongingReturn({ status: 'LOST', photoCount: 0 })).toMatch(/recovery amount/);
        expect(validateBelongingReturn({ status: 'LOST', photoCount: 0, recoveryAmount: 0 })).toBeNull();
        expect(validateBelongingReturn({ status: 'LOST', photoCount: 0, recoveryAmount: 1500 })).toBeNull();
    });

    it('rejects photos sent for a lost item', () => {
        expect(validateBelongingReturn({ status: 'LOST', photoCount: 1, recoveryAmount: 0 })).toMatch(/not recorded/);
    });

    it('rejects a negative recovery amount', () => {
        expect(validateBelongingReturn({ status: 'DAMAGED', photoCount: 1, recoveryAmount: -5 })).toMatch(/zero or more/);
    });

    it('rejects too many photos', () => {
        expect(validateBelongingReturn({ status: 'RETURNED', photoCount: BELONGING_PROOF_MAX_PHOTOS + 1 })).toMatch(/At most/);
    });
});
