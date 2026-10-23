import { describe, expect, it } from 'vitest';
import { checkPunchRadius, PUNCH_RADIUS_MAX_ALLOWED_METERS } from './punch-radius';

const branch = { name: 'Salem', latitude: 11.6643, longitude: 78.146 };
// ~1 degree of latitude = 111,195 m, so metres -> degrees is a fixed ratio.
const north = (meters: number) => ({ latitude: branch.latitude + meters / 111_195, longitude: branch.longitude });

describe('checkPunchRadius', () => {
    it('allows everything when the lock is off', () => {
        expect(checkPunchRadius({ locked: false, branch, ...north(5000) }).allowed).toBe(true);
    });

    it('allows when the branch has no coordinates', () => {
        const r = checkPunchRadius({ locked: true, branch: { name: 'X', latitude: null, longitude: null }, ...north(5000) });
        expect(r.allowed).toBe(true);
    });

    it('refuses when the device sent no coordinates', () => {
        const r = checkPunchRadius({ locked: true, branch });
        expect(r).toMatchObject({ allowed: false, code: 'LOCATION_REQUIRED' });
    });

    it('allows inside 100 m and up to the 130 m limit', () => {
        expect(checkPunchRadius({ locked: true, branch, ...north(40) }).allowed).toBe(true);
        expect(checkPunchRadius({ locked: true, branch, ...north(PUNCH_RADIUS_MAX_ALLOWED_METERS - 2) }).allowed).toBe(true);
    });

    it('refuses beyond 130 m with the distance and branch name', () => {
        const r = checkPunchRadius({ locked: true, branch, ...north(PUNCH_RADIUS_MAX_ALLOWED_METERS + 10) });
        expect(r.allowed).toBe(false);
        if (!r.allowed) {
            expect(r.code).toBe('OUT_OF_RADIUS');
            expect(r.message).toContain('Salem');
            expect(r.distanceMeters).toBeGreaterThan(PUNCH_RADIUS_MAX_ALLOWED_METERS);
        }
    });
});
