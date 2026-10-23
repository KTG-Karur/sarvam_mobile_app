import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope, getEmployeeAreaBranchIds } from '@/app/lib/permissions/guards';
import type { UserContext } from '@/app/lib/permissions/types';
import { computeCtcBreakdown, yearCtcFromMonthly } from '@/app/lib/payroll/calculation';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { applyCtcChange } from '@/app/lib/hr/apply-ctc-change';
import { FIELD_PATTERNS, FIELD_ERROR_MESSAGES } from '@/app/lib/hr/onboarding-form-fields';
import { checkOnboardingDuplicates, formatInternalDuplicateMessage, normalizeOnboardingIdentityFields, ONBOARDING_IDENTITY_FIELDS } from '@/app/lib/hr/onboarding-duplicate-check';
import { findMissingRequiredEmployeeFields } from '@/app/lib/hr/employee-required-fields';
import { hrOnboardingValidationService } from '@/app/lib/services/hr-onboarding-validation.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const EMPLOYEE_DETAIL_SELECT = {
    id: true,
    employeeId: true,
    firstName: true,
    lastName: true,
    role: true,
    isActive: true,
    dateOfJoining: true,
    dateOfExit: true,
    confirmationDate: true,
    profilePhotoUrl: true,
    mobileNumber: true,
    email: true,
    branchId: true,
    branch: { select: { id: true, name: true, code: true } },
    shiftId: true,
    shift: { select: { id: true, name: true, shiftStart: true, shiftEnd: true } },
    orgRegion: { select: { id: true, name: true } },
    orgDivision: { select: { id: true, name: true } },
    departmentId: true,
    department: { select: { id: true, name: true } },
    designationId: true,
    designation: { select: { id: true, name: true, grade: true, basicPercent: true, hraPercent: true } },
    employeeCtcMaster: { select: { monthlyCtc: true } },
    reportingManagerL1Id: true,
    reportingManagerL1: { select: { id: true, firstName: true, lastName: true } },
    reportingManagerL2Id: true,
    reportingManagerL2: { select: { id: true, firstName: true, lastName: true } },
    reportingManagerL3Id: true,
    reportingManagerL3: { select: { id: true, firstName: true, lastName: true } },
    gender: true,
    dob: true,
    maritalStatus: true,
    bloodGroup: true,
    education: true,
    dlNumber: true,
    voterIdNumber: true,
    insuranceCompanyName: true,
    insurancePolicyNumber: true,
    insuranceValidFrom: true,
    insuranceValidTo: true,
    fatherName: true,
    fatherAge: true,
    fatherAadhaarNumber: true,
    motherName: true,
    motherAge: true,
    motherAadhaarNumber: true,
    children: true,
    wifeName: true,
    wifeAge: true,
    wifeAadhaarNumber: true,
    wifeBankAccountNumber: true,
    wifeIfscCode: true,
    wifeContactNumber: true,
    husbandName: true,
    husbandAge: true,
    husbandAadhaarNumber: true,
    husbandBankAccountNumber: true,
    husbandIfscCode: true,
    husbandContactNumber: true,
    weddingDate: true,
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
} as const;

const optionalPattern = (pattern: RegExp, errorMessage: string) =>
    z.string().nullable().optional().refine(
        (val) => !val || val.trim() === '' || pattern.test(val.trim()),
        { message: errorMessage }
    );

const optionalPan = z.string().nullable().optional().refine(
    (val) => !val || val.trim() === '' || FIELD_PATTERNS.PAN.test(val.trim().toUpperCase()),
    { message: FIELD_ERROR_MESSAGES.PAN }
);

const optionalIfsc = (errorMessage: string) =>
    z.string().nullable().optional().refine(
        (val) => !val || val.trim() === '' || FIELD_PATTERNS.IFSC.test(val.trim().toUpperCase()),
        { message: errorMessage }
    );

const optionalDob = z.coerce.date().nullable().optional().refine(
    (dob) => {
        if (!dob) return true;
        const today = new Date();
        if (dob > today) return false;
        let age = today.getFullYear() - dob.getFullYear();
        const m = today.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
        return age >= 18 && age <= 100;
    },
    { message: FIELD_ERROR_MESSAGES.DOB_MIN_AGE }
);

const updateEmployeeSchema = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    mobileNumber: optionalPattern(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.MOBILE),
    email: z.string().nullable().optional().refine(
        (val) => !val || val.trim() === '' || FIELD_PATTERNS.EMAIL.test(val.trim()),
        { message: FIELD_ERROR_MESSAGES.EMAIL }
    ),
    departmentId: z.string().optional().nullable(),
    designationId: z.string().optional().nullable(),
    reportingManagerL1Id: z.string().optional().nullable(),
    reportingManagerL2Id: z.string().optional().nullable(),
    reportingManagerL3Id: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    dob: optionalDob,
    dateOfJoining: z.coerce.date().optional().nullable(),
    maritalStatus: z.string().optional().nullable(),
    bloodGroup: z.string().optional().nullable(),
    education: z.string().optional().nullable(),
    dlNumber: z.string().optional().nullable(),
    voterIdNumber: z.string().optional().nullable(),
    insuranceCompanyName: z.string().optional().nullable(),
    insurancePolicyNumber: z.string().optional().nullable(),
    insuranceValidFrom: z.coerce.date().optional().nullable(),
    insuranceValidTo: z.coerce.date().optional().nullable(),
    fatherName: z.string().optional().nullable(),
    fatherAge: z.coerce.number().int().optional().nullable(),
    fatherAadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.FATHER_AADHAAR),
    motherName: z.string().optional().nullable(),
    motherAge: z.coerce.number().int().optional().nullable(),
    motherAadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.MOTHER_AADHAAR),
    children: z.array(z.object({
        gender: z.string(),
        age: z.string(),
        aadhaarNumber: z.string().refine(
            (val) => !val || val.trim() === '' || FIELD_PATTERNS.AADHAAR.test(val.trim()),
            { message: FIELD_ERROR_MESSAGES.CHILD_AADHAAR }
        ),
    })).optional(),
    wifeName: z.string().optional().nullable(),
    wifeAge: z.coerce.number().int().optional().nullable(),
    wifeAadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR),
    wifeBankAccountNumber: optionalPattern(FIELD_PATTERNS.BANK_ACCOUNT, FIELD_ERROR_MESSAGES.SPOUSE_BANK),
    wifeIfscCode: optionalIfsc(FIELD_ERROR_MESSAGES.SPOUSE_IFSC),
    wifeContactNumber: optionalPattern(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.SPOUSE_CONTACT),
    husbandName: z.string().optional().nullable(),
    husbandAge: z.coerce.number().int().optional().nullable(),
    husbandAadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.SPOUSE_AADHAAR),
    husbandBankAccountNumber: optionalPattern(FIELD_PATTERNS.BANK_ACCOUNT, FIELD_ERROR_MESSAGES.SPOUSE_BANK),
    husbandIfscCode: optionalIfsc(FIELD_ERROR_MESSAGES.SPOUSE_IFSC),
    husbandContactNumber: optionalPattern(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.SPOUSE_CONTACT),
    weddingDate: z.coerce.date().optional().nullable(),
    aadhaarNumber: optionalPattern(FIELD_PATTERNS.AADHAAR, FIELD_ERROR_MESSAGES.AADHAAR),
    panNumber: optionalPan,
    uanNumber: optionalPattern(FIELD_PATTERNS.UAN, FIELD_ERROR_MESSAGES.UAN),
    esiNumber: optionalPattern(FIELD_PATTERNS.ESI, FIELD_ERROR_MESSAGES.ESI),
    pfNumber: optionalPattern(FIELD_PATTERNS.UAN, FIELD_ERROR_MESSAGES.UAN),
    address: z.string().optional().nullable(),
    permanentAddress: z.string().optional().nullable(),
    sameAsCurrentAddress: z.boolean().optional(),
    emergencyContactName: z.string().optional().nullable(),
    emergencyContactRelation: z.string().optional().nullable(),
    emergencyContactMobile: optionalPattern(FIELD_PATTERNS.MOBILE, FIELD_ERROR_MESSAGES.EMERGENCY_MOBILE),
    bankName: z.string().optional().nullable(),
    bankBranchName: z.string().optional().nullable(),
    bankAccountNumber: optionalPattern(FIELD_PATTERNS.BANK_ACCOUNT, FIELD_ERROR_MESSAGES.BANK_ACCOUNT),
    bankIfscCode: optionalIfsc(FIELD_ERROR_MESSAGES.IFSC),
    // Organization tab's Month CTC Pay — a direct edit (matches Department/
    // Designation on the same tab), still logged to EmployeeCtcHistory below.
    monthlyCtc: z.number().min(0).optional(),
}).superRefine((data, ctx) => {
    // Same cross-field rule intake enforces (validateOnboardingServerRules).
    if (data.insuranceValidFrom && data.insuranceValidTo && data.insuranceValidTo < data.insuranceValidFrom) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: FIELD_ERROR_MESSAGES.INSURANCE_DATES, path: ['insuranceValidTo'] });
    }
});

// Shared HR rule (guards.ts): HO, admins and org-scope Head Office see everyone;
// otherwise the caller's branches + org-scope coverage. An Area Manager
// (branchId null by design) is reachable through their AreaManagerBranch rows.
async function isBranchPermitted(ctx: UserContext, employeeId: string, employeeBranchId: string | null): Promise<boolean> {
    const areaBranchIds = await getEmployeeAreaBranchIds(employeeId, employeeBranchId);
    return isEmployeeInCallerScope(ctx, employeeBranchId, areaBranchIds);
}

// GET /api/hr/employees/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const employee = await prisma.user.findUnique({
            where: { id },
            select: EMPLOYEE_DETAIL_SELECT,
        });
        if (!employee) return errorResponse('Employee not found', 404);

        if (!(await isBranchPermitted(ctx, id, employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        // Read-only salary summary for the Organization tab — Month/Year CTC
        // Pay plus the Designation-% derived Basic/HRA split. Editing PF/ESI/
        // Other Deductions/etc. stays on the dedicated Salary Master page;
        // this is just what "other salary related" looks like at a glance.
        const monthlyCtc = employee.employeeCtcMaster ? Number(employee.employeeCtcMaster.monthlyCtc) : 0;
        const basicPercent = Number(employee.designation?.basicPercent ?? 70);
        const hraPercent = Number(employee.designation?.hraPercent ?? 30);
        const { basic, hra } = computeCtcBreakdown({ monthlyCtc, basicPercent, hraPercent, workingDays: 30, totalPaidDays: 30 });

        return successResponse({
            ...employee,
            salarySummary: { monthlyCtc, yearCtc: yearCtcFromMonthly(monthlyCtc), basicPercent, hraPercent, basic, hra },
        }, 'Employee fetched successfully');
    } catch (error: any) {
        console.error('Error fetching employee:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch employee';
        return errorResponse(message, 500);
    }
}

// PATCH /api/hr/employees/[id]
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.user.findUnique({ where: { id }, select: { branchId: true, maritalStatus: true, gender: true } });
        if (!existing) return errorResponse('Employee not found', 404);

        if (!(await isBranchPermitted(ctx, id, existing.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        const body = await request.json();
        const { monthlyCtc, ...data } = updateEmployeeSchema.parse(body);

        if (data.isActive === false && id === ctx.userId) {
            return errorResponse('You cannot deactivate your own account', 400);
        }

        // Switching an employee on/off directly skips the Exit & Clearance
        // workflow (department clearances, belongings, NDC, relieving letter), so
        // it stays an administrator-only override — matching who the list page
        // should offer the button to.
        if (data.isActive !== undefined && !ctx.roles.some((r) => r.roleSlug === 'admin')) {
            return errorResponse('Only an administrator can activate or deactivate an employee — use Exit & Clearance for a regular exit', 403);
        }

        // Whatever the admin marks Required on the Onboarding Field Validation
        // page must hold here too, not just in the browser — checked only for
        // fields this payload actually sets, so a partial update (e.g. the
        // list's active toggle) is never blocked by fields it doesn't touch.
        const fieldConfig = await hrOnboardingValidationService.getConfig();
        const requiredKeys = new Set(fieldConfig.filter((c) => c.isRequired).map((c) => c.fieldKey));
        const normalizeChoice = (value: string | null | undefined) => (value ?? '').trim().toUpperCase();
        const missing = findMissingRequiredEmployeeFields(data, requiredKeys, {
            maritalStatus: normalizeChoice('maritalStatus' in data ? data.maritalStatus : existing.maritalStatus),
            gender: normalizeChoice('gender' in data ? data.gender : existing.gender),
        });
        if (missing.length > 0) {
            const labels = missing.map((key) => fieldConfig.find((c) => c.fieldKey === key)?.fieldLabel ?? key);
            return errorResponse(`Please fill in: ${labels.join(', ')}`, 400);
        }

        // Same identity-number uniqueness intake enforces (mobile, Aadhaar,
        // PAN, DL, Voter ID, UAN) — against every other active employee and
        // in-flight onboarding request, excluding this employee themselves.
        const identityInput = Object.fromEntries(
            ONBOARDING_IDENTITY_FIELDS.filter((field) => field in data).map((field) => [field, data[field]])
        ) as Parameters<typeof normalizeOnboardingIdentityFields>[0];
        const { hit: duplicateHit } = await checkOnboardingDuplicates(prisma, identityInput, undefined, id);
        if (duplicateHit) {
            return errorResponse(formatInternalDuplicateMessage(duplicateHit), 409);
        }
        const writeData = { ...data, ...normalizeOnboardingIdentityFields(identityInput) };

        const updated = await prisma.$transaction(async (tx) => {
            const result = await tx.user.update({
                where: { id },
                data: writeData,
                select: EMPLOYEE_DETAIL_SELECT,
            });

            // Organization tab's Month CTC Pay — direct edit (same as
            // Department/Designation on this tab), logged to history so it
            // shows up on the employee's History tab alongside role changes.
            if (monthlyCtc !== undefined) {
                await applyCtcChange(tx, {
                    employeeId: id,
                    newMonthlyCtc: monthlyCtc,
                    source: 'MANUAL_EDIT',
                    effectiveDate: new Date(getKolkataCalendarYmd(new Date())),
                    actorUserId: ctx.userId,
                });
            }

            return result;
        });

        if (data.isActive !== undefined) {
            console.info(`[Employee Status Change] ${ctx.userId} set employee ${id} (${updated.employeeId ?? id}) isActive=${data.isActive}`);
        }

        return successResponse(updated, 'Employee updated successfully');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        // User.mobileNumber is globally unique (inactive employees included), which
        // the active-only duplicate check above can't see.
        if (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002') {
            return errorResponse('This mobile number is already registered to another employee', 409);
        }
        console.error('Error updating employee:', error);
        const message = error instanceof Error ? error.message : 'Failed to update employee';
        return errorResponse(message, 500);
    }
}
