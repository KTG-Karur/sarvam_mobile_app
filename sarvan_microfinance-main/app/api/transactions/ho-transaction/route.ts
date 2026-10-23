import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { z } from 'zod';
import { withRole, successResponse, errorResponse } from '@/app/lib/api-utils';
import { getBranchWorkingDayWindow, isInstantWithinWindow } from '@/app/lib/branch-working-day-guard';
import {
    GL_LEDGER_NAMES,
    GL_SELF_ACCOUNT_NAMES,
    GL_DEFAULT_GROUPS,
    resolveOrCreateLedger,
    resolveSelfAccount,
    getNextVoucherNo,
} from '@/app/lib/gl-config';
import { buildFinancialTransactionBranchScope } from '@/app/lib/filters/financial-transaction-branch';
import type { JWTPayload } from '@/app/lib/auth';
import type { FinancialTransactionType } from '@prisma/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HOTransactionType = 'HO_BORROW' | 'HO_REMITTANCE';

const HO_TRANSACTION_TYPES = ['HO_BORROW', 'HO_REMITTANCE'] as const;

const postSchema = z.object({
    transactionType: z.enum(HO_TRANSACTION_TYPES, {
        errorMap: () => ({ message: 'Transaction type must be HO_BORROW or HO_REMITTANCE' }),
    }),
    amount: z
        .number({ invalid_type_error: 'Amount must be a number' })
        .positive('Amount must be a positive number'),
    transactionDate: z.string().min(1, 'Transaction date is required'),
    /** Required when called by ADMIN; ignored (overridden by JWT branch) for BM/AM */
    branchId: z.string().optional(),
    description: z.string().max(500).optional(),
});

// ─── POST — create an HO Borrow or HO Remittance entry ───────────────────────

async function handlePost(req: NextRequest, user: JWTPayload) {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(rawBody);
    if (!parsed.success) {
        const msg = parsed.error.errors[0]?.message ?? 'Invalid request body';
        return errorResponse(msg, 400);
    }

    const { transactionType, amount, transactionDate: dateStr, branchId: bodyBranchId, description } =
        parsed.data;

    // ── Resolve effective branch ──────────────────────────────────────────────
    // Admin must supply branchId in the body (or the active-branch cookie already
    // merged into user.branchId by api-utils.getAuthenticatedUser).
    // BM/AM always operate on their own assigned branch.
    const effectiveBranchId =
        user.role === 'ADMIN'
            ? (bodyBranchId ?? user.branchId ?? null)
            : (user.branchId ?? null);

    if (!effectiveBranchId) {
        return errorResponse(
            user.role === 'ADMIN'
                ? 'Branch selection is required for admin HO transactions'
                : 'Your account has no branch context',
            400,
        );
    }

    const branch = await prisma.branch.findFirst({
        where: { id: effectiveBranchId, isActive: true },
        select: { id: true, name: true, code: true },
    });
    if (!branch) {
        return errorResponse('Branch not found or inactive', 404);
    }

    // ── Parse and validate date ───────────────────────────────────────────────
    const transactionDate = new Date(dateStr);
    if (isNaN(transactionDate.getTime())) {
        return errorResponse('Invalid transaction date format', 400);
    }

    // Admin may post for any date; BM/AM must be within the branch working-day window
    if (user.role !== 'ADMIN') {
        const workingDay = await getBranchWorkingDayWindow({ branchId: effectiveBranchId });
        if (!isInstantWithinWindow(transactionDate, workingDay)) {
            return errorResponse(
                `Transaction date must match the branch working day (${workingDay.workingDateYmd})`,
                409,
            );
        }
    }

    // ── Accounting mapping ────────────────────────────────────────────────────
    // HO_BORROW    → Branch receives cash from HO
    //   CASH_RECEIPT: Dr Cash in Hand  |  Cr HO Borrow  (liability)
    //
    // HO_REMITTANCE → Branch remits cash to HO (day final amount)
    //   CASH_PAYMENT: Dr HO Remittance (liability clears) | Cr Cash in Hand
    const isBorrow = transactionType === 'HO_BORROW';
    const financialTxnType = isBorrow ? ('CASH_RECEIPT' as const) : ('CASH_PAYMENT' as const);
    const voucherPrefix = isBorrow ? 'CR' : 'CP';
    const ledgerName = isBorrow ? GL_LEDGER_NAMES.HO_BORROW : GL_LEDGER_NAMES.HO_REMITTANCE;

    const narration =
        description?.trim() ||
        (isBorrow
            ? `HO Borrow — Cash received from Head Office | Branch: ${branch.name} (${branch.code})`
            : `HO Remittance — Day final amount remitted to HO | Branch: ${branch.name} (${branch.code})`);

    const created = await prisma.$transaction(async (tx) => {
        const cashSelfAccountId = await resolveSelfAccount(tx as Parameters<typeof resolveSelfAccount>[0], GL_SELF_ACCOUNT_NAMES.CASH_IN_HAND);
        const hoLedgerId = await resolveOrCreateLedger(tx as Parameters<typeof resolveOrCreateLedger>[0], ledgerName, GL_DEFAULT_GROUPS.LIABILITIES);
        const voucherNo = await getNextVoucherNo(tx as Parameters<typeof getNextVoucherNo>[0], voucherPrefix);

        return tx.financialTransaction.create({
            data: {
                voucherNo,
                transactionDate,
                type: financialTxnType,
                branchId: effectiveBranchId,
                selfAccountId: cashSelfAccountId,
                ledgerId: hoLedgerId,
                amount,
                description: narration,
                createdById: user.userId,
            },
        });
    });

    return successResponse(
        {
            id: created.id,
            voucherNo: created.voucherNo,
            transactionDate: created.transactionDate.toISOString().split('T')[0],
            transactionType,
            financialTxnType,
            amount: Number(created.amount),
            description: created.description,
            branchId: effectiveBranchId,
            branchName: branch.name,
            branchCode: branch.code,
        },
        `${isBorrow ? 'HO Borrow' : 'HO Remittance'} recorded successfully. Voucher: ${created.voucherNo}`,
        201,
    );
}

// ─── GET — paginated list of HO transactions for a branch/date ───────────────

async function handleGet(req: NextRequest, user: JWTPayload) {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date');
    const branchIdParam = searchParams.get('branchId');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));

    const effectiveBranchId =
        user.role === 'ADMIN'
            ? (branchIdParam ?? user.branchId ?? undefined)
            : (user.branchId ?? undefined);

    // Identify HO ledger IDs so we only return HO transactions, not all receipts/payments
    const hoLedgers = await prisma.accountLedger.findMany({
        where: {
            ledgerName: {
                in: [GL_LEDGER_NAMES.HO_BORROW, GL_LEDGER_NAMES.HO_REMITTANCE],
                mode: 'insensitive',
            },
        },
        select: { id: true, ledgerName: true },
    });

    if (hoLedgers.length === 0) {
        return successResponse({ transactions: [], totalCount: 0, totalPages: 0, page, pageSize });
    }

    const ledgerLookup = new Map(hoLedgers.map((l) => [l.id, l.ledgerName]));
    const hoLedgerIds = hoLedgers.map((l) => l.id);

    let dateFilter: Record<string, unknown> = {};
    if (dateParam) {
        const start = new Date(`${dateParam}T00:00:00.000Z`);
        const end = new Date(`${dateParam}T23:59:59.999Z`);
        dateFilter = { transactionDate: { gte: start, lte: end } };
    }

    const branchFilter = effectiveBranchId
        ? buildFinancialTransactionBranchScope({ branchId: effectiveBranchId })
        : {};

    const hoTxnTypes: FinancialTransactionType[] = ['CASH_RECEIPT', 'CASH_PAYMENT'];

    const where = {
        isActive: true,
        ledgerId: { in: hoLedgerIds },
        type: { in: hoTxnTypes },
        ...dateFilter,
        ...branchFilter,
    };

    const [totalCount, transactions] = await Promise.all([
        prisma.financialTransaction.count({ where }),
        prisma.financialTransaction.findMany({
            where,
            include: {
                ledger: { select: { id: true, ledgerName: true } },
                selfAccount: { select: { id: true, name: true } },
                createdBy: { select: { firstName: true, lastName: true } },
                branch: { select: { id: true, name: true, code: true } },
            },
            orderBy: [
                { transactionDate: 'desc' },
                { id: 'asc' },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
    ]);

    const rows = transactions.map((tx) => {
        const ledgerName = ledgerLookup.get(tx.ledgerId ?? '') ?? '';
        const isHoBorrow = ledgerName.toLowerCase().includes('borrow') || tx.type === 'CASH_RECEIPT';
        return {
            id: tx.id,
            voucherNo: tx.voucherNo,
            transactionDate: tx.transactionDate.toISOString().split('T')[0],
            transactionType: isHoBorrow ? ('HO_BORROW' as HOTransactionType) : ('HO_REMITTANCE' as HOTransactionType),
            amount: Number(tx.amount),
            description: tx.description ?? '',
            ledgerName,
            branchCode: tx.branch?.code ?? '',
            branchName: tx.branch?.name ?? '',
            createdBy: tx.createdBy ? `${tx.createdBy.firstName} ${tx.createdBy.lastName}` : 'System',
        };
    });

    return successResponse({
        transactions: rows,
        totalCount,
        totalPages: Math.ceil(totalCount / pageSize),
        page,
        pageSize,
    });
}

// ─── Export handlers with role guard ─────────────────────────────────────────

const ALLOWED_ROLES = ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'] as const;

export const GET = withRole([...ALLOWED_ROLES], handleGet);
export const POST = withRole([...ALLOWED_ROLES], handlePost);
