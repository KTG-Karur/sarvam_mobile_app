import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';
import { addMonths } from 'date-fns';
import { buildBranchWhereClause, getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    loanId: z.string().min(1, 'Loan is required'),

    // Master/Org defaults (editable, still validated)
    masterCode: z.string().min(1).default('SCT00JLG'),
    agentCode: z.string().min(1).default('1513471'),
    source: z.string().min(1).default('SARM'),
    cafosCode: z.string().min(1).default('5071186'),
    fscFsmCode: z.string().min(1).default('8433'),

    // Policy basics
    policyType: z.enum(['CREDIT_LIFE', 'HEALTH', 'PERSONAL_ACCIDENT', 'GROUP']).default('CREDIT_LIFE'),
    premiumAmount: z.number().positive('Premium amount must be positive'),
    premiumFrequency: z.enum(['ONE_TIME', 'MONTHLY', 'ANNUAL']).default('ONE_TIME'),

    // Cover type axes
    coverType: z.enum(['SINGLE_LIFE', 'JOINT_LIFE']).default('JOINT_LIFE'),
    coverBasis: z.enum(['LEVEL', 'REDUCING']).default('LEVEL'),

    // Member declaration
    hasMedicalConditions: z.boolean().default(false),
    consentSplitPayment: z.boolean().default(true),

    // Payment details
    utrnNumber: z.string().optional(),
    fundTransferDate: z.string().optional(),

    // Appointee details
    appointeeName: z.string().optional(),
    appointeeSurname: z.string().optional(),
    appointeeGender: z.string().optional(),
    appointeeDob: z.string().optional(),
    appointeeRelationWithNominee: z.string().optional(),
    consentCoverContinuation: z.boolean().default(true),

    // COVID declaration
    covidTestedOrIsolated: z.boolean().default(false),
    covidAdvisedIsolationOrSymptoms: z.boolean().default(false),
    covidTravelOverseas: z.boolean().default(false),

    // Additional member details
    adbSumAssured: z.number().nonnegative().optional(),
    acceleratedTiBenefit: z.number().nonnegative().optional(),

    remarks: z.string().optional(),
});

/**
 * Shared query + report-column enrichment, used by the live paginated GET
 * below and by the Request-Queue export adapter (app/lib/reports/report-registry.ts)
 * so both paths compute the exact same derived fields from a single source.
 * `branchIds: null` means unrestricted (already resolved by the caller).
 */
function buildInsuranceWhereClause(params: { branchIds: string[] | null; status?: string | null; search?: string | null }): any {
    const whereClause: any = { isActive: true };
    if (params.branchIds) {
        whereClause.branchId = params.branchIds.length === 1 ? params.branchIds[0] : { in: params.branchIds };
    }
    if (params.status && params.status !== 'ALL') {
        whereClause.status = params.status;
    }
    if (params.search) {
        whereClause.OR = [
            { policyNumber: { contains: params.search, mode: 'insensitive' } },
            { client: { firstName: { contains: params.search, mode: 'insensitive' } } },
            { client: { lastName: { contains: params.search, mode: 'insensitive' } } },
            { loan: { loanNumber: { contains: params.search, mode: 'insensitive' } } },
            ...memberIdSearchConditions(params.search).map((client) => ({ client })),
        ];
    }
    return whereClause;
}

export async function queryInsuranceReportRows(params: {
    branchIds: string[] | null;
    status?: string | null;
    search?: string | null;
    skip?: number;
    take?: number;
}) {
    const whereClause = buildInsuranceWhereClause(params);

    const records = await prisma.insuranceRecord.findMany({
        where: whereClause,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: params.skip,
        take: params.take,
        include: {
            client: {
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                    mobileNumber: true,
                    gender: true,
                    dateOfBirth: true,
                    permanentAddress: true,
                    district: true,
                    state: true,
                    pincode: true,
                    country: true,
                    occupation: true,
                    nomineeGender: true,
                    nomineeDateOfBirth: true,
                    center: { select: { name: true, code: true } },
                    _count: {
                        select: { loanApplications: true },
                    },
                },
            },
            branch: { select: { id: true, name: true, code: true } },
            loan: {
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    tenureMonths: true,
                    disbursedByBMAt: true,
                    disbursementStatus: true,
                    frequency: true,
                    loanProduct: { select: { numberOfDues: true } },
                    _count: { select: { schedules: true } },
                },
            },
            createdBy: { select: { firstName: true, lastName: true } },
        },
    });

    // Batch-fetch co-applicants for all clients (avoids N+1).
    // Not filtered by isPrimary: existing data has isPrimary=false on every row,
    // so filtering on it would return nothing. Prefer a primary-flagged row when
    // present, otherwise fall back to the earliest co-applicant for that client —
    // mirrors the fallback already used in app/api/co-applicants/route.ts.
    const clientIds = [...new Set(records.map((r) => r.clientId))];
    const coApplicants = clientIds.length
        ? await prisma.coApplicant.findMany({
              where: { clientId: { in: clientIds } },
              select: {
                  clientId: true,
                  isPrimary: true,
                  name: true,
                  gender: true,
                  dateOfBirth: true,
                  age: true,
                  relationWithClient: true,
                  mobileNumber: true,
              },
              orderBy: { createdAt: 'asc' },
          })
        : [];
    const coApplicantByClient = new Map<string, (typeof coApplicants)[number]>();
    for (const c of coApplicants) {
        const existing = coApplicantByClient.get(c.clientId);
        if (!existing || c.isPrimary) {
            coApplicantByClient.set(c.clientId, c);
        }
    }

    // Check for auto-expiry + compute report-only derived fields
    const now = new Date();
    return records.map((record) => {
        const isExpired = record.status === 'ACTIVE' && new Date(record.endDate) < now;

        const salutation =
            record.client.gender === 'Male' ? 'Mr' : record.client.gender === 'Female' ? 'Mrs/Ms' : '';

        const [nomineeFirstName, ...nomineeSurnameParts] = (record.nomineeName || '').trim().split(/\s+/);
        const nomineeSurname = nomineeSurnameParts.join(' ');

        const coApplicant = coApplicantByClient.get(record.clientId) || null;

        const totalDues = record.loan?.loanProduct?.numberOfDues ?? record.loan?._count.schedules ?? 0;
        const installmentsPerMonth =
            record.loan && record.loan.tenureMonths > 0 ? Math.round(totalDues / record.loan.tenureMonths) : null;

        const { providerName: _providerName, ...recordWithoutProvider } = record;

        return {
            ...recordWithoutProvider,
            coverageAmount: Number(record.coverageAmount),
            premiumAmount: Number(record.premiumAmount),
            claimAmount: record.claimAmount ? Number(record.claimAmount) : null,
            adbSumAssured: record.adbSumAssured ? Number(record.adbSumAssured) : null,
            acceleratedTiBenefit: record.acceleratedTiBenefit ? Number(record.acceleratedTiBenefit) : null,
            loan: record.loan ? { ...record.loan, amount: Number(record.loan.amount) } : null,
            computedStatus: isExpired ? 'EXPIRED' : record.status,
            client: {
                ...record.client,
                // Member (no loan yet) vs Client (has at least one loan) label signal
                hasLoan: (record.client._count?.loanApplications ?? 0) > 0,
            },

            // Derived report columns
            salutation,
            address1: record.client.permanentAddress || '',
            address2: '',
            address3: '',
            address4: '',
            city: record.client.district || '',
            nomineeFirstName: nomineeFirstName || '',
            nomineeSurname,
            loanNumber: record.loan?.loanNumber || '',
            loanAmount: record.loan ? Number(record.loan.amount) : null,
            sumAssured: Number(record.coverageAmount),
            ldDate: record.loan?.disbursedByBMAt || null,
            installmentsPerMonth,
            occupation: record.client.occupation || '',
            mobileNumber: record.client.mobileNumber || record.client.phone || '',
            coApplicantFirstName: coApplicant?.name?.split(/\s+/)[0] || '',
            coApplicantLastName: coApplicant ? coApplicant.name.split(/\s+/).slice(1).join(' ') : '',
            coApplicantDob: coApplicant?.dateOfBirth || null,
            coApplicantGender: coApplicant?.gender || '',
            coApplicantRelation: coApplicant?.relationWithClient || '',
            coApplicantHouseFlat: coApplicant ? record.client.permanentAddress || '' : '',
            coApplicantStreet: '',
            coApplicantArea: '',
            coApplicantCity: coApplicant ? record.client.district || '' : '',
            coApplicantState: coApplicant ? record.client.state || '' : '',
            coApplicantZip: coApplicant ? record.client.pincode || '' : '',
        };
    });
}

/**
 * GET /api/reports/others/insurance-report
 * Fetches insurance records with branch-based access control.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchFilter = searchParams.get('branchId');
            const statusFilter = searchParams.get('status');
            const searchQuery = searchParams.get('search');

            // Branch-level access control. BRANCH_MANAGER is locked to their own
            // branch; AREA_MANAGER is scoped to their full assigned-branch set
            // (optionally narrowed to one via branchFilter); ADMIN is unrestricted
            // unless branchFilter is given. A requested branch outside the caller's
            // permitted set is ignored rather than honored (fail-safe).
            const branchWhere: any = await buildBranchWhereClause(user, branchFilter);
            const branchIds: string[] | null = branchWhere.branchId
                ? (typeof branchWhere.branchId === 'string' ? [branchWhere.branchId] : branchWhere.branchId.in)
                : null;

            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(5000, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));

            const whereClause = buildInsuranceWhereClause({ branchIds, status: statusFilter, search: searchQuery });

            // KPI stats (total/active/expired/coverage) are computed via a separate,
            // unpaginated but lightweight pass over every matching row — decoupled
            // from the paginated detail rows below, so the cards always reflect the
            // full filtered set rather than just the current page.
            const [totalCount, pageRows, statsRows] = await Promise.all([
                prisma.insuranceRecord.count({ where: whereClause }),
                queryInsuranceReportRows({
                    branchIds,
                    status: statusFilter,
                    search: searchQuery,
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                }),
                prisma.insuranceRecord.findMany({ where: whereClause, select: { status: true, endDate: true, coverageAmount: true } }),
            ]);

            const nowForStats = new Date();
            const stats = statsRows.reduce(
                (acc, r) => {
                    const isExpired = r.status === 'ACTIVE' && new Date(r.endDate) < nowForStats;
                    const computedStatus = isExpired ? 'EXPIRED' : r.status;
                    if (computedStatus === 'ACTIVE') {
                        acc.active += 1;
                        acc.totalCoverage += Number(r.coverageAmount);
                    } else if (computedStatus === 'EXPIRED') {
                        acc.expired += 1;
                    }
                    return acc;
                },
                { active: 0, expired: 0, totalCoverage: 0 }
            );

            return successResponse(
                {
                    data: pageRows,
                    totalCount,
                    totalPages: Math.ceil(totalCount / pageSize),
                    page,
                    pageSize,
                    stats: { total: totalCount, active: stats.active, expired: stats.expired, totalCoverage: stats.totalCoverage },
                },
                'Insurance records fetched successfully'
            );
        } catch (error) {
            console.error('[Insurance] Error fetching records:', error);
            return errorResponse('Failed to fetch insurance records', 500);
        }
    })(request);
}

/**
 * POST /api/reports/others/insurance-report
 * Create a new insurance record from a disbursed loan.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await req.json();
            const validation = createSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const data = validation.data;

            const loan = await prisma.loan.findUnique({
                where: { id: data.loanId },
                select: {
                    id: true,
                    loanNumber: true,
                    amount: true,
                    tenureMonths: true,
                    branchId: true,
                    clientId: true,
                    disbursedByBMAt: true,
                    disbursementStatus: true,
                    client: {
                        select: {
                            nomineeName: true,
                            nomineeRelation: true,
                            nomineeAge: true,
                        },
                    },
                },
            });
            if (!loan) return errorResponse('Loan not found', 404);

            // Branch access guard — role-agnostic; any branch the user is assigned to
            // (UserBranchAssignment / AreaManagerBranch), not just their primary/active branch.
            {
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(loan.branchId)) {
                    return errorResponse('Access denied to this loan', 403);
                }
            }

            if (loan.disbursementStatus !== 'DISBURSED') {
                return errorResponse('Insurance can only be added for a disbursed loan', 400);
            }

            // Duplicate guard: one active insurance record per loan
            const existingForLoan = await prisma.insuranceRecord.findFirst({
                where: { loanId: loan.id, isActive: true },
            });
            if (existingForLoan) {
                return errorResponse('An active insurance record already exists for this loan', 409);
            }

            const startDate = loan.disbursedByBMAt ?? new Date();
            const endDate = addMonths(startDate, loan.tenureMonths);

            // Generate a unique policy number from the loan number, retrying once on collision
            let policyNumber = `${loan.loanNumber}-POL`;
            const collision = await prisma.insuranceRecord.findUnique({ where: { policyNumber } });
            if (collision) {
                policyNumber = `${loan.loanNumber}-POL-${Date.now().toString(36).toUpperCase()}`;
            }

            const record = await prisma.insuranceRecord.create({
                data: {
                    clientId: loan.clientId,
                    branchId: loan.branchId,
                    loanId: loan.id,

                    masterCode: data.masterCode,
                    agentCode: data.agentCode,
                    source: data.source,
                    cafosCode: data.cafosCode,
                    fscFsmCode: data.fscFsmCode,

                    policyNumber,
                    policyType: data.policyType,

                    coverageAmount: loan.amount,
                    premiumAmount: data.premiumAmount,
                    premiumFrequency: data.premiumFrequency,

                    coverType: data.coverType,
                    coverBasis: data.coverBasis,

                    startDate,
                    endDate,

                    nomineeName: loan.client.nomineeName || null,
                    nomineeRelationship: loan.client.nomineeRelation || null,
                    nomineeAge: loan.client.nomineeAge || null,

                    hasMedicalConditions: data.hasMedicalConditions,
                    consentSplitPayment: data.consentSplitPayment,
                    consentCoverContinuation: data.consentCoverContinuation,

                    utrnNumber: data.utrnNumber || null,
                    fundTransferDate: data.fundTransferDate ? new Date(data.fundTransferDate) : null,

                    appointeeName: data.appointeeName || null,
                    appointeeSurname: data.appointeeSurname || null,
                    appointeeGender: data.appointeeGender || null,
                    appointeeDob: data.appointeeDob ? new Date(data.appointeeDob) : null,
                    appointeeRelationWithNominee: data.appointeeRelationWithNominee || null,

                    covidTestedOrIsolated: data.covidTestedOrIsolated,
                    covidAdvisedIsolationOrSymptoms: data.covidAdvisedIsolationOrSymptoms,
                    covidTravelOverseas: data.covidTravelOverseas,

                    adbSumAssured: data.adbSumAssured ?? null,
                    acceleratedTiBenefit: data.acceleratedTiBenefit ?? null,

                    remarks: data.remarks || null,
                    createdById: user.userId,
                },
            });

            const { providerName: _providerName, ...recordWithoutProvider } = record;
            return successResponse(recordWithoutProvider, 'Insurance record created successfully', 201);
        } catch (error) {
            console.error('[Insurance] Error creating record:', error);
            return errorResponse('Failed to create insurance record', 500);
        }
    })(request);
}
