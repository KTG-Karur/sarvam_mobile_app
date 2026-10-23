import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import {
  GL_DEFAULT_GROUPS,
  GL_LEDGER_NAMES,
  GL_SELF_ACCOUNT_NAMES,
  getNextVoucherNo,
  resolveOrCreateLedger,
  resolveSelfAccount,
} from '@/app/lib/gl-config';

const postSchema = z.object({
  toBranchId: z.string().min(1, 'Destination branch is required'),
  mode: z.enum(['CASH', 'BANK'], { errorMap: () => ({ message: 'mode must be CASH or BANK' }) }),
  selfAccountId: z.string().min(1, 'selfAccountId is required'),
  amount: z.number().positive('Amount must be a positive number'),
  transferDate: z.string().min(1, 'Transfer date is required'), // yyyy-mm-dd or ISO
  narration: z.string().max(500).optional(),
});

/**
 * POST /api/transactions/inter-branch-transfer
 *
 * Creates a paired voucher set for an inter-branch transfer (HO → Branch):
 *  - HO leg:   PAYMENT  (Dr HO Remittance | Cr Cash/Bank)  — branchId = HO
 *  - Branch leg: RECEIPT (Dr Cash/Bank | Cr HO Borrow)     — branchId = destination branch
 *
 * Both vouchers + the linkage row are created atomically.
 */
export const POST = withRole(['ADMIN'], async (req: NextRequest, user) => {
  const rawBody = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(rawBody);
  if (!parsed.success) {
    return errorResponse(parsed.error.errors[0]?.message ?? 'Invalid request body', 400);
  }

  const { toBranchId, mode, selfAccountId: selectedSelfAccountId, amount, transferDate, narration } = parsed.data;

  const fromBranchId = user.branchId ?? null;
  if (!fromBranchId) {
    return errorResponse('Active branch context is required', 400);
  }

  const isHo = await isHeadOfficeBranch(fromBranchId);
  if (!isHo) {
    return errorResponse('Inter-branch transfer is only allowed while operating in Head Office branch', 403);
  }

  if (toBranchId === fromBranchId) {
    return errorResponse('Destination branch must be different from Head Office branch', 400);
  }

  const date = new Date(transferDate);
  if (Number.isNaN(date.getTime())) {
    return errorResponse('Invalid transferDate format', 400);
  }

  const fromVoucherPrefix = mode === 'CASH' ? 'CP' : 'BP';
  const toVoucherPrefix = mode === 'CASH' ? 'CR' : 'BR';

  const fromType = mode === 'CASH' ? ('CASH_PAYMENT' as const) : ('BANK_PAYMENT' as const);
  const toType = mode === 'CASH' ? ('CASH_RECEIPT' as const) : ('BANK_RECEIPT' as const);

  const result = await prisma.$transaction(async (tx) => {
    const [fromBranch, toBranch] = await Promise.all([
      tx.branch.findFirst({ where: { id: fromBranchId, isActive: true }, select: { id: true, name: true, code: true } }),
      tx.branch.findFirst({ where: { id: toBranchId, isActive: true }, select: { id: true, name: true, code: true } }),
    ]);

    if (!fromBranch) {
      throw new Error('Head Office branch not found or inactive');
    }
    if (!toBranch) {
      throw new Error('Destination branch not found or inactive');
    }
    if (toBranch.code === 'HO' || toBranch.name.toLowerCase() === 'head office') {
      throw new Error('Destination branch cannot be Head Office');
    }

    const selfAccount = await tx.selfAccount.findFirst({
      where: { id: selectedSelfAccountId, isActive: true },
      select: { id: true, name: true },
    });
    if (!selfAccount) {
      throw new Error('Selected self account not found or inactive');
    }

    const [hoRemittanceLedgerId, hoBorrowLedgerId, fromVoucherNo, toVoucherNo] = await Promise.all([
      resolveOrCreateLedger(tx as never, GL_LEDGER_NAMES.HO_REMITTANCE, GL_DEFAULT_GROUPS.LIABILITIES),
      resolveOrCreateLedger(tx as never, GL_LEDGER_NAMES.HO_BORROW, GL_DEFAULT_GROUPS.LIABILITIES),
      getNextVoucherNo(tx as never, fromVoucherPrefix),
      getNextVoucherNo(tx as never, toVoucherPrefix),
    ]);

    const cleanNarration = narration?.trim();
    const baseNarration =
      cleanNarration && cleanNarration.length > 0
        ? cleanNarration
        : `Inter-branch transfer ${fromBranch.code} → ${toBranch.code}`;

    const fromTxn = await tx.financialTransaction.create({
      data: {
        voucherNo: fromVoucherNo,
        transactionDate: date,
        type: fromType,
        branchId: fromBranch.id,
        // Payment: Dr ledger | Cr selfAccount
        ledgerId: hoRemittanceLedgerId,
        selfAccountId: selfAccount.id,
        amount,
        description: `HO Remittance — ${baseNarration} | To: ${toBranch.name} (${toBranch.code})`,
        createdById: user.userId,
      },
      select: { id: true, voucherNo: true },
    });

    const toTxn = await tx.financialTransaction.create({
      data: {
        voucherNo: toVoucherNo,
        transactionDate: date,
        type: toType,
        branchId: toBranch.id,
        // Receipt: Dr selfAccount | Cr ledger
        ledgerId: hoBorrowLedgerId,
        selfAccountId: selfAccount.id,
        amount,
        description: `HO Borrow — ${baseNarration} | From: ${fromBranch.name} (${fromBranch.code})`,
        createdById: user.userId,
      },
      select: { id: true, voucherNo: true },
    });

    const link = await tx.interBranchTransfer.create({
      data: {
        fromBranchId: fromBranch.id,
        toBranchId: toBranch.id,
        mode,
        status: 'POSTED',
        transferDate: date,
        amount,
        narration: baseNarration,
        fromTransactionId: fromTxn.id,
        toTransactionId: toTxn.id,
        createdById: user.userId,
      },
      select: { id: true },
    });

    return {
      transferId: link.id,
      from: { voucherNo: fromTxn.voucherNo, branchCode: fromBranch.code },
      to: { voucherNo: toTxn.voucherNo, branchCode: toBranch.code },
    };
  });

  return successResponse(
    result,
    `Inter-branch transfer posted successfully (HO: ${result.from.voucherNo}, Branch: ${result.to.voucherNo}).`,
    201
  );
});

