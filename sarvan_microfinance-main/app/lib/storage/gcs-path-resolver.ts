import { prisma } from '@/app/lib/prisma';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Builds the fixed org-hierarchy folder structure used for every GCS object:
 *
 *   {GCS_BASE_FOLDER}/region-{id}/division-{id}/area-{id}/branch-{id}/center-{id}/group-{id}/client-{id}/...
 *
 * All segments are IDs (not names) so the path never changes if an entity is
 * renamed. Levels that don't apply to a given upload (e.g. no group, or a
 * branch not yet assigned to an area) fall back to a literal "unassigned"
 * segment so the depth of the tree stays consistent.
 *
 * Note: the path is resolved once, at upload time. If a client/branch/center
 * is later transferred, previously-uploaded objects stay at their original
 * path — this mirrors how the stored file reference is immutable once saved.
 */

export const GCS_BASE_FOLDER = process.env.GCS_BASE_FOLDER || 'sarvammfi';
/** Separate top-level folder (under GCS_BASE_FOLDER) for Request Report exports — kept out of the region/division/area/branch upload tree since one export can span multiple/ALL branches. */
export const GCS_REPORT_EXPORT_FOLDER = process.env.GCS_REPORT_EXPORT_FOLDER || 'report-exports';
const UNASSIGNED = 'unassigned';

export type BranchAncestry = {
    regionId: string;
    divisionId: string;
    areaId: string;
    branchId: string;
};

const emptyBranchAncestry = (branchId: string): BranchAncestry => ({
    regionId: UNASSIGNED,
    divisionId: UNASSIGNED,
    areaId: UNASSIGNED,
    branchId: branchId || UNASSIGNED,
});

/** Branch -> Area (first assigned) -> Division -> Region. */
export async function resolveBranchAncestry(branchId: string | null | undefined): Promise<BranchAncestry> {
    if (!branchId) return emptyBranchAncestry(UNASSIGNED);

    const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: {
            id: true,
            areas: {
                take: 1,
                select: {
                    id: true,
                    division: {
                        select: {
                            id: true,
                            region: { select: { id: true } },
                        },
                    },
                },
            },
        },
    });

    if (!branch) return emptyBranchAncestry(branchId);

    const area = branch.areas[0];
    return {
        regionId: area?.division?.region?.id ?? UNASSIGNED,
        divisionId: area?.division?.id ?? UNASSIGNED,
        areaId: area?.id ?? UNASSIGNED,
        branchId: branch.id,
    };
}

export function branchFolder(ancestry: BranchAncestry): string {
    return `${GCS_BASE_FOLDER}/region-${ancestry.regionId}/division-${ancestry.divisionId}/area-${ancestry.areaId}/branch-${ancestry.branchId}`;
}

/** Most recent group a client is/was a member of, if any. */
async function resolveClientGroupId(clientId: string): Promise<string> {
    const membership = await prisma.groupMember.findFirst({
        where: { clientId },
        orderBy: { joinedAt: 'desc' },
        select: { groupId: true },
    });
    return membership?.groupId ?? UNASSIGNED;
}

export type ClientAncestry = {
    branch: BranchAncestry;
    centerId: string;
    groupId: string;
    clientId: string;
};

/**
 * Resolves a client's full ancestry. `clientIdentifier` may be either the
 * internal cuid (Client.id) or the human-facing business code (Client.clientId),
 * matching the lookup pattern already used across the KYC/enrollment routes.
 */
export async function resolveClientAncestry(clientIdentifier: string): Promise<ClientAncestry> {
    const client = await prisma.client.findFirst({
        where: { OR: [{ id: clientIdentifier }, { clientId: clientIdentifier }] },
        select: {
            id: true,
            centerId: true,
            center: { select: { branchId: true } },
        },
    });

    if (!client) {
        return {
            branch: emptyBranchAncestry(UNASSIGNED),
            centerId: UNASSIGNED,
            groupId: UNASSIGNED,
            clientId: clientIdentifier || UNASSIGNED,
        };
    }

    const [branch, groupId] = await Promise.all([
        resolveBranchAncestry(client.center?.branchId ?? null),
        resolveClientGroupId(client.id),
    ]);

    return {
        branch,
        centerId: client.centerId ?? UNASSIGNED,
        groupId,
        clientId: client.id,
    };
}

export function clientFolder(ancestry: ClientAncestry): string {
    return `${branchFolder(ancestry.branch)}/center-${ancestry.centerId}/group-${ancestry.groupId}/client-${ancestry.clientId}`;
}

/** Convenience: full client folder path from a client identifier in one call. */
export async function resolveClientFolder(clientIdentifier: string): Promise<string> {
    return clientFolder(await resolveClientAncestry(clientIdentifier));
}

/** Employee (User) folder: branch ancestry + employee-{id}. No center/group level — employees are branch-scoped. */
export async function resolveEmployeeFolder(employeeId: string): Promise<string> {
    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: { branchId: true },
    });

    const branch = await resolveBranchAncestry(employee?.branchId ?? null);
    return `${branchFolder(branch)}/employee-${employeeId || UNASSIGNED}`;
}

/** Loan folder: resolves via the loan's own branchId/centerId/clientId (all stored directly on Loan). */
export async function resolveLoanFolder(loanId: string): Promise<string> {
    const loan = await prisma.loan.findUnique({
        where: { id: loanId },
        select: { branchId: true, centerId: true, clientId: true },
    });

    if (!loan) {
        return `${GCS_BASE_FOLDER}/region-${UNASSIGNED}/division-${UNASSIGNED}/area-${UNASSIGNED}/branch-${UNASSIGNED}/center-${UNASSIGNED}/group-${UNASSIGNED}/client-${UNASSIGNED}/loan-${loanId}`;
    }

    const [branch, groupId] = await Promise.all([
        resolveBranchAncestry(loan.branchId),
        resolveClientGroupId(loan.clientId),
    ]);

    return `${branchFolder(branch)}/center-${loan.centerId ?? UNASSIGNED}/group-${groupId}/client-${loan.clientId ?? UNASSIGNED}/loan-${loanId}`;
}

/**
 * Report export folder: NOT branch-hierarchy scoped — a single Request Report
 * export can span multiple branches or ALL branches, so it doesn't fit the
 * region/division/area/branch tree used everywhere else. Grouped by IST
 * calendar year/month instead, purely to keep the bucket browsable.
 */
export function resolveReportExportKey(requestId: string, filename: string): string {
    const [year, month] = getKolkataCalendarYmd(new Date()).split('-');
    return `${GCS_BASE_FOLDER}/${GCS_REPORT_EXPORT_FOLDER}/${year}/${month}/request-${requestId}/${filename}`;
}

/** Separate top-level folder for the uploan "Member upload" Branch Wise Repayment source
 *  files — uploaded once at first Preview (before any UploanImportJob exists yet, so it
 *  isn't keyed by jobId), then re-downloaded by both re-validate calls and the background
 *  import worker via the `uploadId` this function was called with. */
export const GCS_UPLOAN_IMPORT_FOLDER = process.env.GCS_UPLOAN_IMPORT_FOLDER || 'uploan-imports';

export function resolveUploanImportHistoryKey(uploadId: string, filename: string): string {
    const [year, month] = getKolkataCalendarYmd(new Date()).split('-');
    return `${GCS_BASE_FOLDER}/${GCS_UPLOAN_IMPORT_FOLDER}/${year}/${month}/${uploadId}/${filename}`;
}
