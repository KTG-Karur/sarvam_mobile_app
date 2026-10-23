import { NextRequest } from 'next/server';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/app/lib/prisma';
import {
  errorResponse,
  successResponse,
  withRole,
  handleCorsPreflight,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const opt = () => z.string().trim().optional().nullable();
const optNum = () => z.union([z.number(), z.string()]).optional().nullable();

function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(String(v), 10);
  return isNaN(n) ? null : n;
}

function toDecimal(v: unknown): Decimal | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : new Decimal(n);
}

function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function toDate(v: unknown): Date | null {
  if (!v || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    const d = new Date(Date.UTC(year, month - 1, day));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ── KYC document sub-schema ───────────────────────────────────────────────────

const kycDocSchema = z.object({
  documentType:   z.string(),
  documentNumber: opt(),
  fileUrl:        opt(),
  fileName:       opt(),
  fileSize:       optNum(),
  mimeType:       opt(),
});

// ── Full draft schema ─────────────────────────────────────────────────────────

const draftSchema = z.object({
  // ── KYC IDs ────────────────────────────────────────────────────────────────
  mobileNumber:  z.string().trim().min(10, 'Mobile number is required'),
  votersIdNo:    opt(),
  caVoterIdNo:   opt(),
  otherIdNo:     opt(),
  caOtherIdNo:   opt(),
  pancardNo:     opt(),
  caPancardNo:   opt(),
  smartCardNo:   opt(),

  // ── Client personal ────────────────────────────────────────────────────────
  firstName:     opt(),
  lastName:      opt(),
  phone:         opt(),
  email:         opt(),
  dateOfBirth:   opt(),
  age:           optNum(),
  gender:        opt(),
  caste:         opt(),
  community:     opt(),
  religion:      opt(),
  qualification: opt(),
  maritalStatus: opt(),
  houseStatus:   opt(),
  fatherName:    opt(),
  motherName:    opt(),
  noOfChildren:  optNum(),

  // ── Address ────────────────────────────────────────────────────────────────
  permanentAddress: opt(),
  pincode:          opt(),
  postOffice:       opt(),
  district:         opt(),
  state:            opt(),
  country:          opt(),
  latitude:         opt(),
  longitude:        opt(),

  // ── Occupation / income ────────────────────────────────────────────────────
  economicActivityTypeId: opt(),
  economicActivityId:     opt(),
  monthlyFamilyIncome:    optNum(),
  monthlyFamilyExpense:   optNum(),

  // ── Spouse ────────────────────────────────────────────────────────────────
  spouseName:                  opt(),
  spouseDob:                   opt(),
  spouseMobileNumber:          opt(),
  spouseGender:                opt(),
  spouseEconomicActivityTypeId:opt(),
  spouseEconomicActivityId:    opt(),

  // ── Co-Applicant ──────────────────────────────────────────────────────────
  coApplicantEconomicActivityTypeId: opt(),
  coApplicantEconomicActivityId:     opt(),

  // ── Banking ───────────────────────────────────────────────────────────────
  ifscCode:        opt(),
  bankAcNo:        opt(),
  bankName:        opt(),
  bankBranch:      opt(),
  bankAccountType: opt(),

  // ── Nominee ───────────────────────────────────────────────────────────────
  nomineeName:        opt(),
  nomineeRelation:    opt(),
  nomineePhone:       opt(),
  nomineeGender:      opt(),
  nomineeDateOfBirth: opt(),
  nomineeAge:         optNum(),

  // ── Loan product ──────────────────────────────────────────────────────────
  requestedLoanProductId:     opt(),
  requestedLoanProductTypeId: opt(),
  requestedLoanFrequency:     opt(),
  requestedLoanPurposeTypeId: opt(),
  requestedLoanPurposeId:     opt(),

  // ── Group Request ─────────────────────────────────────────────────────────
  memberGroupStatus: opt(),
  requestedCenterId: opt(),
  requestedGroupId:  opt(),

  // ── KYC documents (uploaded files) ────────────────────────────────────────
  kycDocuments: z.array(kycDocSchema).optional().default([]),

  // ── Meta ──────────────────────────────────────────────────────────────────
  existingClientId: opt(),
});

type DraftInput = z.infer<typeof draftSchema>;

// ── Build Prisma data object from validated input ─────────────────────────────
// Does NOT include enrolledById — add it at the call site where required.

function buildClientData(data: DraftInput) {
  return {
    mobileNumber:  data.mobileNumber,
    firstName:     data.firstName  || '',
    lastName:      data.lastName   || '',
    phone:         data.phone      ?? null,
    email:         data.email      ?? null,
    dateOfBirth:   toDate(data.dateOfBirth),
    age:           toInt(data.age),
    gender:        data.gender        ?? null,
    caste:         data.caste         ?? null,
    community:     data.community     ?? null,
    religion:      data.religion      ?? null,
    qualification: data.qualification ?? null,
    maritalStatus: data.maritalStatus ?? null,
    houseStatus:   data.houseStatus   ?? null,
    fatherName:    data.fatherName    ?? null,
    motherName:    data.motherName    ?? null,
    noOfChildren:  toInt(data.noOfChildren),
    permanentAddress: data.permanentAddress ?? null,
    pincode:       data.pincode    ?? null,
    postOffice:    data.postOffice ?? null,
    district:      data.district   ?? null,
    state:         data.state      ?? null,
    country:       data.country    || 'India',
    latitude:      toFloat(data.latitude),
    longitude:     toFloat(data.longitude),
    economicActivityTypeId: data.economicActivityTypeId ?? null,
    economicActivityId:     data.economicActivityId     ?? null,
    monthlyFamilyIncome:    toDecimal(data.monthlyFamilyIncome),
    monthlyFamilyExpense:   toDecimal(data.monthlyFamilyExpense),
    spouseName:                   data.spouseName                   ?? null,
    spouseDob:                    toDate(data.spouseDob),
    spouseMobileNumber:           data.spouseMobileNumber           ?? null,
    spouseGender:                 data.spouseGender                 ?? null,
    spouseEconomicActivityTypeId: data.spouseEconomicActivityTypeId ?? null,
    spouseEconomicActivityId:     data.spouseEconomicActivityId     ?? null,
    coApplicantEconomicActivityTypeId: data.coApplicantEconomicActivityTypeId ?? null,
    coApplicantEconomicActivityId:     data.coApplicantEconomicActivityId     ?? null,
    ifscCode:        data.ifscCode        ?? null,
    bankAcNo:        data.bankAcNo        ?? null,
    bankName:        data.bankName        ?? null,
    bankBranch:      data.bankBranch      ?? null,
    bankAccountType: data.bankAccountType ?? null,
    votersIdNo:      data.votersIdNo      ?? null,
    caVoterIdNo:     data.caVoterIdNo     ?? null,
    otherIdNo:       data.otherIdNo       ?? null,
    caOtherIdNo:     data.caOtherIdNo     ?? null,
    pancardNo:       data.pancardNo       ?? null,
    caPancardNo:     data.caPancardNo     ?? null,
    smartCardNo:     data.smartCardNo     ?? null,
    nomineeName:        data.nomineeName        ?? null,
    nomineeRelation:    data.nomineeRelation    ?? null,
    nomineePhone:       data.nomineePhone       ?? null,
    nomineeGender:      data.nomineeGender      ?? null,
    nomineeDateOfBirth: toDate(data.nomineeDateOfBirth),
    nomineeAge:         toInt(data.nomineeAge),
    requestedLoanProductId:     data.requestedLoanProductId     ?? null,
    requestedLoanProductTypeId: data.requestedLoanProductTypeId ?? null,
    requestedLoanFrequency:     data.requestedLoanFrequency     ?? null,
    requestedLoanPurposeTypeId: data.requestedLoanPurposeTypeId ?? null,
    requestedLoanPurposeId:     data.requestedLoanPurposeId     ?? null,
    memberGroupStatus:          (data.memberGroupStatus as any) ?? null,
    requestedCenterId:          data.requestedCenterId          ?? null,
    requestedGroupId:           data.requestedGroupId           ?? null,
  };
}

// ── Upsert KYC document records for a draft client ───────────────────────────

async function upsertKycDocuments(
  clientDbId: string,
  uploadedById: string,
  docs: DraftInput['kycDocuments'],
) {
  if (!docs?.length) return;

  for (const doc of docs) {
    if (!doc.fileUrl) continue; // skip empty slots

    // Use upsert keyed on (clientId, documentType) so repeated saves don't duplicate
    await prisma.kYC.upsert({
      where: {
        // If there's no unique constraint on (clientId, documentType) in the schema
        // we fall back to deleteMany + create. Check the schema first.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: (await prisma.kYC.findFirst({
          where: { clientId: clientDbId, documentType: doc.documentType },
          select: { id: true },
        }))?.id ?? 'new-will-not-match',
      },
      update: {
        documentNumber: doc.documentNumber ?? null,
        fileUrl:        doc.fileUrl        ?? null,
        fileName:       doc.fileName       ?? null,
        fileSize:       toInt(doc.fileSize),
        mimeType:       doc.mimeType       ?? null,
      },
      create: {
        clientId:       clientDbId,
        documentType:   doc.documentType,
        documentNumber: doc.documentNumber ?? null,
        fileUrl:        doc.fileUrl        ?? null,
        fileName:       doc.fileName       ?? null,
        fileSize:       toInt(doc.fileSize),
        mimeType:       doc.mimeType       ?? null,
        uploadedById,
      },
    });
  }
}

// ── Client-ID generator for drafts ───────────────────────────────────────────

async function generateDraftClientId(enrolledById: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: enrolledById },
    select: { branchId: true },
  });
  const branchCode = user?.branchId
    ? (await prisma.branch.findUnique({ where: { id: user.branchId }, select: { code: true } }))?.code ?? 'XX'
    : 'XX';
  const prefix = `DRF-${branchCode}-`;

  const existingDrafts = await prisma.client.findMany({
    where: { clientId: { startsWith: prefix } },
    select: { clientId: true },
  });

  let maxNum = 0;
  for (const item of existingDrafts) {
    const parts = item.clientId.split('-');
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }

  let counter = maxNum + 1;
  while (true) {
    const candidate = `${prefix}${counter}`;
    // findFirst, not findUnique — Client.clientId isn't DB-unique (uploan-imported legacy
    // IDs can intentionally collide, see schema.prisma); this generator still always
    // produces a genuinely fresh candidate for normal enrollment either way.
    const exists = await prisma.client.findFirst({
      where: { clientId: candidate },
      select: { id: true },
    });
    if (!exists) {
      return candidate;
    }
    counter++;
  }
}

// ── GET /api/clients/draft?mobile=XXXXXXXXXX ───────────────────────────────

export async function GET(request: NextRequest) {
  return withRole(['FDO'], async (req, user) => {
    const { searchParams } = new URL(req.url);
    const mobile = searchParams.get('mobile')?.trim();
    if (!mobile) return errorResponse('mobile query param is required', 400);

    const draft = await prisma.client.findFirst({
      where: { mobileNumber: mobile, enrolledById: user.userId, approvalStatus: 'DRAFT' as any },
      select: {
        id: true, clientId: true,
        firstName: true, lastName: true, phone: true, email: true,
        mobileNumber: true,
        dateOfBirth: true, age: true, gender: true,
        caste: true, community: true, religion: true, qualification: true,
        maritalStatus: true, houseStatus: true,
        fatherName: true, motherName: true, noOfChildren: true,
        permanentAddress: true, pincode: true, postOffice: true,
        district: true, state: true, country: true,
        latitude: true, longitude: true,
        economicActivityTypeId: true, economicActivityId: true,
        monthlyFamilyIncome: true, monthlyFamilyExpense: true,
        spouseName: true, spouseDob: true, spouseMobileNumber: true,
        spouseGender: true,
        spouseEconomicActivityTypeId: true, spouseEconomicActivityId: true,
        coApplicantEconomicActivityTypeId: true, coApplicantEconomicActivityId: true,
        ifscCode: true, bankAcNo: true, bankName: true,
        bankBranch: true, bankAccountType: true,
        votersIdNo: true, caVoterIdNo: true,
        otherIdNo: true, caOtherIdNo: true,
        pancardNo: true, caPancardNo: true, smartCardNo: true,
        nomineeName: true, nomineeRelation: true, nomineePhone: true,
        nomineeGender: true, nomineeDateOfBirth: true, nomineeAge: true,
        requestedLoanProductId: true,
        requestedLoanProductTypeId: true,
        requestedLoanFrequency: true,
        requestedLoanPurposeTypeId: true,
        requestedLoanPurposeId: true,
        memberGroupStatus: true,
        requestedCenterId: true,
        requestedGroupId: true,
        kycDocuments: {
          select: {
            documentType: true, documentNumber: true,
            fileUrl: true, fileName: true, fileSize: true, mimeType: true,
          },
        },
      },
    });

    if (!draft) return successResponse(null, 'No draft found');
    return successResponse(draft, 'Draft found');
  })(request);
}

// ── POST /api/clients/draft ─────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  return withRole(['FDO'], async (req, user) => {
    try {
      const body = await req.json();
      const data = draftSchema.parse(body);

      // ── Update existing draft ────────────────────────────────────────────
      if (data.existingClientId) {
        const existing = await prisma.client.findUnique({
          where: { id: data.existingClientId },
          select: { id: true, approvalStatus: true, enrolledById: true },
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!existing || (existing.approvalStatus as any) !== 'DRAFT') {
          return errorResponse('Draft not found or already submitted', 404);
        }
        if (existing.enrolledById !== user.userId) {
          return errorResponse('You can only update your own drafts', 403);
        }

        const updated = await prisma.client.update({
          where: { id: data.existingClientId },
          data: buildClientData(data),
          select: { id: true, clientId: true },
        });

        await upsertKycDocuments(updated.id, user.userId, data.kycDocuments);
        return successResponse({ clientId: updated.clientId, id: updated.id }, 'Draft updated');
      }

      // ── Return existing draft if same mobile already has one ─────────────
      const existing = await prisma.client.findFirst({
        where: { mobileNumber: data.mobileNumber, enrolledById: user.userId, approvalStatus: 'DRAFT' as any },
        select: { id: true, clientId: true },
      });
      if (existing) {
        // Update it with the latest form data
        await prisma.client.update({
          where: { id: existing.id },
          data: buildClientData(data),
        });
        await upsertKycDocuments(existing.id, user.userId, data.kycDocuments);
        return successResponse({ clientId: existing.clientId, id: existing.id }, 'Draft updated');
      }

      // ── Create new draft ──────────────────────────────────────────────────
      let created: { id: string; clientId: string } | null = null;
      let attempts = 0;
      while (attempts < 5) {
        attempts++;
        try {
          const clientId = await generateDraftClientId(user.userId);
          created = await prisma.client.create({
            data: {
              clientId,
              enrolledById:       user.userId,
              ...buildClientData(data),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              approvalStatus:     'DRAFT' as any,
              verificationStatus: 'PENDING_VERIFICATION',
              isActive:           true,
            },
            select: { id: true, clientId: true },
          });
          break;
        } catch (err: any) {
          if (err?.code === 'P2002' && attempts < 5) {
            continue;
          }
          throw err;
        }
      }

      if (!created) {
        return errorResponse('Failed to create draft due to unique constraint collision', 500);
      }

      await upsertKycDocuments(created.id, user.userId, data.kycDocuments);
      return successResponse({ clientId: created.clientId, id: created.id }, 'Draft saved', 201);

    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      const msg = error instanceof Error ? error.message : 'Failed to save draft';
      return errorResponse(msg, 500);
    }
  })(request);
}

// ── DELETE /api/clients/draft?id=<dbId> ──────────────────────────────────────

export async function DELETE(request: NextRequest) {
  return withRole(['FDO', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id')?.trim();
    if (!id) return errorResponse('id query param is required', 400);

    const draft = await prisma.client.findUnique({
      where: { id },
      select: { id: true, approvalStatus: true, enrolledById: true },
    });
    if (!draft) return errorResponse('Draft not found', 404);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((draft.approvalStatus as any) !== 'DRAFT') return errorResponse('Only DRAFT records can be deleted this way', 400);
    // FDOs may only delete their own drafts; BM / AM / ADMIN can delete any draft
    if (user.role === 'FDO' && draft.enrolledById !== user.userId) {
      return errorResponse('Not your draft', 403);
    }

    // Delete child KYC records first (FK RESTRICT constraint)
    await prisma.kYC.deleteMany({ where: { clientId: id } });
    await prisma.client.delete({ where: { id } });
    return successResponse(null, 'Draft deleted');
  })(request);
}

