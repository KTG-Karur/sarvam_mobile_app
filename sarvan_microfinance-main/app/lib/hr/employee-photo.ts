// ============================================================
// EMPLOYEE PHOTO — which stored photo represents an employee
// app/lib/hr/employee-photo.ts
//
// Same order the employee ID card uses (app/lib/hr/id-card-data.ts):
//   1. latest non-rejected KYC "Photo" document on the employee's own record
//   2. latest non-rejected KYC "Photo" uploaded during their onboarding request
//   3. User.profilePhotoUrl (the self-uploaded avatar) — skipped for the ID card
//      and QR verification page, which use only HR-managed KYC photos
//      (`officialOnly`), since a selfie avatar is not an identity photo.
// Batched (three queries for any number of employees) so list endpoints can
// attach a photo to every row. Returns storage keys — the bucket is private,
// so clients resolve them via /api/storage/signed-url (useSignedUrl).
// ============================================================

import { prisma } from '@/app/lib/prisma';

/** Whether an onboarding request has a non-rejected KYC "Photo" — required before submit and final approval. */
export async function hasUsableOnboardingPhoto(onboardingRequestId: string): Promise<boolean> {
    const photo = await prisma.onboardingDocument.findFirst({
        where: { onboardingRequestId, category: 'KYC', subtype: 'Photo', status: { not: 'REJECTED' } },
        select: { id: true },
    });
    return photo !== null;
}

export async function resolveEmployeePhotoKeys(
    employees: ReadonlyArray<{ id: string; profilePhotoUrl: string | null }>,
    { officialOnly = false }: { officialOnly?: boolean } = {}
): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (employees.length === 0) return result;
    const ids = employees.map((e) => e.id);

    const employeePhotos = await prisma.employeeDocument.findMany({
        where: { employeeId: { in: ids }, category: 'KYC', subtype: 'Photo', status: { not: 'REJECTED' } },
        orderBy: { uploadedAt: 'desc' },
        select: { employeeId: true, fileUrl: true },
    });
    const fromEmployeeDocs = new Map<string, string>();
    for (const doc of employeePhotos) {
        if (!fromEmployeeDocs.has(doc.employeeId)) fromEmployeeDocs.set(doc.employeeId, doc.fileUrl);
    }

    // Onboarding copy only for employees without one on their own record.
    const needOnboarding = ids.filter((id) => !fromEmployeeDocs.has(id));
    const fromOnboarding = new Map<string, string>();
    if (needOnboarding.length > 0) {
        const requests = await prisma.employeeOnboardingRequest.findMany({
            where: { createdUserId: { in: needOnboarding } },
            select: { id: true, createdUserId: true },
        });
        const userByRequest = new Map(requests.map((r) => [r.id, r.createdUserId as string]));
        if (requests.length > 0) {
            const onboardingPhotos = await prisma.onboardingDocument.findMany({
                where: { onboardingRequestId: { in: requests.map((r) => r.id) }, category: 'KYC', subtype: 'Photo', status: { not: 'REJECTED' } },
                orderBy: { uploadedAt: 'desc' },
                select: { onboardingRequestId: true, fileUrl: true },
            });
            for (const doc of onboardingPhotos) {
                const userId = userByRequest.get(doc.onboardingRequestId);
                if (userId && !fromOnboarding.has(userId)) fromOnboarding.set(userId, doc.fileUrl);
            }
        }
    }

    for (const e of employees) {
        const avatar = officialOnly ? null : e.profilePhotoUrl;
        result.set(e.id, fromEmployeeDocs.get(e.id) ?? fromOnboarding.get(e.id) ?? avatar ?? null);
    }
    return result;
}
