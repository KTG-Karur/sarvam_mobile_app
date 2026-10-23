import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    parseUploanWorkbook,
    type UploanRow,
    type CenterOverrides,
    type CenterSummary,
    type GroupSummary,
} from '@/app/lib/services/uploan-import.service';
import { validateUploanRows } from '@/app/lib/services/uploan-validate.service';
import { parseBranchWiseRepaymentWorkbook } from '@/app/lib/services/uploan-branch-repayment.service';
import { parseThriftOutstandingWorkbook } from '@/app/lib/services/uploan-thrift-outstanding.service';
import { parseGoldDetailsWorkbook } from '@/app/lib/services/uploan-gold-details.service';
import { uploadObject, downloadObject } from '@/app/lib/storage/gcs-client';
import { resolveUploanImportHistoryKey } from '@/app/lib/storage/gcs-path-resolver';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/uploan/member/preview
 *
 * First-load parse (multipart: member `file` + `repaymentFile`, both required) OR
 * re-validate after grid edits (JSON: `{ branchId, rows, historyFileKey }`) — both paths
 * funnel through the SAME `validateUploanRows` so first-load and re-validate can never
 * drift apart.
 *
 * The Branch Wise Repayment file can run to 15k+ rows for a full branch — rather than
 * round-tripping its parsed contents through the browser on every re-validate click (the
 * old per-member CSV flow's pattern, fine for a handful of small files, not for this), it
 * is uploaded to GCS exactly once on first load and referenced by `historyFileKey` from
 * then on; every call (including this one on re-validate, and later the import worker)
 * re-downloads + re-parses it from there.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const contentType = req.headers.get('content-type') || '';
            let branchId: string;
            let rows: UploanRow[];
            let centerOverrides: CenterOverrides = {};
            let keepCenters: CenterSummary[] = [];
            let keepGroups: GroupSummary[] = [];
            let historyFileKey: string;
            let thriftFileKey: string = '';
            let goldFileKey: string = '';

            if (contentType.includes('multipart/form-data')) {
                const formData = await req.formData();
                const file = formData.get('file') as File | null;
                const repaymentFile = formData.get('repaymentFile') as File | null;
                // Both optional — a branch with no gold loans, or no separate loan-advance
                // outstanding report handy, must still be able to import.
                const thriftFile = formData.get('thriftFile') as File | null;
                const goldDetailsFile = formData.get('goldDetailsFile') as File | null;
                branchId = String(formData.get('branchId') || '');
                if (!file) return errorResponse('Member Details Report file is required', 400);
                if (!repaymentFile) return errorResponse('Branch Wise Repayment file is required', 400);
                if (!branchId) return errorResponse('Branch is required', 400);

                const buffer = await file.arrayBuffer();
                rows = parseUploanWorkbook(buffer);
                if (rows.length === 0) return errorResponse('Member Details Report file is empty', 400);

                // Same upload id shared across every file from this preview call, so they land
                // in the same GCS folder — only the filename differentiates them.
                const uploadId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

                const repaymentBuffer = Buffer.from(await repaymentFile.arrayBuffer());
                historyFileKey = resolveUploanImportHistoryKey(uploadId, repaymentFile.name || 'branch-wise-repayment.xlsx');
                await uploadObject(
                    historyFileKey,
                    repaymentBuffer,
                    repaymentFile.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );

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
                rows = Array.isArray(body.rows) ? body.rows : [];
                centerOverrides = body.centerOverrides && typeof body.centerOverrides === 'object' ? body.centerOverrides : {};
                keepCenters = Array.isArray(body.keepCenters) ? body.keepCenters : [];
                keepGroups = Array.isArray(body.keepGroups) ? body.keepGroups : [];
                historyFileKey = String(body.historyFileKey || '');
                thriftFileKey = String(body.thriftFileKey || '');
                goldFileKey = String(body.goldFileKey || '');
                if (!branchId) return errorResponse('Branch is required', 400);
                if (rows.length === 0) return errorResponse('No rows to validate', 400);
                if (!historyFileKey) return errorResponse('historyFileKey is required to re-validate', 400);
            }

            const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
            if (!branch) return errorResponse('Branch not found', 404);

            const historyFile = await downloadObject(historyFileKey);
            if (!historyFile) return errorResponse('Branch Wise Repayment file could not be read back from storage — re-upload it', 400);
            const branchRepaymentByLoanId = parseBranchWiseRepaymentWorkbook(historyFile.buffer);

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

            const result = await validateUploanRows(
                prisma,
                rows,
                branchId,
                centerOverrides,
                branchRepaymentByLoanId,
                keepCenters,
                keepGroups,
                thriftOutstandingByMemberKey,
                goldDetailsByMemberKey
            );
            return successResponse({ ...result, historyFileKey, thriftFileKey, goldFileKey }, 'Preview validated');
        } catch (error) {
            console.error('[upload Preview] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to validate file', 500);
        }
    })(request);
}
