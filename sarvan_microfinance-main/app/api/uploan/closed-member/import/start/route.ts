import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import type { ClosedMemberRow, ValidatedClosedMemberRow } from '@/app/lib/services/closed-member-import.service';
import type { CenterOverrides, CenterSummary, GroupSummary } from '@/app/lib/services/uploan-import.service';
import { validateClosedMemberRows } from '@/app/lib/services/closed-member-validate.service';
import { parseThriftOutstandingWorkbook } from '@/app/lib/services/uploan-thrift-outstanding.service';
import { parseGoldDetailsWorkbook } from '@/app/lib/services/uploan-gold-details.service';
import type { ClosedMemberJobRowData } from '@/app/lib/services/closed-member-import-row.service';
import { resolveCenterCode } from '@/app/lib/services/center-code.service';
import { createNextGroupForCenter } from '@/app/lib/services/group-assignment.service';
import { normalizeMeetingTime } from '@/app/lib/utils/meeting-time';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/uploan/closed-member/import/start
 *
 * Same two-phase shape as /api/uploan/member/import/start: re-validates server-side,
 * resolves/creates Centers -> Groups up front, persists one ClosedMemberImportJobRow per
 * row, and returns immediately — actual Client/Loan creation runs in the background
 * (closed-member-import-worker.ts).
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const body = await req.json();
            const branchId = String(body.branchId || '');
            const createLoan = Boolean(body.createLoan);
            const rows: ClosedMemberRow[] = Array.isArray(body.rows) ? body.rows : [];
            const centerOverrides: CenterOverrides =
                body.centerOverrides && typeof body.centerOverrides === 'object' ? body.centerOverrides : {};
            const keepCenters: CenterSummary[] = Array.isArray(body.keepCenters) ? body.keepCenters : [];
            const keepGroups: GroupSummary[] = Array.isArray(body.keepGroups) ? body.keepGroups : [];
            const thriftFileKey = String(body.thriftFileKey || '');
            const goldFileKey = String(body.goldFileKey || '');

            if (!branchId) return errorResponse('Branch is required', 400);
            if (rows.length === 0) return errorResponse('No rows to import', 400);

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

            const revalidated = await validateClosedMemberRows(
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

            const centerIdByKey = new Map<string, string>();
            const groupIdByKey = new Map<string, string>();

            for (const center of revalidated.centers) {
                if (center.status === 'MATCHED' && center.id) {
                    centerIdByKey.set(center.key, center.id);
                    continue;
                }
                try {
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
                    console.error(`[closed-member import/start] Failed to create center "${center.name}":`, err);
                }
            }

            for (const group of revalidated.groups) {
                if (group.status === 'MATCHED' && group.id) {
                    groupIdByKey.set(group.key, group.id);
                    continue;
                }
                const centerId = centerIdByKey.get(group.centerKey);
                if (!centerId) continue;
                try {
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
                    console.error(`[closed-member import/start] Failed to create group for center "${group.centerName}":`, err);
                }
            }

            type JobRowInput = { rowIndex: number; rowData: Prisma.InputJsonValue; status: 'PENDING' | 'FAILED'; errorMessage?: string };
            const jobRows: JobRowInput[] = [];

            (revalidated.rows as ValidatedClosedMemberRow[]).forEach((row, rowIndex) => {
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

                const fullRowData: ClosedMemberJobRowData = {
                    ...row,
                    resolvedCenterId: centerId,
                    resolvedGroupId: groupId,
                    branchId,
                    createLoan,
                };
                jobRows.push({ rowIndex, rowData: JSON.parse(JSON.stringify(fullRowData)), status: 'PENDING' });
            });

            const job = await prisma.closedMemberImportJob.create({
                data: {
                    branchId,
                    status: 'PENDING',
                    createLoan,
                    totalRows: jobRows.length,
                    thriftFileKey: thriftFileKey || null,
                    goldFileKey: goldFileKey || null,
                    createdById: user.userId,
                    rows: { create: jobRows },
                },
                select: { id: true },
            });

            await bumpMasterDataVersion('centers:minimal'); // may have created new centers above
            return successResponse({ jobId: job.id, totalRows: jobRows.length }, 'Import job queued');
        } catch (error) {
            console.error('[closed-member import/start] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to start import', 500);
        }
    })(request);
}
