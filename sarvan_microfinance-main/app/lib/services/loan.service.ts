import { prisma } from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import type { LoanApplicationData } from '@/app/lib/validations/loan.validation';
import { Decimal } from '@prisma/client/runtime/library';
import { addDays, addWeeks, format } from 'date-fns';
import {
    generateDailyRepaymentDates,
    type DailyScheduleConfig,
} from '@/app/lib/schedule/daily-schedule';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { MONTHLY_INTERVAL_DAYS, QUARTERLY_INTERVAL_DAYS } from '@/app/lib/loan-frequency';

interface ScheduleItem {
    installmentNo: number;
    dueDate: Date;
    principalDue: number;
    interestDue: number;
    feesDue: number;
     savingsDue: number;
    totalDue: number;
}

/**
 * Service for handling loan operations
 */
export class LoanService {
    /**
     * Generate unique loan number with retry logic to handle race conditions
     * Format: LN + Year + Sequential Number (6 digits)
     */
    // Next sequential numeric loan number. Reads only the current maximum (numeric
    // loan numbers only — imported/legacy non-numeric ones are ignored) instead of
    // loading every loan row, which made each loan creation take seconds.
    // Uniqueness is ultimately enforced by Loan.loanNumber @unique — callers retry
    // the insert on a collision (see createLoanApplication).
    private async generateLoanNumber(): Promise<string> {
        const rows = await prisma.$queryRaw<{ max: bigint | null }[]>`
            SELECT MAX(CAST("loanNumber" AS BIGINT)) AS max
            FROM "loans"
            WHERE "loanNumber" ~ '^[0-9]+$'
        `;
        const maxNum = Number(rows[0]?.max ?? 0);
        return (maxNum + 1).toString().padStart(6, '0');
    }

    /**
     * Create a new loan application
     */
    async createLoanApplication(
        data: LoanApplicationData,
        createdById: string,
        options?: { skipRoleCheck?: boolean }
    ): Promise<{ success: boolean; loanId?: string; loanNumber?: string; error?: string }> {
        try {
            // Validate client exists and is verified
            const client = await prisma.client.findUnique({
                where: { id: data.clientId },
                select: {
                    id: true,
                    clientId: true,
                    centerId: true,
                    verificationStatus: true,
                    isDefaultMember: true,
                    defaultMemberReason: true,
                    center: {
                        select: {
                            id: true,
                            branchId: true,
                        },
                    },
                },
            });

            if (!client) {
                return { success: false, error: 'Client not found' };
            }

            // Admin/Sub Admin-flagged Default Member — blocks new loan applications
            // only; any loan already in progress is unaffected.
            if (client.isDefaultMember) {
                return {
                    success: false,
                    error: client.defaultMemberReason
                        ? `This member is marked as a Default Member and cannot be given a new loan: ${client.defaultMemberReason}`
                        : 'This member is marked as a Default Member and cannot be given a new loan',
                };
            }

            // Only verified clients can apply for loans
            if (client.verificationStatus !== 'VERIFIED') {
                return {
                    success: false,
                    error: 'Client must be verified before applying for a loan',
                };
            }

            // Verify center matches client's center
            if (client.centerId !== data.centerId) {
                return {
                    success: false,
                    error: 'Center does not match client center',
                };
            }

            // Verify center exists
            const center = await prisma.center.findUnique({
                where: { id: data.centerId },
                select: {
                    id: true,
                    branchId: true,
                },
            });

            if (!center) {
                return { success: false, error: 'Center not found' };
            }

            // NEW: Validate loan purpose exists and is active
            const loanPurpose = await prisma.loanPurpose.findFirst({
                where: {
                    id: data.loanPurposeId,
                    isActive: true,
                },
                include: {
                    loanPurposeType: true,
                },
            });

            if (!loanPurpose) {
                return { success: false, error: 'Invalid or inactive loan purpose selected' };
            }

            // Verify user (FDO) has permission to create loan for this center
            const user = await prisma.user.findUnique({
                where: { id: createdById },
                select: {
                    id: true,
                    role: true,
                    branchId: true,
                    assignedCenters: {
                        select: { id: true },
                    },
                },
            });

            if (!user) {
                return { success: false, error: 'User not found' };
            }

            // FDO must be assigned to the center or be a BRANCH_MANAGER/AREA_MANAGER.
            // Skipped when the caller is the system's own auto-loan-creation hook
            // (already gated to Admin/SubAdmin by the approval action route itself).
            if (!options?.skipRoleCheck) {
                if (user.role === 'FDO') {
                    const isAssignedToCenter = user.assignedCenters.some(
                        (c) => c.id === data.centerId
                    );
                    if (!isAssignedToCenter) {
                        return {
                            success: false,
                            error: 'You are not assigned to this center',
                        };
                    }
                } else if (user.role === 'BRANCH_MANAGER' || user.role === 'AREA_MANAGER') {
                    // Branch Manager/Area Manager must be from the same branch
                    if (user.branchId !== center.branchId) {
                        return {
                            success: false,
                            error: 'Center does not belong to your branch',
                        };
                    }
                } else if (user.role !== 'ADMIN') {
                    return {
                        success: false,
                        error: 'Insufficient permissions to create loan application',
                    };
                }
            }

            // If a co-applicant was selected, it must belong to this client and be
            // past full approval (APPROVED or currently ACTIVE) — never a pending
            // or rejected one. Fetched before the transaction so a bad selection
            // fails fast without generating a loan number for nothing.
            const selectedCoApplicantRecord = data.coApplicantId
                ? await prisma.coApplicant.findUnique({
                    where: { id: data.coApplicantId },
                    select: {
                        id: true, clientId: true, status: true,
                        name: true, gender: true, dateOfBirth: true, age: true,
                        relationWithClient: true, mobileNumber: true, voterIdNo: true,
                        otherIdNo: true, pancardNo: true,
                        economicActivityType: { select: { name: true } },
                        economicActivity: { select: { name: true } },
                    },
                })
                : null;

            if (data.coApplicantId) {
                if (!selectedCoApplicantRecord) {
                    return { success: false, error: 'Selected co-applicant not found' };
                }
                if (selectedCoApplicantRecord.clientId !== data.clientId) {
                    return { success: false, error: 'Selected co-applicant does not belong to this client' };
                }
                if (selectedCoApplicantRecord.status !== 'APPROVED' && selectedCoApplicantRecord.status !== 'ACTIVE') {
                    return { success: false, error: 'Selected co-applicant has not completed approval' };
                }
            }
            const selectedCoApplicant = selectedCoApplicantRecord;

            // Create loan + (optional) co-applicant snapshot atomically — the
            // snapshot freezes whoever was active/approved at this exact moment,
            // independent of whatever the client's co-applicant later becomes.
            // Two creations racing for the same next loan number hit the
            // loanNumber unique constraint — regenerate and retry instead of failing.
            const MAX_NUMBER_ATTEMPTS = 5;
            const createWithNumber = (loanNumber: string) => prisma.$transaction(async (tx) => {
                const created = await tx.loan.create({
                    data: {
                        loanNumber,
                        clientId: data.clientId,
                        centerId: data.centerId,
                        branchId: center.branchId,
                        loanProductId: data.loanProductId,
                        amount: new Decimal(data.amount),
                        appliedAmount: new Decimal(data.amount),
                        interestRate: new Decimal(data.interestRate),
                        tenureMonths: data.tenureMonths,
                        frequency: data.frequency,
                        loanPurposeId: data.loanPurposeId, // Changed from purpose
                        createdById,
                        applicationStatus: 'PENDING_VERIFICATION',
                        disbursementStatus: 'PENDING_LEVEL1',
                    },
                    select: {
                        id: true,
                        loanNumber: true,
                        amount: true,
                        interestRate: true,
                        tenureMonths: true,
                        applicationStatus: true,
                        createdAt: true,
                    },
                });

                if (selectedCoApplicant) {
                    await tx.loanCoApplicantSnapshot.create({
                        data: {
                            loanId: created.id,
                            sourceCoApplicantId: selectedCoApplicant.id,
                            name: selectedCoApplicant.name,
                            gender: selectedCoApplicant.gender,
                            dateOfBirth: selectedCoApplicant.dateOfBirth,
                            age: selectedCoApplicant.age,
                            relationWithClient: selectedCoApplicant.relationWithClient,
                            mobileNumber: selectedCoApplicant.mobileNumber,
                            voterIdNo: selectedCoApplicant.voterIdNo,
                            otherIdNo: selectedCoApplicant.otherIdNo,
                            pancardNo: selectedCoApplicant.pancardNo,
                            economicActivityTypeName: selectedCoApplicant.economicActivityType?.name ?? null,
                            economicActivityName: selectedCoApplicant.economicActivity?.name ?? null,
                            createdById,
                        },
                    });
                }

                return created;
            });

            let loan: Awaited<ReturnType<typeof createWithNumber>> | null = null;
            for (let attempt = 1; !loan; attempt++) {
                try {
                    loan = await createWithNumber(await this.generateLoanNumber());
                } catch (err) {
                    const isNumberClash =
                        err instanceof Prisma.PrismaClientKnownRequestError &&
                        err.code === 'P2002' &&
                        JSON.stringify(err.meta?.target ?? '').includes('loanNumber');
                    if (!isNumberClash || attempt >= MAX_NUMBER_ATTEMPTS) throw err;
                    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 150));
                }
            }

            return {
                success: true,
                loanId: loan.id,
                loanNumber: loan.loanNumber,
            };
        } catch (error) {
            console.error('Error creating loan application:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to create loan application',
            };
        }
    }

    /**
     * Get loans for a client
     */
    async getClientLoans(clientId: string): Promise<{
        success: boolean;
        loans?: Array<{
            id: string;
            loanNumber: string;
            amount: Decimal;
            interestRate: Decimal;
            tenureMonths: number;
            applicationStatus: string;
            disbursementStatus: string;
            createdAt: Date;
        }>;
        error?: string;
    }> {
        try {
            const loans = await prisma.loan.findMany({
                where: {
                    clientId,
                    isActive: true,
                },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    interestRate: true,
                    tenureMonths: true,
                    applicationStatus: true,
                    disbursementStatus: true,
                    createdAt: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return {
                success: true,
                loans: loans.map((loan) => ({
                    ...loan,
                    amount: loan.amount,
                    interestRate: loan.interestRate,
                })),
            };
        } catch (error) {
            console.error('Error fetching client loans:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch loans',
            };
        }
    }

    /**
     * Get loans with filters
     */
    async getLoans(filters: {
        centerId?: string;
        clientId?: string;
        branchId?: string | { in: string[] };
        createdById?: string;
        applicationStatus?: string;
        disbursementStatus?: string;
        page?: number;
        pageSize?: number;
        includeInactive?: boolean;
    }): Promise<{
        success: boolean;
        loans?: Array<{
            id: string;
            loanNumber: string;
            clientId: string;
            clientName: string;
            centerId: string;
            centerName: string;
            amount: Decimal;
            interestRate: Decimal;
            tenureMonths: number;
            applicationStatus: string;
            disbursementStatus: string;
            loanStatus: string;
            createdAt: Date;
            indexId: string | null;
            createdById: string;
            purpose?: string | null;
            loanPurpose?: {
                id: string;
                name: string;
                loanPurposeType?: {
                    id: string;
                    name: string;
                };
            } | null;
        }>;
        pagination?: {
            currentPage: number;
            pageSize: number;
            totalItems: number;
            totalPages: number;
        };
        error?: string;
    }> {
        try {
            const where: any = {};

            // Default (and existing behavior for every other caller) is active-only;
            // includeInactive lets closed-loan filters (e.g. Loan Ledger's "Closed Loans"
            // tab) see loans that were foreclosed, written off, or auto-closed on final payment.
            if (!filters.includeInactive) {
                where.isActive = true;
            }

            if (filters.centerId) {
                where.centerId = filters.centerId;
            }

            if (filters.clientId) {
                where.clientId = filters.clientId;
            }

            if (filters.branchId) {
                where.branchId = filters.branchId;
            }

            if (filters.createdById) {
                where.createdById = filters.createdById;
            }

            if (filters.applicationStatus) {
                where.applicationStatus = filters.applicationStatus;
            }

            if (filters.disbursementStatus) {
                where.disbursementStatus = filters.disbursementStatus;
            }

            const page = filters.page || 1;
            const pageSize = filters.pageSize || 10;
            const skip = (page - 1) * pageSize;

            const [loans, totalItems] = await Promise.all([
                prisma.loan.findMany({
                    where,
                    select: {
                        id: true,
                        loanNumber: true,
                        clientId: true,
                        client: {
                            select: {
                                firstName: true,
                                lastName: true,
                                clientId: true,
                            },
                        },
                        centerId: true,
                        center: {
                            select: {
                                name: true,
                                code: true,
                            },
                        },
                        amount: true,
                        interestRate: true,
                        tenureMonths: true,
                        applicationStatus: true,
                        disbursementStatus: true,
                        closedDate: true,
                        createdAt: true,
                        indexId: true,
                        createdById: true,
                        loanPurposeId: true,
                        loanPurpose: {
                            select: {
                                id: true,
                                name: true,
                                loanPurposeType: {
                                    select: {
                                        id: true,
                                        name: true,
                                    },
                                },
                            },
                        },
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    skip,
                    take: pageSize,
                }),
                prisma.loan.count({ where }),
            ]);

            const totalPages = Math.ceil(totalItems / pageSize);

            return {
                success: true,
                loans: loans.map((loan) => ({
                    id: loan.id,
                    loanNumber: loan.loanNumber,
                    clientId: loan.clientId,
                    clientName: `${loan.client.clientId} - ${loan.client.firstName} ${loan.client.lastName}`,
                    centerId: loan.centerId,
                    centerName: `${loan.center.code} - ${loan.center.name}`,
                    amount: loan.amount,
                    interestRate: loan.interestRate,
                    tenureMonths: loan.tenureMonths,
                    applicationStatus: loan.applicationStatus,
                    disbursementStatus: loan.disbursementStatus,
                    loanStatus: loan.closedDate ? 'CLOSED' : 'OPEN',
                    createdAt: loan.createdAt,
                    indexId: loan.indexId,
                    createdById: loan.createdById,
                    loanPurpose: loan.loanPurpose,
                })),
                pagination: {
                    currentPage: page,
                    pageSize: pageSize,
                    totalItems,
                    totalPages,
                },
            };
        } catch (error) {
            console.error('Error fetching loans:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch loans',
            };
        }
    }


    /**
     * Calculate loan schedule based on loan details and product terms
     * Supports both FLAT and REDUCING (custom template) interest methods
     * BUSINESS RULE: Fees are collected upfront by FO, NOT in the schedule
     */
    calculateSchedule(
        loan: {
            amount: Decimal;
            interestRate: Decimal;
            tenureMonths: number;
            frequency?: string | null;
        },
        product: {
            numberOfDues: number;
            interestAmount?: Decimal | null;
            interestMethod?: string;
            documentCharges?: Decimal | null;
            insuranceFees?: Decimal | null;
        } | null,
        startDate: Date,
        scheduleTemplates?: Array<{
            installmentNo: number;
            principalAmount: Decimal | number;
            interestAmount: Decimal | number;
        }>,
        dailyConfig?: DailyScheduleConfig
    ): ScheduleItem[] {
        const principalAmount = Number(loan.amount);
        const rate = Number(loan.interestRate);
        const freq = loan.frequency?.toUpperCase() || 'WEEKLY';

        // 1. Determine Number of Dues
        let numberOfDues = 0;
        if (product && product.numberOfDues > 0) {
            numberOfDues = product.numberOfDues;
        } else {
            if (freq === 'WEEKLY') numberOfDues = loan.tenureMonths * 4;
            else if (freq === 'BIWEEKLY' || freq === 'FORTHNIGHT') numberOfDues = Math.ceil(loan.tenureMonths * 2.16);
            else if (freq === 'MONTHLY') numberOfDues = loan.tenureMonths;
            else if (freq === 'DAILY') numberOfDues = loan.tenureMonths * 30;
            else numberOfDues = loan.tenureMonths;
        }

        const schedule: ScheduleItem[] = [];
        let currentDate = new Date(startDate);

        // 2. Check if we have custom schedule templates (REDUCING balance)
        if (scheduleTemplates && scheduleTemplates.length > 0) {
            if (freq === 'DAILY') {
                const dailyResult = generateDailyRepaymentDates(
                    startDate,
                    scheduleTemplates.length,
                    dailyConfig,
                );
                for (let idx = 0; idx < scheduleTemplates.length; idx++) {
                    const template = scheduleTemplates[idx];
                    const principal = Number(template.principalAmount);
                    const interest = Number(template.interestAmount);

                    schedule.push({
                        installmentNo: template.installmentNo,
                        dueDate: dailyResult.dates[idx].date,
                        principalDue: Number(principal.toFixed(2)),
                        interestDue: Number(interest.toFixed(2)),
                        feesDue: 0,
                        savingsDue: 0,
                        totalDue: Number((principal + interest).toFixed(2)),
                    });
                }

                console.log(
                    `[LoanSchedule] DAILY REDUCING: ${dailyResult.dates.length} dues, ` +
                    `first=${dailyResult.dates[0]?.isoDate}, skipped=${dailyResult.skippedDays.length} days`
                );
                return schedule;
            }

            for (const template of scheduleTemplates) {
                currentDate = this.advanceDate(currentDate, freq);

                const principal = Number(template.principalAmount);
                const interest = Number(template.interestAmount);

                schedule.push({
                    installmentNo: template.installmentNo,
                    dueDate: new Date(currentDate),
                    principalDue: Number(principal.toFixed(2)),
                    interestDue: Number(interest.toFixed(2)),
                    feesDue: 0,
                    savingsDue: 0,
                    totalDue: Number((principal + interest).toFixed(2)),
                });
            }
            return schedule;
        }

        // 3. FLAT method: equal principal and interest per installment
        const totalInterest = product?.interestAmount
            ? Number(product.interestAmount)
            : (principalAmount * rate) / 100;

        const principalPerInstallment = principalAmount / numberOfDues;
        const interestPerInstallment = totalInterest / numberOfDues;

        // 3a. DAILY frequency — use working-day-aware date generation
        if (freq === 'DAILY') {
            const dailyResult = generateDailyRepaymentDates(
                startDate,
                numberOfDues,
                dailyConfig,
            );

            for (const entry of dailyResult.dates) {
                const totalDue = principalPerInstallment + interestPerInstallment;

                schedule.push({
                    installmentNo: entry.installmentNo,
                    dueDate: entry.date,
                    principalDue: Number(principalPerInstallment.toFixed(2)),
                    interestDue: Number(interestPerInstallment.toFixed(2)),
                    feesDue: 0,
                    savingsDue: 0,
                    totalDue: Number(totalDue.toFixed(2)),
                });
            }

            console.log(
                `[LoanSchedule] DAILY FLAT: ${dailyResult.dates.length} dues, ` +
                `first=${dailyResult.dates[0]?.isoDate}, skipped=${dailyResult.skippedDays.length} days`
            );
            return schedule;
        }

        // 3b. Non-daily frequencies — existing advancing logic
        for (let i = 1; i <= numberOfDues; i++) {
            currentDate = this.advanceDate(currentDate, freq);

            const totalDue = principalPerInstallment + interestPerInstallment;

            schedule.push({
                installmentNo: i,
                dueDate: new Date(currentDate),
                principalDue: Number(principalPerInstallment.toFixed(2)),
                interestDue: Number(interestPerInstallment.toFixed(2)),
                feesDue: 0,
                savingsDue: 0,
                totalDue: Number(totalDue.toFixed(2)),
            });
        }

        return schedule;
    }

    /**
     * Calculate schedule where installment 1 dueDate = firstDueDate,
     * installment 2 = firstDueDate + 1 frequency, etc.
     * Used by BM final disbursement (BM manually selects first due date).
     */
    calculateScheduleFromFirstDueDate(
        loan: {
            amount: Decimal;
            interestRate: Decimal;
            tenureMonths: number;
            frequency?: string | null;
        },
        product: {
            numberOfDues: number;
            interestAmount?: Decimal | null;
            interestMethod?: string;
            documentCharges?: Decimal | null;
            insuranceFees?: Decimal | null;
            advanceSavingsAmount?: Decimal | null;
        } | null,
        firstDueDate: Date,
        scheduleTemplates?: Array<{
            installmentNo: number;
            principalAmount: Decimal | number;
            interestAmount: Decimal | number;
        }>
    ): ScheduleItem[] {
        const principalAmount = Number(loan.amount);
        const rate = Number(loan.interestRate);
        const freq = loan.frequency?.toUpperCase() || 'WEEKLY';

        let numberOfDues = 0;
        if (product && product.numberOfDues > 0) {
            numberOfDues = product.numberOfDues;
        } else {
            if (freq === 'WEEKLY') numberOfDues = loan.tenureMonths * 4;
            else if (freq === 'BIWEEKLY' || freq === 'FORTHNIGHT') numberOfDues = Math.ceil(loan.tenureMonths * 2.16);
            else if (freq === 'MONTHLY') numberOfDues = loan.tenureMonths;
            else if (freq === 'DAILY') numberOfDues = loan.tenureMonths * 30;
            else numberOfDues = loan.tenureMonths;
        }

        const schedule: ScheduleItem[] = [];
        const savingsPerInstallment = product?.advanceSavingsAmount
            ? Number(Number(product.advanceSavingsAmount).toFixed(2))
            : 100;

        // Custom schedule templates (REDUCING balance)
        if (scheduleTemplates && scheduleTemplates.length > 0) {
            for (let idx = 0; idx < scheduleTemplates.length; idx++) {
                const template = scheduleTemplates[idx];
                const principal = Number(template.principalAmount);
                const interest = Number(template.interestAmount);
                const dueDate = idx === 0
                    ? new Date(firstDueDate)
                    : this.advanceDateN(firstDueDate, freq, idx);

                schedule.push({
                    installmentNo: template.installmentNo,
                    dueDate,
                    principalDue: Number(principal.toFixed(2)),
                    interestDue: Number(interest.toFixed(2)),
                    feesDue: 0,
                    savingsDue: savingsPerInstallment,
                    totalDue: Number((principal + interest).toFixed(2)),
                });
            }
            return schedule;
        }

        // FLAT method
        const totalInterest = product?.interestAmount
            ? Number(product.interestAmount)
            : (principalAmount * rate) / 100;

        const principalPerInstallment = principalAmount / numberOfDues;
        const interestPerInstallment = totalInterest / numberOfDues;

        for (let i = 1; i <= numberOfDues; i++) {
            const dueDate = i === 1
                ? new Date(firstDueDate)
                : this.advanceDateN(firstDueDate, freq, i - 1);

            schedule.push({
                installmentNo: i,
                dueDate,
                principalDue: Number(principalPerInstallment.toFixed(2)),
                interestDue: Number(interestPerInstallment.toFixed(2)),
                feesDue: 0,
                savingsDue: savingsPerInstallment,
                totalDue: Number((principalPerInstallment + interestPerInstallment).toFixed(2)),
            });
        }

        return schedule;
    }

    /**
     * Advance a date based on frequency
     */
    private advanceDate(date: Date, frequency: string): Date {
        if (frequency === 'WEEKLY') return addWeeks(date, 1);
        if (frequency === 'BIWEEKLY' || frequency === 'FORTHNIGHT') return addWeeks(date, 2);
        if (frequency === 'MONTHLY') return addDays(date, MONTHLY_INTERVAL_DAYS);
        if (frequency === 'QUARTERLY') return addDays(date, QUARTERLY_INTERVAL_DAYS);
        if (frequency === 'DAILY') return addDays(date, 1);
        return addDays(date, 30);
    }

    private advanceDateN(baseDate: Date, frequency: string, steps: number): Date {
        if (frequency === 'WEEKLY') return addWeeks(new Date(baseDate), steps);
        if (frequency === 'BIWEEKLY' || frequency === 'FORTHNIGHT') return addWeeks(new Date(baseDate), steps * 2);
        if (frequency === 'MONTHLY') return addDays(new Date(baseDate), steps * MONTHLY_INTERVAL_DAYS);
        if (frequency === 'QUARTERLY') return addDays(new Date(baseDate), steps * QUARTERLY_INTERVAL_DAYS);
        if (frequency === 'DAILY') return addDays(new Date(baseDate), steps);
        return addDays(new Date(baseDate), steps * 30);
    }

    /**
     * Generate and persist loan schedule to database
     * Called at DISBURSEMENT time — this is the ONLY time schedules should be persisted
     * 
     * @param loanId - The loan to generate schedule for
     * @param disbursementDate - The date of disbursement (schedule starts from this date)
     * @returns The generated schedule items
     */
    async generateAndPersistSchedule(
        loanId: string,
        disbursementDate: Date
    ): Promise<{ success: boolean; scheduleCount?: number; error?: string }> {
        try {
            // 1. Fetch loan with product and schedule templates
            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                include: {
                    loanProduct: {
                        include: {
                            scheduleTemplates: {
                                orderBy: { installmentNo: 'asc' },
                            },
                        },
                    },
                },
            });

            if (!loan) {
                return { success: false, error: 'Loan not found' };
            }

            if (!loan.loanProduct) {
                return { success: false, error: 'Loan product not found' };
            }

            // 2. Delete any existing schedule (in case of re-disbursement)
            await prisma.loanSchedule.deleteMany({
                where: { loanId },
            });

            // 3. Calculate the schedule
            const product = loan.loanProduct;
            const scheduleItems = this.calculateSchedule(
                {
                    amount: loan.amount,
                    interestRate: loan.interestRate,
                    tenureMonths: loan.tenureMonths,
                    frequency: loan.frequency,
                },
                {
                    numberOfDues: product.numberOfDues,
                    interestAmount: product.interestAmount,
                    interestMethod: product.interestMethod ?? undefined,
                    documentCharges: product.documentCharges,
                    insuranceFees: product.insuranceFees,
                },
                disbursementDate,
                product.scheduleTemplates.length > 0 ? product.scheduleTemplates : undefined
            );

            // 4. Persist all schedule items to the database
            if (scheduleItems.length > 0) {
                await prisma.loanSchedule.createMany({
                    data: scheduleItems.map((item) => ({
                        loanId,
                        installmentNo: item.installmentNo,
                        dueDate: item.dueDate,
                        principalDue: item.principalDue,
                        interestDue: item.interestDue,
                        feesDue: item.feesDue,
                        savingsDue: item.savingsDue || 0,
                        totalDue: item.totalDue,
                        principalPaid: 0,
                        interestPaid: 0,
                        feesPaid: 0,
                        totalPaid: 0,
                        status: 'PENDING',
                    })),
                });
            }

            const freq = loan.frequency?.toUpperCase() || 'WEEKLY';
            console.log(
                `[LoanService] Generated ${scheduleItems.length} schedule items for loan ${loanId} ` +
                `(freq=${freq}, disbursement=${disbursementDate.toISOString()}, ` +
                `firstDue=${scheduleItems[0]?.dueDate.toISOString() ?? 'N/A'})`
            );

            return {
                success: true,
                scheduleCount: scheduleItems.length,
            };
        } catch (error) {
            console.error('Error generating/persisting schedule:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to generate schedule',
            };
        }
    }
}

export const loanService = new LoanService();

