import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    type UploanRow,
    type ValidatedUploanRow,
    type CenterOverrides,
    type CenterSummary,
    type GroupSummary,
} from '@/app/lib/services/uploan-import.service';
import { validateUploanRows } from '@/app/lib/services/uploan-validate.service';
import { parseBranchWiseRepaymentWorkbook } from '@/app/lib/services/uploan-branch-repayment.service';
import { parseThriftOutstandingWorkbook } from '@/app/lib/services/uploan-thrift-outstanding.service';
import { parseGoldDetailsWorkbook } from '@/app/lib/services/uploan-gold-details.service';
import type { UploanJobRowData } from '@/app/lib/services/uploan-import-row.service';
import { resolveCenterCode } from '@/app/lib/services/center-code.service';
import { createNextGroupForCenter } from '@/app/lib/services/group-assignment.service';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/uploan/member/import/start
 *
 * Re-validates server-side (never trusts the client's VALID flag) and resolves/creates
 * every Center -> Group up front (small, fast — unchanged from the old synchronous import
 * route), then persists one UploanImportJobRow per row and returns immediately. The
 * actual Client/Loan creation (up to ~60+ replayed transactions per row, 600+ rows for a
 * full branch) runs in the background — see app/lib/services/uploan-import-worker.ts —
 * because it cannot fit in a single request/response cycle.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const branchId = String(body.branchId || '');
            const rows: UploanRow[] = Array.isArray(body.rows) ? body.rows : [];
            const centerOverrides: CenterOverrides =
                body.centerOverrides && typeof body.centerOverrides === 'object' ? body.centerOverrides : {};
            const keepCenters: CenterSummary[] = Array.isArray(body.keepCenters) ? body.keepCenters : [];
            const keepGroups: GroupSummary[] = Array.isArray(body.keepGroups) ? body.keepGroups : [];
            const historyFileKey = String(body.historyFileKey || '');
            const thriftFileKey = String(body.thriftFileKey || '');
            const goldFileKey = String(body.goldFileKey || '');

            if (!branchId) return errorResponse('Branch is required', 400);
            if (rows.length === 0) return errorResponse('No rows to import', 400);
            if (!historyFileKey) return errorResponse('historyFileKey is required', 400);

            const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true, code: true } });
            if (!branch) return errorResponse('Branch not found', 404);
            const branchCode = branch.code || '0';

            const historyFile = await downloadObject(historyFileKey);
            if (!historyFile) return errorResponse('Branch Wise Repayment file could not be read back from storage — re-upload it', 400);
            const branchRepaymentByLoanId = parseBranchWiseRepaymentWorkbook(historyFile.buffer);

            // Both optional — only re-parsed if this preview run actually uploaded them. Their
            // effect is baked into each row's resolved.loanAdvanceOutstanding/goldLoanDetails
            // below, persisted into UploanImportJobRow.rowData — the worker never needs these
            // maps again after this point.
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

            // Server-side re-validation — identical rules to preview, never trust the client.
            const revalidated = await validateUploanRows(
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

            const centerIdByKey = new Map<string, string>();
            const groupIdByKey = new Map<string, string>();

            // ── Resolve/create Centers (one row per unique key, from validateUploanRows' dedup) ──
            for (const center of revalidated.centers) {
                if (center.status === 'MATCHED' && center.id) {
                    centerIdByKey.set(center.key, center.id);
                    continue;
                }
                try {
                    // center.code is the exact Center code parsed from this row's legacy
                    // MemberID (this route's source of truth) — resolveCenterCode is only a
                    // defensive fallback for a row whose MemberID failed to parse (such a
                    // row is already ERROR and won't produce a job row either way).
                    const code = center.code ?? (await resolveCenterCode(branchId, center.name));
                    const created = await prisma.center.create({
                        data: {
                            name: center.name.trim(),
                            code,
                            branchId,
                            localArea: center.localArea?.trim() || null,
                            address: center.address?.trim() || null,
                            meetingDay: center.meetingDay?.trim() || null,
                            meetingTime: center.meetingTime?.trim() ? normalizeMeetingTime(center.meetingTime.trim()) : null,
                            createdById: user.userId,
                            status: 'APPROVED',
                            approvedById: user.userId,
                            approvedAt: new Date(),
                            isActive: true,
                        },
                        select: { id: true },
                    });
                    centerIdByKey.set(center.key, created.id);
                } catch (err) {
                    console.error(`[uploan import/start] Failed to create center "${center.name}":`, err);
                }
            }

            // ── Resolve/create Groups (auto-numbered per createNextGroupForCenter's contract) ──
            for (const group of revalidated.groups) {
                if (group.status === 'MATCHED' && group.id) {
                    groupIdByKey.set(group.key, group.id);
                    continue;
                }
                const centerId = centerIdByKey.get(group.centerKey);
                if (!centerId) continue;
                try {
                    // group.groupNumber is the exact Group number parsed from this row's
                    // legacy MemberID (this route's source of truth) — when undefined (a
                    // row whose MemberID failed to parse), createNextGroupForCenter falls
                    // back to its normal legacySourceName-prefix-or-auto-increment logic.
                    const created = await prisma.$transaction((tx) =>
                        createNextGroupForCenter(tx, {
                            centerId,
                            createdById: user.userId,
                            legacySourceName: group.legacyGroupName,
                            exactGroupNumber: group.groupNumber,
                        })
                    );
                    groupIdByKey.set(group.key, created.id);
                } catch (err) {
                    console.error(`[uploan import/start] Failed to create group for center "${group.centerName}":`, err);
                }
            }

            const resolvedCenterIds = [...centerIdByKey.values()];
            const resolvedGroupIds = [...groupIdByKey.values()];
            const centerCodeById = new Map(
                resolvedCenterIds.length
                    ? (await prisma.center.findMany({ where: { id: { in: resolvedCenterIds } }, select: { id: true, code: true } })).map(
                          (c) => [c.id, c.code || '0']
                      )
                    : []
            );
            const groupNumberById = new Map(
                resolvedGroupIds.length
                    ? (await prisma.group.findMany({ where: { id: { in: resolvedGroupIds } }, select: { id: true, groupNumber: true } })).map(
                          (g) => [g.id, g.groupNumber]
                      )
                    : []
            );

            // ── Build one job row per member row — ERROR rows and rows whose Center/Group
            // couldn't be resolved are stamped FAILED immediately (matching the old route's
            // behavior exactly); everything else is queued PENDING for the worker. ──
            type JobRowInput = { rowIndex: number; rowData: Prisma.InputJsonValue; status: 'PENDING' | 'FAILED'; errorMessage?: string };
            const jobRows: JobRowInput[] = [];

            (revalidated.rows as ValidatedUploanRow[]).forEach((row, rowIndex) => {
                if (row.status === 'ERROR') {
                    jobRows.push({ rowIndex, rowData: JSON.parse(JSON.stringify(row)), status: 'FAILED', errorMessage: row.errors.join('; ') });
                    return;
                }

                const centerId = centerIdByKey.get(row.resolved.centerKey);
                const groupId = groupIdByKey.get(row.resolved.groupKey);
                if (!centerId || !groupId) {
                    jobRows.push({
                        rowIndex,
                        rowData: JSON.parse(JSON.stringify(row)),
                        status: 'FAILED',
                        errorMessage: 'Center or Group could not be resolved/created',
                    });
                    return;
                }

                const fullRowData: UploanJobRowData = {
                    ...row,
                    resolvedCenterId: centerId,
                    resolvedGroupId: groupId,
                    centerCode: centerCodeById.get(centerId) ?? '0',
                    groupNumber: groupNumberById.get(groupId) ?? null,
                    branchCode,
                    branchId,
                };
                jobRows.push({ rowIndex, rowData: JSON.parse(JSON.stringify(fullRowData)), status: 'PENDING' });
            });

            const job = await prisma.uploanImportJob.create({
                data: {
                    branchId,
                    status: 'PENDING',
                    totalRows: jobRows.length,
                    historyFileKey,
                    createdById: user.userId,
                    rows: { create: jobRows },
                },
                select: { id: true },
            });

            await bumpMasterDataVersion('centers:minimal'); // may have created new centers above
            return successResponse({ jobId: job.id, totalRows: jobRows.length }, 'Import job queued');
        } catch (error) {
            console.error('[uploan import/start] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to start import', 500);
        }
    })(request);
}
