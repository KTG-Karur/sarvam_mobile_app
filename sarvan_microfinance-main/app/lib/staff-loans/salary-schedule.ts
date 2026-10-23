/**
 * Salary-date based due dates for staff loans. Client-safe (no server imports) so the disbursement
 * dialog previews exactly what the server will create.
 *
 * Rule: an installment falls due on the salary day of its month. When that day is a Sunday the
 * installment is due the day before (Saturday). Salary days beyond a short month's end (e.g. 31 in
 * February) fall on that month's last day. All dates are plain calendar dates (YYYY-MM-DD).
 */

export type FirstDueMonth = 'THIS_MONTH' | 'NEXT_MONTH';

export const FIRST_DUE_MONTH_LABEL: Record<FirstDueMonth, string> = {
    THIS_MONTH: 'This month',
    NEXT_MONTH: 'Next month',
};

const pad = (n: number) => String(n).padStart(2, '0');
const toYmd = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function parseYmd(ymd: string): { year: number; month: number; day: number } {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!match) throw new Error('Invalid date');
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function isValidSalaryDay(day: unknown): day is number {
    return typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31;
}

/** Due date for the given calendar month (month is 1-12): the salary day, or the day before if a Sunday. */
export function salaryDueDate(year: number, month: number, salaryDay: number): string {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const due = new Date(Date.UTC(year, month - 1, Math.min(salaryDay, lastDay)));
    if (due.getUTCDay() === 0) due.setUTCDate(due.getUTCDate() - 1);
    return toYmd(due);
}

/** The month (1-12) the first installment belongs to, relative to the disbursement date. */
export function firstDueYearMonth(disbursementYmd: string, option: FirstDueMonth): { year: number; month: number } {
    const { year, month } = parseYmd(disbursementYmd);
    if (option === 'THIS_MONTH') return { year, month };
    return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export function firstSalaryDueDate(disbursementYmd: string, option: FirstDueMonth, salaryDay: number): string {
    const { year, month } = firstDueYearMonth(disbursementYmd, option);
    return salaryDueDate(year, month, salaryDay);
}

/** One due date per installment, one calendar month apart, each following the salary-date rule. */
export function buildSalaryDueDates(disbursementYmd: string, option: FirstDueMonth, salaryDay: number, count: number): string[] {
    const first = firstDueYearMonth(disbursementYmd, option);
    return Array.from({ length: count }, (_, i) => {
        const monthIndex = first.month - 1 + i;
        return salaryDueDate(first.year + Math.floor(monthIndex / 12), (monthIndex % 12) + 1, salaryDay);
    });
}

/**
 * Which option to preselect: this month when its salary date has not passed yet, otherwise next month.
 * A first installment can never fall before the disbursement date.
 */
export function defaultFirstDueMonth(disbursementYmd: string, salaryDay: number): FirstDueMonth {
    return firstSalaryDueDate(disbursementYmd, 'THIS_MONTH', salaryDay) >= disbursementYmd ? 'THIS_MONTH' : 'NEXT_MONTH';
}
