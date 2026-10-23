import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import type { JWTPayload } from '@/app/lib/auth';

/**
 * Branch scope for the ADMIN / AREA_MANAGER / other multi-branch callers.
 * Returns the branchIds to restrict to, or `null` for no restriction.
 * - ADMIN: no restriction unless a specific branchId is given ('all' or empty = every branch)
 * - everyone else: the requested branch if permitted, otherwise all their permitted
 *   branches ('all' or empty) — so an AM's "all" is their assigned branches, not the company.
 */
async function resolveMultiBranchScope(
    user: JWTPayload,
    branchId: string | null
): Promise<string[] | null> {
    const requested = branchId && branchId !== 'all' ? branchId : null;
    if (user.role === 'ADMIN') {
        return requested ? [requested] : null;
    }
    const ids = await resolveScopedBranchIds(user, requested);
    return ids && ids.length > 0 ? ids : null;
}

/** Client belongs to the branches either via its center or its requested center (unassigned clients). */
function branchScopeClause(branchIds: string[]) {
    const branchWhere = branchIds.length === 1 ? branchIds[0] : { in: branchIds };
    return [
        { center: { branchId: branchWhere } },
        { centerId: null, requestedCenter: { branchId: branchWhere } },
    ];
}

/**
 * GET /api/clients/search
 * Search clients with specific criteria and pagination
 *
 * Query params:
 * - branchId: Filter by branch ID, or 'all' for every branch the caller may see (ADMIN/AM)
 * - searchType: Type of search (clientId, clientName, phone, aadhaar, centerCode)
 * - searchValue: Value to search for
 * - page: Page number (default: 1)
 * - pageSize: Number of items per page (default: 10)
 * 
 * Access: All authenticated users with role-based filtering
 */
type LocatableClient = {
    latitude: number | null;
    longitude: number | null;
    center: {
        name: string;
        code: string;
        latitude: number | null;
        longitude: number | null;
        branch: { name: string; latitude: number | null; longitude: number | null } | null;
    } | null;
};

// Separate member / centre / branch coordinates for the mobile
// "Client Search & Locate" navigation screen. The legacy latitude/longitude
// fields above stay centre-based for existing callers.
function locateFields(client: LocatableClient) {
    return {
        memberLatitude: client.latitude ?? null,
        memberLongitude: client.longitude ?? null,
        centerLatitude: client.center?.latitude ?? null,
        centerLongitude: client.center?.longitude ?? null,
        branchName: client.center?.branch?.name || '',
        branchLatitude: client.center?.branch?.latitude ?? null,
        branchLongitude: client.center?.branch?.longitude ?? null,
    };
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const searchType = searchParams.get('searchType');
            const searchValue = searchParams.get('searchValue');
            const page = parseInt(searchParams.get('page') || '1');
            const pageSize = parseInt(searchParams.get('pageSize') || '10');

            if (!searchType || !searchValue) {
                return errorResponse('Search type and value are required', 400);
            }

            // Build where clause
            const where: any = {};

            // Unified search across clientId, name, and phone
            if (searchType === 'searchAll') {
                // Always return only active clients
                where.isActive = true;

                // The branch filter applies to ADMIN / AM only. BM/FDO searchAll stays
                // company-wide, as it was before this branch filter existed.
                if (user.role !== 'BRANCH_MANAGER' && user.role !== 'FDO') {
                    const scopeIds = await resolveMultiBranchScope(user, branchId);
                    if (scopeIds) where.OR = branchScopeClause(scopeIds);
                }

                const searchParts = searchValue.trim().split(/\s+/);
                const orClause: any[] = [
                    { clientId: { contains: searchValue, mode: 'insensitive' as const } },
                    { firstName: { contains: searchValue, mode: 'insensitive' as const } },
                    { lastName: { contains: searchValue, mode: 'insensitive' as const } },
                    { phone: { contains: searchValue, mode: 'insensitive' as const } },
                ];
                // Handle "FirstName LastName" full-name search
                if (searchParts.length >= 2) {
                    orClause.push({
                        AND: [
                            { firstName: { startsWith: searchParts[0], mode: 'insensitive' as const } },
                            { lastName: { contains: searchParts.slice(1).join(' '), mode: 'insensitive' as const } },
                        ],
                    });
                }
                if (where.OR) {
                    where.AND = [{ OR: where.OR }, { OR: orClause }];
                    delete where.OR;
                } else {
                    where.OR = orClause;
                }

                const totalItems = await prisma.client.count({ where });
                const totalPages = Math.ceil(totalItems / pageSize);
                const skip = (page - 1) * pageSize;

                const clients = await prisma.client.findMany({
                    where,
                    select: {
                        id: true, clientId: true, firstName: true, lastName: true,
                        phone: true, email: true, centerId: true, groupId: true,
                        spouseName: true, nomineeName: true, nomineeRelation: true,
                        otherIdNo: true, smartCardNo: true, votersIdNo: true, pancardNo: true,
                        verificationStatus: true, verifiedAt: true, verifiedById: true,
                        rejectionReason: true, isActive: true, createdAt: true, updatedAt: true,
                        latitude: true, longitude: true,
                        center: {
                            select: {
                                id: true, name: true, code: true, branchId: true,
                                latitude: true, longitude: true, address: true,
                                branch: { select: { id: true, name: true, code: true, latitude: true, longitude: true } },
                            },
                        },
                        verifiedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                        _count: { select: { loanApplications: true } },
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'asc' },
                    ],
                    skip,
                    take: pageSize,
                });

                const clientsWithCenter = clients.map(client => {
                    // The stored client ID — permanent, never changes on transfer
                    const displayAccountId = client.clientId;
                    return {
                    hasLoan: (client._count?.loanApplications ?? 0) > 0,
                    kycData: 'Show', loanData: 'Show', advData: 'Show',
                    branchId: client.center?.branch?.id || '',
                    accountId: client.clientId,
                    displayAccountId,
                    centerName: client.center ? `${client.center.code} - ${client.center.name}` : '',
                    clientName: `${displayAccountId} - ${client.firstName} ${client.lastName}`,
                    spouseName: client.spouseName || '', nomineeName: client.nomineeName || '',
                    relationship: client.nomineeRelation || '', phone: client.phone || '',
                    otherId: client.otherIdNo || '', smartCard: client.smartCardNo || '',
                    voterId: client.votersIdNo || '', pancard: client.pancardNo || '',
                    status: (client.isActive ? 'Active' : 'Inactive') as 'Active' | 'Inactive',
                    dedupeFlag: 0,
                    latitude: client.center?.latitude || null,
                    longitude: client.center?.longitude || null,
                    address: client.center?.address || null,
                    ...locateFields(client),
                    };
                });

                return successResponse({
                    clients: clientsWithCenter,
                    pagination: { currentPage: page, pageSize, totalItems, totalPages },
                }, `Found ${totalItems} client(s) matching your search`);
            }

            // Role-based filtering (includes unassigned clients for BM/FDO via OR)
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    return successResponse({
                        clients: [],
                        pagination: { currentPage: page, pageSize, totalItems: 0, totalPages: 0 },
                    }, 'No clients found');
                }

                // Include both center-assigned clients AND unassigned clients whose
                // requested center (Loan Details tab selection) is in this branch.
                where.OR = [
                    { center: { branchId: userRecord.branchId } },
                    { centerId: null, requestedCenter: { branchId: userRecord.branchId } },
                ];
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: { select: { id: true } },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const allCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                const orClauses: any[] = [];
                if (allCenterIds.length > 0) orClauses.push({ centerId: { in: allCenterIds } });
                if (userRecord?.branchId) {
                    orClauses.push({ centerId: null, requestedCenter: { branchId: userRecord.branchId } });
                }

                if (orClauses.length === 0) {
                    return successResponse({
                        clients: [],
                        pagination: { currentPage: page, pageSize, totalItems: 0, totalPages: 0 },
                    }, 'No clients found');
                }

                where.OR = orClauses;
            } else {
                // ADMIN, AREA_MANAGER and other multi-branch roles
                const scopeIds = await resolveMultiBranchScope(user, branchId);
                if (scopeIds) where.OR = branchScopeClause(scopeIds);
            }

            // Only return active clients (consistent with the default client list view)
            where.isActive = true;

            // Add search criteria based on searchType
            // NOTE: where.OR may already be set for branch scoping — use AND to avoid overwriting it
            switch (searchType) {
                case 'clientId':
                    where.clientId = { contains: searchValue, mode: 'insensitive' };
                    break;
                case 'clientName': {
                    // Build name conditions — handles single word, full name (First Last), and clientId prefix
                    const nameConditions: any[] = [
                        { firstName: { contains: searchValue, mode: 'insensitive' as const } },
                        { lastName: { contains: searchValue, mode: 'insensitive' as const } },
                    ];

                    // Handle "FirstName LastName" style full-name searches
                    const parts = searchValue.trim().split(/\s+/);
                    if (parts.length >= 2) {
                        // e.g. "ARUNDEVI DEVI" → firstName starts with "ARUNDEVI" AND lastName contains "DEVI"
                        nameConditions.push({
                            AND: [
                                { firstName: { startsWith: parts[0], mode: 'insensitive' as const } },
                                { lastName: { contains: parts.slice(1).join(' '), mode: 'insensitive' as const } },
                            ],
                        });
                    }

                    const nameClause = { OR: nameConditions };

                    // Combine with existing branch-scope OR via AND
                    if (where.OR) {
                        where.AND = [...(where.AND || []), { OR: where.OR }, nameClause];
                        delete where.OR;
                    } else {
                        where.AND = [...(where.AND || []), nameClause];
                    }
                    break;
                }
                case 'phone': {
                    // Match either stored phone column (enrollment fills mobileNumber; legacy rows use phone)
                    const phoneValue = searchValue.replace(/[\s-]/g, '');
                    const phoneClause = {
                        OR: [
                            { phone: { contains: phoneValue, mode: 'insensitive' as const } },
                            { mobileNumber: { contains: phoneValue, mode: 'insensitive' as const } },
                        ],
                    };
                    if (where.OR) {
                        where.AND = [...(where.AND || []), { OR: where.OR }, phoneClause];
                        delete where.OR;
                    } else {
                        where.AND = [...(where.AND || []), phoneClause];
                    }
                    break;
                }
                case 'aadhaar':
                    // Aadhaar is stored as plain digits — ignore spaces / dashes typed by the user
                    where.otherIdNo = { contains: searchValue.replace(/[\s-]/g, ''), mode: 'insensitive' };
                    break;
                case 'centerCode':
                    // centerCode search only makes sense for center-assigned clients
                    if (where.OR) {
                        where.AND = [...(where.AND || []), { OR: where.OR }];
                        delete where.OR;
                    }
                    where.AND = [...(where.AND || []), {
                        center: { code: { contains: searchValue, mode: 'insensitive' as const } }
                    }];
                    break;
                default:
                    return errorResponse('Invalid search type', 400);
            }

            // Get total count for pagination
            const totalItems = await prisma.client.count({ where });
            const totalPages = Math.ceil(totalItems / pageSize);
            const skip = (page - 1) * pageSize;

            const clients = await prisma.client.findMany({
                where,
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    email: true,
                    centerId: true,
                    groupId: true,
                    spouseName: true,
                    nomineeName: true,
                    nomineeRelation: true,
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
                    latitude: true,
                    longitude: true,
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
                                    latitude: true,
                                    longitude: true,
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
                    _count: {
                        select: {
                            loanApplications: true,
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
                skip,
                take: pageSize,
            });

            // Map clients to match the frontend interface
            const clientsWithCenter = clients.map((client) => {
                // The stored client ID — permanent, never changes on transfer
                const displayAccountId = client.clientId;
                return {
                hasLoan: (client._count?.loanApplications ?? 0) > 0,
                kycData: 'Show',
                loanData: 'Show',
                advData: 'Show',
                branchId: client.center?.branch?.id || '',
                accountId: client.clientId,
                displayAccountId,
                centerName: client.center ? `${client.center.code} - ${client.center.name}` : '',
                clientName: `${displayAccountId} - ${client.firstName} ${client.lastName}`,
                spouseName: client.spouseName || '',
                nomineeName: client.nomineeName || '',
                relationship: client.nomineeRelation || '',
                phone: client.phone || '',
                otherId: client.otherIdNo || '',
                smartCard: client.smartCardNo || '',
                voterId: client.votersIdNo || '',
                pancard: client.pancardNo || '',
                status: client.isActive ? 'Active' : 'Inactive' as 'Active' | 'Inactive',
                dedupeFlag: 0,
                latitude: client.center?.latitude || null,
                longitude: client.center?.longitude || null,
                address: client.center?.address || null,
                ...locateFields(client),
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
            }, `Found ${totalItems} client(s) matching your search`);
        } catch (error) {
            console.error('Error searching clients:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to search clients',
                500
            );
        }
    })(request);
}
