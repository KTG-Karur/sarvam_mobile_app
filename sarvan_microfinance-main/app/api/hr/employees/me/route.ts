import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getOnboardingApprovalStageCount } from '@/app/lib/hr/onboarding-approval-levels';
import { hasReportingHierarchy } from '@/app/lib/hr/reporting-hierarchy';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/employees/me — self profile, always own record, no branch-scope check needed.
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            const employee = await prisma.user.findUnique({
                where: { id: user.userId },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    isActive: true,
                    dateOfJoining: true,
                    profilePhotoUrl: true,
                    mobileNumber: true,
                    email: true,
                    branch: { select: { id: true, name: true, code: true } },
                    department: { select: { id: true, name: true } },
                    designation: { select: { id: true, name: true, grade: true } },
                    gender: true,
                    dob: true,
                    maritalStatus: true,
                    bloodGroup: true,
                    education: true,
                    aadhaarNumber: true,
                    panNumber: true,
                    uanNumber: true,
                    esiNumber: true,
                    pfNumber: true,
                    address: true,
                    permanentAddress: true,
                    sameAsCurrentAddress: true,
                    emergencyContactName: true,
                    emergencyContactRelation: true,
                    emergencyContactMobile: true,
                    bankName: true,
                    bankBranchName: true,
                    bankAccountNumber: true,
                    bankIfscCode: true,
                    fatherName: true,
                    motherName: true,
                    wifeName: true,
                    wifeAge: true,
                    husbandName: true,
                    husbandAge: true,
                    weddingDate: true,
                    reportingManagerL1: { select: { id: true, firstName: true, lastName: true } },
                    reportingManagerL2: { select: { id: true, firstName: true, lastName: true } },
                    reportingManagerL3: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            if (!employee) return errorResponse('Employee record not found', 404);

            const fieldConfigs = await prisma.employeeFieldConfig.findMany({
                where: { isVisibleToEmployee: false },
                select: { fieldKey: true },
            });
            const hiddenKeys = new Set(fieldConfigs.map((c) => c.fieldKey));
            for (const key of hiddenKeys) {
                if (key in employee) (employee as any)[key] = undefined;
            }

            // Reporting Manager L1/L2/L3 are only shown while the onboarding
            // approval chain has more than one level (see Approval Settings).
            const showReportingManagers = hasReportingHierarchy(await getOnboardingApprovalStageCount());

            return successResponse({ ...employee, showReportingManagers }, 'Profile fetched successfully');
        } catch (error: any) {
            console.error('Error fetching own profile:', error);
            return errorResponse(error.message || 'Failed to fetch profile', 500);
        }
    })(request);
}
