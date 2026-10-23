import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { buildFdoCenterScope } from '@/app/lib/filters/fdo-center-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getAllowFdoEditApprovedClient } from '@/app/lib/fdo-approved-client-edit-config';
import { getAllowBmEditApprovedClient } from '@/app/lib/bm-approved-client-edit-config';
import { getUserAssignedBranchIds } from '@/app/lib/user-branch-assignments';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { compareMemberIds } from '@/app/lib/member-id-sort';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

/**
 * GET /api/clients
 * Fetch clients with role-based filtering and pagination
 * 
 * Query params:
 * - centerId: Filter by center ID
 * - includeInactive: Include inactive clients (default: false)
 * - branchId: Filter by branch ID (Admin only)
 * - page: Page number (default: 1)
 * - pageSize: Number of items per page (default: 10)
 * 
 * Access: All authenticated users
 * - BRANCH_MANAGER: Only sees clients from their branch
 * - FDO: Only sees clients from their assigned centers
 * - ADMIN/AREA_MANAGER: Can see all clients
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const groupId  = searchParams.get('groupId');
            const branchId = searchParams.get('branchId');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includeLoanInfo = searchParams.get('includeLoanInfo') === 'true';
            const includeKyc     = searchParams.get('includeKyc') === 'true';
            // noCenter=true → return only clients with centerId IS NULL (newly enrolled, awaiting center assignment)
            const noCenter = searchParams.get('noCenter') === 'true';
            // allBranch=true → return ALL branch clients including those with no center assigned
            const allBranch = searchParams.get('allBranch') === 'true';
            // global=true (ADMIN only) → skip branch scoping entirely, search across every branch
            const global = searchParams.get('global') === 'true';
            // excludeFinalApproved=true → opt-in filter (sent only by the Client Update
            // page) hiding clients whose approval is already finalized (APPROVED) from
            // non-Admin/non-SubAdmin callers. Absent by default so every other consumer
            // of this endpoint keeps seeing approved clients as before.
            const excludeFinalApproved = searchParams.get('excludeFinalApproved') === 'true';
            // search → filter by clientId or name (case-insensitive)
            const search = searchParams.get('search') || '';
            const page = parseInt(searchParams.get('page') || '1');
            const pageSize = parseInt(searchParams.get('pageSize') || '10');

            // Build where clause with proper Prisma types
            const where: any = {};

            // Role-based filtering
            if (user.role === 'BRANCH_MANAGER') {
                // Branch Managers can only see clients from their branch(es).
                // Re-read fresh from the DB (not the JWT) so a branch transfer takes
                // effect immediately instead of waiting for a token refresh.
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    // Return empty array if user has no branch
                    return successResponse({
                        clients: [],
                        pagination: {
                            currentPage: page,
                            pageSize: pageSize,
                            totalItems: 0,
                            totalPages: 0,
                        },
                    }, 'No clients found');
                }

                // A BM may additionally be assigned extra branches via
                // UserBranchAssignment (e.g. temporary multi-branch coverage) — see
                // clients across all of them, not just their primary branch.
                const extraBranchIds = await getUserAssignedBranchIds(user.userId);
                const bmBranchIds = extraBranchIds.length > 0
                    ? Array.from(new Set([userRecord.branchId, ...extraBranchIds]))
                    : [userRecord.branchId];
                const bmBranchWhere = bmBranchIds.length === 1 ? bmBranchIds[0] : { in: bmBranchIds };

                // If centerId is provided, verify it belongs to one of the branches
                if (centerId) {
                    const center = await prisma.center.findUnique({
                        where: { id: centerId },
                        select: { branchId: true },
                    });

                    if (!center || !bmBranchIds.includes(center.branchId)) {
                        return successResponse({
                            clients: [],
                            pagination: {
                                currentPage: page,
                                pageSize: pageSize,
                                totalItems: 0,
                                totalPages: 0,
                            },
                        }, 'No clients found');
                    }

                    where.centerId = centerId;
                } else if (allBranch) {
                    // allBranch: include clients with center in branch AND unassigned clients
                    // whose REQUESTED center (Loan Details tab selection) is in this branch —
                    // not the enroller's own branch, which may differ (e.g. an HO Admin
                    // enrolling into this branch on an FDO's behalf).
                    where.OR = [
                        { center: { branchId: bmBranchWhere } },
                        { centerId: null, requestedCenter: { branchId: bmBranchWhere } },
                    ];
                } else {
                    // Filter by branch (center-assigned clients only)
                    where.center = {
                        branchId: bmBranchWhere,
                    };
                }
            } else if (user.role === 'FDO') {
                // FDOs can only see clients from centers directly assigned to them via Center.fdoId
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                const assignedCenters = await prisma.center.findMany({
                    where: buildFdoCenterScope(user),
                    select: { id: true },
                });

                const allAccessibleCenterIds = assignedCenters.map((c) => c.id);

                if (allAccessibleCenterIds.length === 0) {
                    // Return empty array if FDO has no accessible centers
                    return successResponse({
                        clients: [],
                        pagination: {
                            currentPage: page,
                            pageSize: pageSize,
                            totalItems: 0,
                            totalPages: 0,
                        },
                    }, 'No clients found');
                }

                // If centerId is provided, verify it's in accessible centers
                if (centerId) {
                    if (!allAccessibleCenterIds.includes(centerId)) {
                        return successResponse({
                            clients: [],
                            pagination: {
                                currentPage: page,
                                pageSize: pageSize,
                                totalItems: 0,
                                totalPages: 0,
                            },
                        }, 'No clients found - Access Restricted');
                    }
                    where.centerId = centerId;
                } else if (allBranch && userRecord?.branchId) {
                    // allBranch: include center-accessible clients AND unassigned clients whose
                    // requested center is in the FDO's branch (not the enroller's own branch).
                    where.OR = [
                        { centerId: { in: allAccessibleCenterIds } },
                        { centerId: null, requestedCenter: { branchId: userRecord.branchId } },
                    ];
                } else {
                    // Filter by accessible centers
                    where.centerId = {
                        in: allAccessibleCenterIds,
                    };
                }
            } else {
                // ADMIN and AREA_MANAGER can see all clients
                // Filter by center if provided
                if (centerId) {
                    where.centerId = centerId;
                    // Do NOT add where.center branchId when centerId is explicit —
                    // the centerId already scopes the query, and user.branchId (HO)
                    // would conflict with clients in non-HO branches.
                } else if (global && user.role === 'ADMIN') {
                    // global=true (ADMIN only): no branch restriction at all — search every branch.
                    // AREA_MANAGER is excluded here — their scope stays limited to assignedBranchIds.
                } else {
                    // No centerId — filter by branch(es) so ADMIN/AREA_MANAGER see only
                    // their permitted clients. An AREA_MANAGER assigned multiple branches
                    // (AreaManagerBranch) sees clients across ALL of them, not just the
                    // currently active one; a Head Office based user is unrestricted
                    // unless a specific branchId was requested.
                    const effectiveBranchIds = await resolveScopedBranchIds(user, branchId);
                    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
                        const branchWhere = effectiveBranchIds.length === 1
                            ? effectiveBranchIds[0]
                            : { in: effectiveBranchIds };
                        if (allBranch) {
                            // allBranch: include both center-assigned clients AND unassigned
                            // clients whose requested center is in this branch — not the
                            // enroller's own branch (e.g. an HO Admin enrolling on behalf of
                            // this branch's FDO).
                            where.OR = [
                                { center: { branchId: branchWhere } },
                                { centerId: null, requestedCenter: { branchId: branchWhere } },
                            ];
                        } else {
                            where.center = {
                                branchId: branchWhere,
                            };
                        }
                    }
                }
            }

            // search: filter by clientId prefix or first/last name (case-insensitive)
            if (search) {
                const searchClause = {
                    OR: [
                        { clientId: { contains: search, mode: 'insensitive' as const } },
                        { firstName: { contains: search, mode: 'insensitive' as const } },
                        { lastName: { contains: search, mode: 'insensitive' as const } },
                        { phone: { contains: search, mode: 'insensitive' as const } },
                        ...memberIdSearchConditions(search),
                    ],
                };
                if (where.OR) {
                    // Combine existing OR (from allBranch) with search using AND
                    where.AND = [{ OR: where.OR }, searchClause];
                    delete where.OR;
                } else {
                    where.AND = [...(where.AND || []), searchClause];
                }
            }

            // noCenter=true: override centerId filter to return ONLY unassigned clients
            if (noCenter) {
                // Remove any centerId filter set above — we want centerId IS NULL
                delete where.centerId;
                delete where.center;
                where.centerId = null;

                // Scope unassigned clients to the BM's/FDO's branch via the client's
                // REQUESTED center's branch (Loan Details tab selection) — not the
                // enroller's own branch, which may differ.
                if (user.role === 'BRANCH_MANAGER' || user.role === 'FDO') {
                    const userRecord = await prisma.user.findUnique({
                        where: { id: user.userId },
                        select: { branchId: true },
                    });
                    if (userRecord?.branchId) {
                        // A BM (or FDO) additionally assigned extra branches via
                        // UserBranchAssignment sees unassigned clients requested against
                        // any of those branches too.
                        const extraBranchIds = await getUserAssignedBranchIds(user.userId);
                        const branchIds = extraBranchIds.length > 0
                            ? Array.from(new Set([userRecord.branchId, ...extraBranchIds]))
                            : [userRecord.branchId];
                        where.requestedCenter = {
                            branchId: branchIds.length === 1 ? branchIds[0] : { in: branchIds },
                        };
                    }
                } else if ((user.role === 'ADMIN' || user.role === 'AREA_MANAGER') && !global) {
                    // ADMIN/AREA_MANAGER: scope to the explicit ?branchId= filter (e.g. the
                    // "Branch" dropdown on Center & Group Assignment) or, failing that, all
                    // of their permitted branches — same requestedCenter.branchId signal as
                    // above, since an unassigned client has no real centerId yet. An
                    // AREA_MANAGER assigned multiple branches sees all of them at once.
                    const effectiveBranchIds = await resolveScopedBranchIds(user, branchId);
                    if (effectiveBranchIds && effectiveBranchIds.length > 0) {
                        where.requestedCenter = {
                            branchId: effectiveBranchIds.length === 1
                                ? effectiveBranchIds[0]
                                : { in: effectiveBranchIds },
                        };
                    }
                }
            }

            // Filter by group if provided
            if (groupId) {
                where.groupId = groupId;
            }

            // Filter by active status
            if (!includeInactive) {
                where.isActive = true;
            }

            // excludeFinalApproved: hide APPROVED clients from AM (and any other
            // non-privileged role) — Admin/Sub Admin always see everything. FDO and
            // BRANCH_MANAGER are privileged too, but only while their respective
            // Admin-controlled kill-switch (FdoApprovedClientEditConfig /
            // BmApprovedClientEditConfig) is on — editing/re-uploading KYC on an
            // already-APPROVED client only skips the approval-workflow restart for
            // them while that switch is enabled (see app/api/clients/[clientId]/route.ts),
            // so hide approved clients from their Member Update list while it's off.
            if (excludeFinalApproved) {
                const isPrivileged =
                    user.role === 'ADMIN' ||
                    user.role === 'ADMIN_NON_HO_BRANCH_SWITCH' ||
                    (user.role === 'FDO' && (await getAllowFdoEditApprovedClient())) ||
                    (user.role === 'BRANCH_MANAGER' && (await getAllowBmEditApprovedClient())) ||
                    (await isSubAdminUser(user.userId));
                if (!isPrivileged) {
                    where.approvalStatus = { not: 'APPROVED' };
                }
            }

            // Debug logging
            console.log('Clients API - Query params:', { centerId, branchId, noCenter, includeInactive, page, pageSize });
            console.log('Clients API - Where clause:', JSON.stringify(where, null, 2));

            // Get total count for pagination
            const totalItems = await prisma.client.count({ where });
            console.log('Clients API - Total items found:', totalItems);

            const totalPages = Math.ceil(totalItems / pageSize);
            const skip = (page - 1) * pageSize;

            // Center/group-scoped lists sort by natural member ID (29-96-1-2 before 29-96-1-10).
            // clientId is a string so the DB can't order it that way; the scoped set is small, so
            // sort the ids in memory, slice the page, then load only that page. Unscoped lists
            // keep newest-first DB pagination.
            let memberIdPageIds: string[] | null = null;
            if (centerId || groupId) {
                const idRows = await prisma.client.findMany({ where, select: { id: true, clientId: true } });
                idRows.sort((a, b) => compareMemberIds(a.clientId, b.clientId) || a.id.localeCompare(b.id));
                memberIdPageIds = idRows.slice(skip, skip + pageSize).map((r) => r.id);
            }

            const clients = await prisma.client.findMany({
                where: memberIdPageIds ? { AND: [where, { id: { in: memberIdPageIds } }] } : where,
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    permanentAddress: true,
                    centerId: true,
                    groupId: true,
                    memberGroupStatus: true,
                    requestedCenterId: true,
                    requestedCenterName: true,
                    requestedGroupId: true,
                    requestedGroupName: true,
                    latitude: true,
                    longitude: true,
                    spouseName: true,
                    nomineeName: true,
                    nomineeRelation: true,
                    age: true,
                    mobileNumber: true,
                    otherIdNo: true,
                    smartCardNo: true,
                    votersIdNo: true,
                    pancardNo: true,
                    verificationStatus: true,
                    verifiedAt: true,
                    verifiedById: true,
                    rejectionReason: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                            branchId: true,
                            latitude: true,
                            longitude: true,
                            address: true,
                            branch: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                },
                            },
                        },
                    },
                    verifiedBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            email: true,
                        },
                    },
                    enrolledBy: {
                        select: {
                            id: true,
                            branchId: true,
                            branch: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                },
                            },
                        },
                    },
                    // The client's REQUESTED center (Loan Details tab selection) — the
                    // correct branch-attribution source for a still-unassigned client,
                    // in preference to enrolledBy (the enroller's own branch, which may
                    // differ, e.g. an HO Admin enrolling on an FDO's behalf).
                    requestedCenter: {
                        select: {
                            branchId: true,
                            branch: {
                                select: {
                                    id: true,
                                    name: true,
                                    code: true,
                                },
                            },
                        },
                    },
                    ...(includeLoanInfo && {
                        loanApplications: {
                            where: {
                                isActive: true,
                                disbursementStatus: 'DISBURSED',
                            },
                            select: {
                                id: true,
                                loanNumber: true,
                                amount: true,
                                principalPaid: true,
                                interestPaid: true,
                                loanProduct: {
                                    select: {
                                        productName: true,
                                    }
                                }
                            },
                            orderBy: {
                                createdAt: 'desc',
                            },
                            take: 1, // Get only the most recent active loan
                        },
                    }),
                    // Member (no loan yet) vs Client (has at least one loan, any status) label signal
                    _count: {
                        select: {
                            loanApplications: true,
                        },
                    },
                },
                orderBy: [
                    { createdAt: 'desc' },
                    { id: 'asc' },
                ],
                ...(memberIdPageIds ? {} : { skip, take: pageSize }),
            });

            // findMany with `in` returns arbitrary order — restore the member-ID order the page was sliced in.
            if (memberIdPageIds) {
                const rank = new Map(memberIdPageIds.map((id, i) => [id, i]));
                clients.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
            }

            // Fetch KYC documents separately when requested (avoids TS spread issues)
            let kycMap: Map<string, Array<{ documentType: string; fileUrl: string | null }>> = new Map();
            if (includeKyc && clients.length > 0) {
                const clientIds = clients.map((c: any) => c.id);
                const kycDocs = await prisma.kYC.findMany({
                    where: { clientId: { in: clientIds } },
                    select: { clientId: true, documentType: true, fileUrl: true },
                });
                for (const doc of kycDocs) {
                    const existing = kycMap.get(doc.clientId) ?? [];
                    existing.push({ documentType: doc.documentType, fileUrl: doc.fileUrl });
                    kycMap.set(doc.clientId, existing);
                }
            }

            // Map clients to include both raw data and search result format
            const clientsWithCenter = clients.map((client: any) => {
                // Shown ID is the stored client ID (same as `accountId`) — permanent,
                // never changes on center/branch transfer.
                const displayAccountId = client.clientId;
                const activeLoan = includeLoanInfo && client.loanApplications?.[0];
                const loanOutstanding = activeLoan
                    ? Number(activeLoan.amount) - Number(activeLoan.principalPaid || 0)
                    : null;

                return {
                    // Raw client data for loan application
                    id: client.id,
                    clientId: client.clientId,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    phone: client.phone || '',
                    email: client.email || '',
                    permanentAddress: client.permanentAddress || client.center?.address || null,
                    centerId: client.centerId,
                    groupId: client.groupId,
                    memberGroupStatus: client.memberGroupStatus,
                    requestedCenterId: client.requestedCenterId,
                    requestedCenterName: client.requestedCenterName,
                    requestedGroupId: client.requestedGroupId,
                    requestedGroupName: client.requestedGroupName,
                    verificationStatus: client.verificationStatus,
                    isActive: client.isActive,
                    createdAt: client.createdAt,

                    // Loan information (if requested)
                    ...(includeLoanInfo && activeLoan && {
                        loanId: activeLoan.id,
                        loanNumber: activeLoan.loanNumber,
                        loanAmount: Number(activeLoan.amount),
                        loanOutstanding,
                        funderName: activeLoan.loanProduct?.productName || 'N/A',
                    }),

                    // Member (no loan yet) vs Client (has at least one loan) label signal
                    hasLoan: (client._count?.loanApplications ?? 0) > 0,

                    // Required fields for ClientSearchResult (for backward compatibility)
                    kycData: 'Show',
                    loanData: 'Show',
                    advData: 'Show',
                    // prefer center's branch; for unassigned clients, fall back to the
                    // REQUESTED center's branch (Loan Details tab selection), then
                    // enrolledBy's branch as a last resort (e.g. no requestedCenter at all).
                    branchId: client.center?.branch?.id || (client as any).requestedCenter?.branch?.id || (client as any).enrolledBy?.branch?.id || '',
                    branchName: client.center?.branch?.name || (client as any).requestedCenter?.branch?.name || (client as any).enrolledBy?.branch?.name || '',
                    accountId: client.clientId,
                    displayAccountId,
                    centerName: client.center ? `${client.center.code} - ${client.center.name}` : '',
                    clientName: `${displayAccountId} - ${client.firstName} ${client.lastName}`,
                    spouseName: client.spouseName || '',
                    nomineeName: client.nomineeName || '',
                    relationship: client.nomineeRelation || '',
                    // Raw fields — used by audit tool and other direct consumers
                    otherIdNo:    client.otherIdNo    || '',
                    mobileNumber: client.mobileNumber || '',
                    age:          client.age ?? null,
                    kycDocuments: includeKyc ? (kycMap.get(client.id) ?? []) : undefined,
                    // Legacy mapped names kept for backward compatibility
                    otherId: client.otherIdNo || '',
                    smartCard: client.smartCardNo || '',
                    voterId: client.votersIdNo || '',
                    pancard: client.pancardNo || '',
                    status: client.isActive ? 'Active' : 'Inactive' as 'Active' | 'Inactive',
                    dedupeFlag: 0,
                    // prefer client's own GPS coords; fall back to center's coords
                    latitude: client.latitude || client.center?.latitude || null,
                    longitude: client.longitude || client.center?.longitude || null,

                    // Center details
                    center: client.center,
                };
            });

            return successResponse({
                clients: clientsWithCenter,
                pagination: {
                    currentPage: page,
                    pageSize: pageSize,
                    totalItems: totalItems,
                    totalPages: totalPages,
                },
            }, 'Clients fetched successfully');
        } catch (error) {
            console.error('Error fetching clients:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch clients',
                500
            );
        }
    })(request);
}
