import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, successResponse, errorResponse } from '@/app/lib/api-utils';
import { rateLimiter, getClientIp } from '@/app/lib/rate-limit';
import { getUserContext, isEmployeeInCallerScope, getEmployeeAreaBranchIds } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';
import { resolveEmployeePhotoKeys } from '@/app/lib/hr/employee-photo';
import { resolveDisplayBranches } from '@/app/lib/hr/employee-display-branch';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';
import { deriveEmploymentStatus } from '@/app/lib/hr/employment-status';
import { PLACEHOLDER_ORG_CODE } from '@/app/lib/hr/id-card-eligibility';
import type { EmployeeVerificationResult, EmploymentStatus } from '@/app/types/employee-verification';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Generous for a person scanning cards in the field, tight enough that walking
// the (predictable) employee ID sequence to harvest names + photos is slow.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;
const PHOTO_URL_TTL_MS = 10 * 60 * 1000;

const employeeIdSchema = z
    .string()
    .trim()
    .min(1, 'Employee ID is required')
    .max(50, 'Invalid employee ID')
    .regex(/^[A-Za-z0-9._/-]+$/, 'Invalid employee ID');

// The seeded "To Be Assigned" department/designation is a data-entry stand-in,
// not a real role — report it as not recorded rather than publishing it.
function realOrgName(org: { name: string; code: string } | null): string | null {
    if (!org || org.code === PLACEHOLDER_ORG_CODE) return null;
    return org.name;
}

function personName(p: { firstName: string; lastName: string } | null): string | null {
    if (!p) return null;
    return `${p.firstName} ${p.lastName}`.trim() || null;
}

// GET /api/public/verify-employee/[employeeId]
// Target of the QR code on the employee ID card. Always reads the live record —
// nothing on the card itself is trusted. Anonymous callers get only the public
// identification fields below; a signed-in caller who may view this employee's
// HR record (hr-employee:view + branch scope, or the employee themself) also
// gets the `internal` block. Never returned here, to anyone: address, DOB,
// Aadhaar/PAN/bank/ESI/PF numbers, documents, family or emergency contacts —
// those stay on the authenticated HR profile screens.
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ employeeId: string }> }
) {
    try {
        const allowed = await rateLimiter.check(
            `verify-employee:${getClientIp(request)}`,
            RATE_LIMIT,
            RATE_WINDOW_MS
        );
        if (!allowed) return errorResponse('Too many verification requests. Please wait a minute and try again.', 429);

        const checkedAt = new Date().toISOString();
        const parsed = employeeIdSchema.safeParse((await params).employeeId);
        if (!parsed.success) {
            return successResponse<EmployeeVerificationResult>(
                { status: 'NOT_FOUND', checkedAt, employee: null, internal: null },
                'Verification checked'
            );
        }

        const employee = await prisma.user.findFirst({
            where: { employeeId: { equals: parsed.data, mode: 'insensitive' } },
            select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                profilePhotoUrl: true,
                isActive: true,
                dateOfJoining: true,
                dateOfExit: true,
                confirmationDate: true,
                branchId: true,
                email: true,
                mobileNumber: true,
                gender: true,
                bloodGroup: true,
                branch: { select: { name: true, code: true, address: true, district: true, state: true } },
                designation: { select: { name: true, code: true, grade: true } },
                department: { select: { name: true, code: true } },
                shift: { select: { name: true, shiftStart: true, shiftEnd: true } },
                reportingManagerL1: {
                    select: { firstName: true, lastName: true, employeeId: true, designation: { select: { name: true, code: true } } },
                },
            },
        });

        if (!employee || !employee.employeeId) {
            return successResponse<EmployeeVerificationResult>(
                { status: 'NOT_FOUND', checkedAt, employee: null, internal: null },
                'Verification checked'
            );
        }

        const status: EmploymentStatus = deriveEmploymentStatus(employee.isActive, employee.dateOfExit);

        // Same photo the ID card prints (KYC Photo → onboarding Photo → profilePhotoUrl).
        // The bucket is private, so hand back a short-lived signed URL, not the key.
        const photoKey = (await resolveEmployeePhotoKeys([employee], { officialOnly: true })).get(employee.id) ?? null;
        // Area Managers / org-wide staff have no branchId by design — see employee-display-branch.ts.
        const branch = (await resolveDisplayBranches([employee])).get(employee.id) ?? null;
        const photoUrl = photoKey ? await getSignedReadUrl(photoKey, PHOTO_URL_TTL_MS) : null;

        let internal: EmployeeVerificationResult['internal'] = null;
        const ctx = await getUserContext(request);
        if (ctx) {
            const isSelf = ctx.userId === employee.id;
            const canView =
                isSelf ||
                (checkPermission(ctx, { moduleSlug: 'hr-employee', actionSlug: 'view' }).allowed &&
                    (await isEmployeeInCallerScope(
                        ctx,
                        employee.branchId,
                        await getEmployeeAreaBranchIds(employee.id, employee.branchId)
                    )));
            if (canView) {
                const manager = employee.reportingManagerL1;
                internal = {
                    gender: employee.gender,
                    bloodGroup: employee.bloodGroup,
                    grade: employee.designation?.grade ?? null,
                    confirmationDate: employee.confirmationDate?.toISOString() ?? null,
                    shift: employee.shift
                        ? `${employee.shift.name} (${employee.shift.shiftStart} – ${employee.shift.shiftEnd})`
                        : null,
                    reportingManager: manager
                        ? {
                              name: personName(manager),
                              employeeId: manager.employeeId,
                              designation: realOrgName(manager.designation),
                          }
                        : null,
                    email: employee.email,
                    mobileNumber: employee.mobileNumber,
                };
            }
        }

        return successResponse<EmployeeVerificationResult>(
            {
                status,
                checkedAt,
                employee: {
                    employeeId: employee.employeeId,
                    fullName: personName(employee) ?? employee.employeeId,
                    designation: realOrgName(employee.designation),
                    department: realOrgName(employee.department),
                    branchName: branch?.name ?? null,
                    branchCode: branch?.code ?? null,
                    branchAddress:
                        [branch?.address, branch?.district, branch?.state]
                            .filter(Boolean)
                            .join(', ') || null,
                    dateOfJoining: employee.dateOfJoining?.toISOString() ?? null,
                    dateOfExit: employee.dateOfExit?.toISOString() ?? null,
                    photoUrl,
                },
                internal,
            },
            'Verification checked'
        );
    } catch (error: unknown) {
        console.error('Error in employee verification:', error);
        // Don't leak DB/driver messages on a public endpoint.
        return errorResponse('Verification service is temporarily unavailable', 500);
    }
}
