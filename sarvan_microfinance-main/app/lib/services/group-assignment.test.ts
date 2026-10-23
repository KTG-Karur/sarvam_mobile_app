import { describe, expect, it } from 'vitest';
import {
    pickGroupWithCapacity,
    parseGroupNumberFromName,
    computeNextGroupNumber,
    buildGroupName,
    nextGlobalGroupCode,
} from '@/app/lib/services/group-assignment.service';

describe('pickGroupWithCapacity', () => {
    it('returns null for an empty list', () => {
        expect(pickGroupWithCapacity([], 5)).toBeNull();
    });

    it('returns null when every group is full', () => {
        const groups = [{ memberCount: 5 }, { memberCount: 5 }];
        expect(pickGroupWithCapacity(groups, 5)).toBeNull();
    });

    it('picks the first group with capacity, respecting order', () => {
        const groups = [
            { id: 'g1', memberCount: 5 },
            { id: 'g2', memberCount: 3 },
            { id: 'g3', memberCount: 0 },
        ];
        expect(pickGroupWithCapacity(groups, 5)?.id).toBe('g2');
    });

    it('treats memberCount === max as full (boundary)', () => {
        expect(pickGroupWithCapacity([{ memberCount: 5 }], 5)).toBeNull();
        expect(pickGroupWithCapacity([{ memberCount: 4 }], 5)).not.toBeNull();
    });

    it('works with max = 1', () => {
        const groups = [{ id: 'g1', memberCount: 1 }, { id: 'g2', memberCount: 0 }];
        expect(pickGroupWithCapacity(groups, 1)?.id).toBe('g2');
    });
});

describe('parseGroupNumberFromName', () => {
    it('parses "<Center Name> - N"', () => {
        expect(parseGroupNumberFromName('Karuppukudipatti - 3', 'Karuppukudipatti')).toBe(3);
    });

    it('requires exact center-name match', () => {
        expect(parseGroupNumberFromName('Center B - 3', 'Center A')).toBeNull();
    });

    it('ignores custom names', () => {
        expect(parseGroupNumberFromName('Morning Stars', 'Center A')).toBeNull();
        expect(parseGroupNumberFromName('Center A - extra', 'Center A')).toBeNull();
    });

    it('escapes regex metacharacters in center names', () => {
        expect(parseGroupNumberFromName('C (East) - 2', 'C (East)')).toBe(2);
    });

    it('tolerates surrounding whitespace', () => {
        expect(parseGroupNumberFromName(' Center A - 4 ', 'Center A ')).toBe(4);
    });
});

describe('computeNextGroupNumber', () => {
    it('returns 1 for a center with no groups', () => {
        expect(computeNextGroupNumber([], 'Center A')).toBe(1);
    });

    it('uses assigned groupNumbers', () => {
        const groups = [
            { groupNumber: 1, name: 'Center A - 1' },
            { groupNumber: 2, name: 'Center A - 2' },
        ];
        expect(computeNextGroupNumber(groups, 'Center A')).toBe(3);
    });

    it('parses legacy convention-named groups without groupNumber', () => {
        const groups = [{ groupNumber: null, name: 'Center A - 7' }];
        expect(computeNextGroupNumber(groups, 'Center A')).toBe(8);
    });

    it('ignores names of other centers and custom names', () => {
        const groups = [
            { groupNumber: null, name: 'Center B - 9' },
            { groupNumber: null, name: 'Sunrise Group' },
        ];
        expect(computeNextGroupNumber(groups, 'Center A')).toBe(1);
    });

    it('takes the overall max across numbered and parsed names', () => {
        const groups = [
            { groupNumber: 2, name: 'Center A - 2' },
            { groupNumber: null, name: 'Center A - 5' },
            { groupNumber: null, name: 'Old Custom Group' },
        ];
        expect(computeNextGroupNumber(groups, 'Center A')).toBe(6);
    });

    it('includes inactive groups (numbers are never reused)', () => {
        // Caller passes ALL groups including inactive ones; nothing filters here.
        const groups = [{ groupNumber: 4, name: 'Center A - 4' }];
        expect(computeNextGroupNumber(groups, 'Center A')).toBe(5);
    });
});

describe('buildGroupName', () => {
    it('formats "<Center Name> - N"', () => {
        expect(buildGroupName('Vaiapurinagar', 1)).toBe('Vaiapurinagar - 1');
        expect(buildGroupName('  Center A  ', 12)).toBe('Center A - 12');
    });
});

describe('nextGlobalGroupCode', () => {
    it('returns "1" when there are no codes', () => {
        expect(nextGlobalGroupCode([])).toBe('1');
        expect(nextGlobalGroupCode([null, null])).toBe('1');
    });

    it('ignores null and non-numeric codes', () => {
        expect(nextGlobalGroupCode([null, 'abc', '2'])).toBe('3');
    });

    it('handles mixed legacy zero-padded and new unpadded codes numerically', () => {
        expect(nextGlobalGroupCode([null, 'abc', '001', '99'])).toBe('100');
        expect(nextGlobalGroupCode(['007', '10'])).toBe('11');
    });

    it('grows past three digits without padding', () => {
        expect(nextGlobalGroupCode(['999'])).toBe('1000');
    });
});
