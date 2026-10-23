export type AllocationMode = 'default' | 'principal' | 'interest' | 'penalty';

export type ScheduleAllocationInput = {
    id: string;
    installmentNo: number;
    dueDate: Date | string;
    principalDue: number | string;
    interestDue: number | string;
    feesDue?: number | string | null;
    penaltiesDue?: number | string | null;
    principalPaid?: number | string | null;
    interestPaid?: number | string | null;
    feesPaid?: number | string | null;
    penaltiesPaid?: number | string | null;
};

export type TransactionLinePlan = {
    scheduleId: string;
    installmentNo: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    feesAmount: number;
    penaltyAmount: number;
    lineTotal: number;
};

export type AllocationSummary = {
    principalAmount: number;
    interestAmount: number;
    feesAmount: number;
    penaltyAmount: number;
    lineTotal: number;
};

type ComponentBudget = {
    principalAmount: number;
    interestAmount: number;
    feesAmount: number;
    penaltyAmount: number;
};

function toAmount(value: number | string | null | undefined): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
}

function positiveAmount(value: number): number {
    return value > 0 ? Math.round(value * 100) / 100 : 0;
}

function createEmptySummary(): AllocationSummary {
    return {
        principalAmount: 0,
        interestAmount: 0,
        feesAmount: 0,
        penaltyAmount: 0,
        lineTotal: 0,
    };
}

function buildSummary(lines: TransactionLinePlan[]): AllocationSummary {
    return lines.reduce((summary, line) => {
        summary.principalAmount += line.principalAmount;
        summary.interestAmount += line.interestAmount;
        summary.feesAmount += line.feesAmount;
        summary.penaltyAmount += line.penaltyAmount;
        summary.lineTotal += line.lineTotal;
        return summary;
    }, createEmptySummary());
}

function toBudgetsFromAmount(
    schedules: ScheduleAllocationInput[],
    amount: number,
    mode: AllocationMode
): ComponentBudget {
    let remainingAmount = positiveAmount(amount);
    const budget: ComponentBudget = {
        principalAmount: 0,
        interestAmount: 0,
        feesAmount: 0,
        penaltyAmount: 0,
    };

    for (const schedule of schedules) {
        if (remainingAmount <= 0) {
            break;
        }

        const principalRemaining = positiveAmount(toAmount(schedule.principalDue) - toAmount(schedule.principalPaid));
        const interestRemaining = positiveAmount(toAmount(schedule.interestDue) - toAmount(schedule.interestPaid));
        const feesRemaining = positiveAmount(toAmount(schedule.feesDue) - toAmount(schedule.feesPaid));
        const penaltiesRemaining = positiveAmount(toAmount(schedule.penaltiesDue) - toAmount(schedule.penaltiesPaid));

        if (mode === 'principal') {
            const applied = Math.min(remainingAmount, principalRemaining);
            budget.principalAmount += applied;
            remainingAmount -= applied;
            continue;
        }

        if (mode === 'interest') {
            const applied = Math.min(remainingAmount, interestRemaining);
            budget.interestAmount += applied;
            remainingAmount -= applied;
            continue;
        }

        if (mode === 'penalty') {
            const applied = Math.min(remainingAmount, penaltiesRemaining);
            budget.penaltyAmount += applied;
            remainingAmount -= applied;
            continue;
        }

        const penaltyApplied = Math.min(remainingAmount, penaltiesRemaining);
        budget.penaltyAmount += penaltyApplied;
        remainingAmount -= penaltyApplied;

        const feesApplied = Math.min(remainingAmount, feesRemaining);
        budget.feesAmount += feesApplied;
        remainingAmount -= feesApplied;

        const interestApplied = Math.min(remainingAmount, interestRemaining);
        budget.interestAmount += interestApplied;
        remainingAmount -= interestApplied;

        const principalApplied = Math.min(remainingAmount, principalRemaining);
        budget.principalAmount += principalApplied;
        remainingAmount -= principalApplied;
    }

    return {
        principalAmount: positiveAmount(budget.principalAmount),
        interestAmount: positiveAmount(budget.interestAmount),
        feesAmount: positiveAmount(budget.feesAmount),
        penaltyAmount: positiveAmount(budget.penaltyAmount),
    };
}

export function allocateTransactionLinesFromComponentBudgets(
    schedules: ScheduleAllocationInput[],
    componentBudget: ComponentBudget
): { lines: TransactionLinePlan[]; summary: AllocationSummary; remainingBudget: ComponentBudget } {
    let remainingPrincipal = positiveAmount(componentBudget.principalAmount);
    let remainingInterest = positiveAmount(componentBudget.interestAmount);
    let remainingFees = positiveAmount(componentBudget.feesAmount);
    let remainingPenalty = positiveAmount(componentBudget.penaltyAmount);
    const lines: TransactionLinePlan[] = [];

    for (const schedule of schedules) {
        if (remainingPrincipal <= 0 && remainingInterest <= 0 && remainingFees <= 0 && remainingPenalty <= 0) {
            break;
        }

        const principalRemaining = positiveAmount(toAmount(schedule.principalDue) - toAmount(schedule.principalPaid));
        const interestRemaining = positiveAmount(toAmount(schedule.interestDue) - toAmount(schedule.interestPaid));
        const feesRemaining = positiveAmount(toAmount(schedule.feesDue) - toAmount(schedule.feesPaid));
        const penaltiesRemaining = positiveAmount(toAmount(schedule.penaltiesDue) - toAmount(schedule.penaltiesPaid));

        const penaltyAmount = Math.min(remainingPenalty, penaltiesRemaining);
        remainingPenalty -= penaltyAmount;

        const feesAmount = Math.min(remainingFees, feesRemaining);
        remainingFees -= feesAmount;

        const interestAmount = Math.min(remainingInterest, interestRemaining);
        remainingInterest -= interestAmount;

        const principalAmount = Math.min(remainingPrincipal, principalRemaining);
        remainingPrincipal -= principalAmount;

        const lineTotal = positiveAmount(penaltyAmount + feesAmount + interestAmount + principalAmount);
        if (lineTotal <= 0) {
            continue;
        }

        lines.push({
            scheduleId: schedule.id,
            installmentNo: schedule.installmentNo,
            dueDate: new Date(schedule.dueDate),
            principalAmount: positiveAmount(principalAmount),
            interestAmount: positiveAmount(interestAmount),
            feesAmount: positiveAmount(feesAmount),
            penaltyAmount: positiveAmount(penaltyAmount),
            lineTotal,
        });
    }

    return {
        lines,
        summary: buildSummary(lines),
        remainingBudget: {
            principalAmount: positiveAmount(remainingPrincipal),
            interestAmount: positiveAmount(remainingInterest),
            feesAmount: positiveAmount(remainingFees),
            penaltyAmount: positiveAmount(remainingPenalty),
        },
    };
}

export function allocateTransactionLines(
    schedules: ScheduleAllocationInput[],
    amount: number,
    mode: AllocationMode = 'default'
): { lines: TransactionLinePlan[]; summary: AllocationSummary; remainingAmount: number } {
    const budgets = toBudgetsFromAmount(schedules, amount, mode);
    const allocation = allocateTransactionLinesFromComponentBudgets(schedules, budgets);
    const allocatedTotal = allocation.summary.lineTotal;
    return {
        lines: allocation.lines,
        summary: allocation.summary,
        remainingAmount: positiveAmount(positiveAmount(amount) - allocatedTotal),
    };
}

export function transactionDateIsBeforeDueDate(transactionDate: Date, dueDate: Date): boolean {
    const txnDay = Date.UTC(
        transactionDate.getUTCFullYear(),
        transactionDate.getUTCMonth(),
        transactionDate.getUTCDate()
    );
    const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
    return txnDay < dueDay;
}
