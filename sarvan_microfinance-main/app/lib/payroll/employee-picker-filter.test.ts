import { describe, expect, it } from 'vitest';
import { EMPLOYEE_PICKER_MAX_ROWS, filterEmployeeOptions, type EmployeeOption } from './employee-picker-filter';

const make = (n: number): EmployeeOption[] => Array.from({ length: n }, (_, i) => ({ id: `id${i}`, name: `EMPLOYEE ${i} (FDO)` }));

describe('filterEmployeeOptions', () => {
    it('returns everyone for an empty or blank search', () => {
        const list = make(5);
        expect(filterEmployeeOptions(list, '')).toHaveLength(5);
        expect(filterEmployeeOptions(list, '   ')).toHaveLength(5);
    });

    it('searches the whole list (not just what is drawn), case-insensitively', () => {
        const list = [...make(3000), { id: 'target', name: 'RAVI KUMAR (BRANCH_MANAGER)' }];
        expect(filterEmployeeOptions(list, 'ravi kumar').map((e) => e.id)).toEqual(['target']);
        expect(filterEmployeeOptions(list, 'branch_manager')).toHaveLength(1);
    });

    it('matches nothing for an unknown name', () => {
        expect(filterEmployeeOptions(make(10), 'zzz')).toEqual([]);
    });

    it('the picker draws at most EMPLOYEE_PICKER_MAX_ROWS rows even for a huge "All Branches" list', () => {
        const matches = filterEmployeeOptions(make(5000), '');
        expect(matches.slice(0, EMPLOYEE_PICKER_MAX_ROWS)).toHaveLength(50);
        expect(EMPLOYEE_PICKER_MAX_ROWS).toBeLessThan(matches.length);
    });
});
