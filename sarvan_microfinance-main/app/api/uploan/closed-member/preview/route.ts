import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    parseClosedMemberWorkbook,
    type ClosedMemberRow,
} from '@/app/lib/services/closed-member-import.service';
import type { CenterOverrides, CenterSummary, GroupSummary } from '@/app/lib/services/uploan-import.service';
import { validateClosedMemberRows } from '@/app/lib/services/closed-member-validate.service';
import { parseThriftOutstandingWorkbook } from '@/app/lib/services/uploan-thrift-outstanding.service';
import { parseGoldDetailsWorkbook } from '@/app/lib/services/uploan-gold-details.service';
import { uploadObject, downloadObject } from '@/app/lib/storage/gcs-client';
import { resolveUploanImportHistoryKey } from '@/app/lib/storage/gcs-path-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/uploan/closed-member/preview
 *
 * First-load parse (multipart: `file` required, `thriftFile`/`goldDetailsFile` optional)
 * OR re-validate after grid edits (JSON) — both funnel through the same
 * validateClosedMemberRows. No Branch Wise Repayment file in this flow (the loan is
 * already closed — nothing to replay), so this route is a lighter version of
 * /api/uploan/member/preview.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const contentType = req.headers.get('content-type') || '';
            let branchId: string;
            let createLoan: boolean;
            let rows: ClosedMemberRow[];
            let centerOverrides: CenterOverrides = {};
            let keepCenters: CenterSummary[] = [];
            let keepGroups: GroupSummary[] = [];
            let thriftFileKey: string = '';
            let goldFileKey: string = '';

            if (contentType.includes('multipart/form-data')) {
                const formData = await req.formData();
                const file = formData.get('file') as File | null;
                const thriftFile = formData.get('thriftFile') as File | null;
                const goldDetailsFile = formData.get('goldDetailsFile') as File | null;
                branchId = String(formData.get('branchId') || '');
                createLoan = String(formData.get('createLoan') || '') === 'true';
                if (!file) return errorResponse('Member file is required', 400);
                if (!branchId) return errorResponse('Branch is required', 400);

                const buffer = await file.arrayBuffer();
                rows = parseClosedMemberWorkbook(buffer);
                if (rows.length === 0) return errorResponse('Member file is empty', 400);

                const uploadId = `closed-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

                if (thriftFile) {
                    const thriftBuffer = Buffer.from(await thriftFile.arrayBuffer());
                    thriftFileKey = resolveUploanImportHistoryKey(uploadId, thriftFile.name || 'thrift-outstanding.xlsx');
                    await uploadObject(
                        thriftFileKey,
                        thriftBuffer,
                        thriftFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    );
                }
                if (goldDetailsFile) {
                    const goldBuffer = Buffer.from(await goldDetailsFile.arrayBuffer());
                    goldFileKey = resolveUploanImportHistoryKey(uploadId, goldDetailsFile.name || 'gold-loan-details.xlsx');
                    await uploadObject(
                        goldFileKey,
                        goldBuffer,
                        goldDetailsFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                    );
                }
            } else {
                const body = await req.json();
                branchId = String(body.branchId || '');
                createLoan = Boolean(body.createLoan);
                rows = Array.isArray(body.rows) ? body.rows : [];
                centerOverrides = body.centerOverrides && typeof body.centerOverrides === 'object' ? body.centerOverrides : {};
                keepCenters = Array.isArray(body.keepCenters) ? body.keepCenters : [];
                keepGroups = Array.isArray(body.keepGroups) ? body.keepGroups : [];
                thriftFileKey = String(body.thriftFileKey || '');
                goldFileKey = String(body.goldFileKey || '');
                if (!branchId) return errorResponse('Branch is required', 400);
                if (rows.length === 0) return errorResponse('No rows to validate', 400);
            }

            const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
            if (!branch) return errorResponse('Branch not found', 404);

            let thriftOutstandingByMemberKey = new Map<string, number>();
            if (thriftFileKey) {
                const thriftFile = await downloadObject(thriftFileKey);
                if (!thriftFile) return errorResponse('Loan-Advance Outstanding Report could not be read back from storage — re-upload it', 400);
                thriftOutstandingByMemberKey = parseThriftOutstandingWorkbook(thriftFile.buffer);
            }
            let goldDetailsByMemberKey = new Map();
            if (goldFileKey) {
                const goldFile = await downloadObject(goldFileKey);
                if (!goldFile) return errorResponse('Gold Loan Details file could not be read back from storage — re-upload it', 400);
                goldDetailsByMemberKey = parseGoldDetailsWorkbook(goldFile.buffer);
            }

            const result = await validateClosedMemberRows(
                prisma,
                rows,
                branchId,
                createLoan,
                centerOverrides,
                keepCenters,
                keepGroups,
                thriftOutstandingByMemberKey,
                goldDetailsByMemberKey
            );
            return successResponse({ ...result, createLoan, thriftFileKey, goldFileKey }, 'Preview validated');
        } catch (error) {
            console.error('[closed-member Preview] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to validate file', 500);
        }
    })(request);
}
