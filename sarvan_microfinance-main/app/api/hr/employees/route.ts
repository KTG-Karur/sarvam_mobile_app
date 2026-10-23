import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { buildBranchWhereClause } from '@/app/lib/permissions/branch-scope';
import { resolveEmployeePhotoKeys } from '@/app/lib/hr/employee-photo';
import { getIdCardStatusForUsers } from '@/app/lib/hr/id-card-data';
import { summarizeIdCardStatus } from '@/app/lib/hr/id-card-eligibility';
import { resolveDisplayBranches } from '@/app/lib/hr/employee-display-branch';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const EMPLOYEE_LIST_SELECT = {
    id: true,
    employeeId: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
    dateOfJoining: true,
    confirmationDate: true,
    dateOfExit: true,
    profilePhotoUrl: true,
    mobileNumber: true,
    email: true,
    branchId: true,
    branch: { select: { id: true, name: true, code: true } },
    departmentId: true,
    department: { select: { id: true, name: true } },
    designationId: true,
    designation: { select: { id: true, name: true, grade: true } },
    shiftId: true,
    shift: { select: { id: true, name: true, shiftStart: true, shiftEnd: true } },
} as const;

// GET /api/hr/employees
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const departmentId = searchParams.get('departmentId');
            const designationId = searchParams.get('designationId');
            const branchId = searchParams.get('branchId');
            const shiftId = searchParams.get('shiftId');
            const role = searchParams.get('role');
            const status = searchParams.get('status'); // 'active' | 'inactive' | 'all'
            const search = searchParams.get('search');

            // Fail-safe branch scoping: a requested branchId outside the caller's
            // permitted set is ignored rather than honored (see buildBranchWhereClause) —
            // a branch-restricted user can no longer widen the query via ?branchId=.
            const where: any = await buildBranchWhereClause(user, branchId);
            if (departmentId) where.departmentId = departmentId;
            if (designationId) where.designationId = designationId;
            if (shiftId) where.shiftId = shiftId;
            if (role) where.role = { equals: role, mode: 'insensitive' };
            if (status === 'active') where.isActive = true;
            else if (status === 'inactive') where.isActive = false;
            if (search) {
                where.OR = [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { employeeId: { contains: search, mode: 'insensitive' } },
                    { mobileNumber: { contains: search, mode: 'insensitive' } },
                ];
            }

            const employees = await prisma.user.findMany({
                where,
                select: EMPLOYEE_LIST_SELECT,
                orderBy: { firstName: 'asc' },
            });

            // Additive: the ID-card photo (KYC "Photo" document, then the
            // onboarding copy, then profilePhotoUrl) as a storage key, so
            // employee pickers can show real photos — see employee-photo.ts.
            const photoKeys = await resolveEmployeePhotoKeys(employees);
            const withPhotos = employees.map((e) => ({ ...e, photoKey: photoKeys.get(e.id) ?? null }));

            // Opt-in (?includeIdCard=1, the Employee List): ID card status per row,
            // so HR sees who can get a card without clicking each one. Only the
            // status and issue messages are returned — never the card fields.
            if (searchParams.get('includeIdCard') === '1') {
                const idCardStatuses = await getIdCardStatusForUsers(employees.map((e) => e.id));
                // Area Managers / org-wide staff have no branchId by design; show
                // the branch they're shown under on the card (display only).
                const displayBranches = await resolveDisplayBranches(
                    employees.filter((e) => !e.branch).map((e) => ({ id: e.id, branch: null }))
                );
                const withIdCard = withPhotos.map((e) => {
                    const result = idCardStatuses.get(e.id);
                    const display = displayBranches.get(e.id);
                    return {
                        ...e,
                        displayBranch: display ? { name: display.name, code: display.code, source: display.source } : null,
                        idCard: result
                            ? {
                                  status: summarizeIdCardStatus(result.eligibility),
                                  issues: result.eligibility.issues.map((i) => i.message),
                                  issuedAt: result.issuedAt,
                                  reprintRequired: result.eligibility.eligible && result.reprintRequired,
                              }
                            : null,
                    };
                });
                return successResponse(withIdCard, 'Employees fetched successfully');
            }

            return successResponse(withPhotos, 'Employees fetched successfully');
        } catch (error: any) {
            console.error('Error fetching employees:', error);
            return errorResponse(error.message || 'Failed to fetch employees', 500);
        }
    })(request);
}
