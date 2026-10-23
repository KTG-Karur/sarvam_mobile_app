import { describe, expect, it } from 'vitest';
import { determineWorkbenchMode } from './workbench-mode';

describe('determineWorkbenchMode', () => {
  const ref = new Date('2026-06-15T10:00:00.000Z');

  it('classifies as ARREAR when any line is past the reference date, even mixed with future/today lines', () => {
    const mode = determineWorkbenchMode(
      [
        { dueDate: '2026-06-10T00:00:00.000Z' }, // past
        { dueDate: '2026-06-15T00:00:00.000Z' }, // today
        { dueDate: '2026-06-20T00:00:00.000Z' }, // future
      ],
      ref
    );
    expect(mode).toBe('ARREAR');
  });

  it('classifies as DEMAND when all lines are today and none are past', () => {
    const mode = determineWorkbenchMode(
      [{ dueDate: '2026-06-15T00:00:00.000Z' }, { dueDate: '2026-06-15T00:00:00.000Z' }],
      ref
    );
    expect(mode).toBe('DEMAND');
  });

  it('classifies as DEMAND when lines mix today and future but none are past', () => {
    const mode = determineWorkbenchMode(
      [{ dueDate: '2026-06-15T00:00:00.000Z' }, { dueDate: '2026-06-20T00:00:00.000Z' }],
      ref
    );
    expect(mode).toBe('DEMAND');
  });

  it('classifies as ADVANCE when every line is strictly in the future', () => {
    const mode = determineWorkbenchMode(
      [{ dueDate: '2026-06-20T00:00:00.000Z' }, { dueDate: '2026-06-25T00:00:00.000Z' }],
      ref
    );
    expect(mode).toBe('ADVANCE');
  });

  it('falls back to DEMAND for an empty schedule list', () => {
    expect(determineWorkbenchMode([], ref)).toBe('DEMAND');
  });

  it('ignores lines with a null dueDate rather than miscounting them', () => {
    const mode = determineWorkbenchMode(
      [{ dueDate: null }, { dueDate: '2026-06-20T00:00:00.000Z' }],
      ref
    );
    expect(mode).toBe('ADVANCE');
  });
});
