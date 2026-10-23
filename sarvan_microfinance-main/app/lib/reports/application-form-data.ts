import { Prisma } from '@prisma/client';
import { getSignedReadUrl, downloadObject } from '@/app/lib/storage/gcs-client';
import { compressImageBufferForPdf } from '@/app/lib/pdf/compress-image-server';

/**
 * Shared field selection for the Application Form report (preview/print list
 * endpoint and the single/batch PDF download endpoint both use this same
 * shape, so the printed PDF always matches what was previewed on screen).
 */
export const applicationFormClientSelect = {
  id: true,
  clientId: true,
  firstName: true,
  lastName: true,
  phone: true,
  mobileNumber: true,
  permanentAddress: true,
  pincode: true,
  dateOfBirth: true,
  age: true,
  gender: true,
  maritalStatus: true,
  spouseName: true,
  spouseGender: true,
  spouseDob: true,
  spouseMobileNumber: true,
  fatherName: true,
  motherName: true,
  nomineeName: true,
  nomineeRelation: true,
  nomineeAge: true,
  nomineeDateOfBirth: true,
  nomineeGender: true,
  votersIdNo: true,
  pancardNo: true,
  smartCardNo: true,
  religion: true,
  caste: true,
  qualification: true,
  occupation: true,
  monthlyFamilyIncome: true,
  monthlyFamilyExpense: true,
  requestedAmount: true,
  houseStatus: true,
  bankAcNo: true,
  bankAccountType: true,
  bankName: true,
  bankBranch: true,
  ifscCode: true,
  requestedLoanProductTypeId: true,
  requestedLoanFrequency: true,
  requestedLoanProductId: true,
  requestedLoanProductType: { select: { name: true } },
  requestedLoanProduct: { select: { productName: true, loanAmount: true } },
  economicActivityTypeId: true,
  economicActivityId: true,
  spouseEconomicActivityTypeId: true,
  spouseEconomicActivityId: true,
  economicActivityType: { select: { id: true, name: true } },
  economicActivity: { select: { id: true, name: true } },
  spouseEconomicActivityType: { select: { id: true, name: true } },
  spouseEconomicActivity: { select: { id: true, name: true } },
  createdAt: true,
  centerId: true,
  center: {
    select: {
      id: true,
      name: true,
      code: true,
      fdoId: true,
      branchId: true,
      branch: { select: { id: true, name: true } },
    },
  },
  // A client may have several co-applicants over time — this report shows
  // the Primary one (first-ever created).
  coApplicants: {
    where: { isPrimary: true },
    take: 1,
    select: {
      id: true,
      name: true,
      age: true,
      relationWithClient: true,
      otherIdNo: true,
      voterIdNo: true,
      pancardNo: true,
      mobileNumber: true,
      economicActivityTypeId: true,
      economicActivityId: true,
      economicActivityType: { select: { id: true, name: true } },
      economicActivity: { select: { id: true, name: true } },
    },
  },
  kycDocuments: {
    where: { isDeleted: false },
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, documentType: true, fileUrl: true },
  },
  loanApplications: {
    select: {
      loanNumber: true,
      tenureMonths: true,
      frequency: true,
      amount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
} satisfies Prisma.ClientSelect;

export type ApplicationFormClientRow = Prisma.ClientGetPayload<{
  select: typeof applicationFormClientSelect;
}>;

export type ApplicationFormRecord = {
  id: string;
  clientId: string;
  /** Has at least one Loan record — false means still a Member, not yet a Client */
  hasLoan: boolean;
  clientName: string;
  account: string;
  dateOfJoining: string;
  centerId: string;
  centerName: string;
  centerCode: string;
  branchName: string;
  permanentAddress: string;
  pincode: string;
  phone: string;
  mobile2: string;
  dob: string;
  age: number | string;
  gender: string;
  maritalStatus: string;
  spouseName: string;
  spouseDob: string;
  spouseGender: string;
  spouseMobile: string;
  bankAccountType: string;
  loanProductTypeName: string;
  loanProductName: string;
  loanProductAmount: number;
  fatherName: string;
  motherName: string;
  nomineeName: string;
  nomineeRelation: string;
  nomineeAge: number | string;
  nomineeDob: string;
  nomineeGender: string;
  voterId: string;
  panCard: string;
  smartCard: string;
  religion: string;
  caste: string;
  qualification: string;
  occupation: string;
  economicActivityType: string;
  economicActivity: string;
  spouseEconomicActivityType: string;
  spouseEconomicActivity: string;
  coApplicantEconomicActivityType: string;
  coApplicantEconomicActivity: string;
  monthlyIncome: number;
  monthlyExpense: number;
  requestedAmount: number;
  loanAmount: number;
  houseStatus: string;
  loanTenure: number | string;
  loanFrequency: string;
  bankAcNo: string;
  bankName: string;
  bankBranch: string;
  ifscCode: string;
  coApplicantName: string;
  coApplicantAge: number | string;
  coApplicantRelation: string;
  coOtherId: string;
  coApplicantVoterId: string;
  coApplicantPanCard: string;
  coApplicantPhone: string;
  kycDocuments: { id: string; type: string; url: string }[];
};

export function mapClientToApplicationFormRecord(
  client: ApplicationFormClientRow
): ApplicationFormRecord {
  const coApplicant = client.coApplicants[0] ?? null;
  const loan = client.loanApplications[0];

  return {
    id: client.id,
    clientId: client.clientId,
    hasLoan: client.loanApplications.length > 0,
    clientName: `${client.firstName} ${client.lastName}`,
    account: loan?.loanNumber || 'NEW',
    dateOfJoining: client.createdAt.toISOString(),
    centerId: client.centerId || '',
    centerName: client.center?.name || '',
    centerCode: client.center?.code || '',
    branchName: client.center?.branch.name || '',

    permanentAddress: client.permanentAddress || '',
    pincode: client.pincode || '',
    phone: client.phone || client.mobileNumber || '',
    mobile2: client.spouseMobileNumber || '',
    dob: client.dateOfBirth ? client.dateOfBirth.toISOString() : '',
    age: client.age ?? '',
    gender: client.gender || '',
    maritalStatus: client.maritalStatus || '',
    spouseName: client.spouseName || '',
    spouseDob: client.spouseDob ? client.spouseDob.toISOString() : '',
    spouseGender: client.spouseGender || '',
    spouseMobile: client.spouseMobileNumber || '',
    fatherName: client.fatherName || '',
    motherName: client.motherName || '',
    nomineeName: client.nomineeName || '',
    nomineeRelation: client.nomineeRelation || '',
    nomineeAge: client.nomineeAge ?? '',
    nomineeDob: client.nomineeDateOfBirth
      ? client.nomineeDateOfBirth.toISOString()
      : '',
    nomineeGender: client.nomineeGender || '',
    voterId: client.votersIdNo || '',
    panCard: client.pancardNo || '',
    smartCard: client.smartCardNo || '',
    religion: client.religion || '',
    caste: client.caste || '',
    qualification: client.qualification || '',
    occupation: client.occupation || '',
    economicActivityType:
      client.economicActivityType?.name || client.economicActivityTypeId || '',
    economicActivity:
      client.economicActivity?.name || client.economicActivityId || '',
    spouseEconomicActivityType:
      client.spouseEconomicActivityType?.name ||
      client.spouseEconomicActivityTypeId ||
      '',
    spouseEconomicActivity:
      client.spouseEconomicActivity?.name ||
      client.spouseEconomicActivityId ||
      '',
    monthlyIncome: client.monthlyFamilyIncome
      ? Number(client.monthlyFamilyIncome)
      : 0,
    monthlyExpense: client.monthlyFamilyExpense
      ? Number(client.monthlyFamilyExpense)
      : 0,
    requestedAmount: client.requestedAmount
      ? Number(client.requestedAmount)
      : 0,
    loanAmount: loan?.amount ? Number(loan.amount) : 0,
    houseStatus: client.houseStatus || '',
    loanTenure: loan?.tenureMonths ?? '',
    loanFrequency: loan?.frequency || '',

    bankAcNo: client.bankAcNo || '',
    bankAccountType: client.bankAccountType || '',
    bankName: client.bankName || '',
    bankBranch: client.bankBranch || '',
    ifscCode: client.ifscCode || '',

    loanProductTypeName: client.requestedLoanProductType?.name || '',
    loanProductName: client.requestedLoanProduct?.productName || '',
    loanProductAmount: client.requestedLoanProduct?.loanAmount
      ? Number(client.requestedLoanProduct.loanAmount)
      : 0,

    coApplicantName: coApplicant?.name || '',
    coApplicantAge: coApplicant?.age ?? '',
    coApplicantRelation: coApplicant?.relationWithClient || '',
    coOtherId: coApplicant?.otherIdNo || '',
    coApplicantVoterId: coApplicant?.voterIdNo || '',
    coApplicantPanCard: coApplicant?.pancardNo || '',
    coApplicantPhone: coApplicant?.mobileNumber || '',
    coApplicantEconomicActivityType:
      coApplicant?.economicActivityType?.name ||
      coApplicant?.economicActivityTypeId ||
      '',
    coApplicantEconomicActivity:
      coApplicant?.economicActivity?.name ||
      coApplicant?.economicActivityId ||
      '',

    kycDocuments: client.kycDocuments.map((doc) => ({
      id: doc.id,
      type: doc.documentType,
      url: doc.fileUrl || '',
    })),
  };
}

/**
 * `kycDocuments[].url` holds a bare GCS object key (the bucket is private) for
 * every document uploaded post-migration — legacy pre-migration records still
 * hold a full https:// Supabase URL. Both the preview list endpoint and the
 * PDF download endpoint must call this before handing records to the
 * application-form template, or every <img> in it fails to load.
 */
export async function resolveApplicationFormKycUrls(
  records: ApplicationFormRecord[]
): Promise<ApplicationFormRecord[]> {
  const keys = Array.from(
    new Set(
      records.flatMap((record) => record.kycDocuments.map((doc) => doc.url).filter(Boolean))
    )
  );

  const resolvedEntries = await Promise.all(
    keys.map(async (key) => [key, await getSignedReadUrl(key)] as const)
  );
  const resolved = new Map(resolvedEntries);

  return records.map((record) => ({
    ...record,
    kycDocuments: record.kycDocuments.map((doc) => ({
      ...doc,
      url: resolved.get(doc.url) || doc.url,
    })),
  }));
}

/**
 * PDF-download variant of resolveApplicationFormKycUrls() — used only by the
 * Puppeteer-rendered download route, never the on-screen preview.
 *
 * Puppeteer can't compress images in-page: the storage bucket has no CORS
 * policy, so drawing a signed-URL <img> onto a <canvas> to re-encode it
 * throws before the pixels can be read back out. So instead this fetches
 * each KYC document's bytes here (server-to-server — no CORS involved),
 * downscales/recompresses them via sharp, and embeds the result as a data:
 * URI directly in the HTML — which also means the PDF render never depends
 * on a network fetch to the storage bucket at all. Uploaded source photos
 * are often several MB each at full camera resolution; a form with a dozen
 * KYC images would otherwise balloon into tens of MB.
 */
export async function resolveApplicationFormKycUrlsForPdf(
  records: ApplicationFormRecord[]
): Promise<ApplicationFormRecord[]> {
  const keys = Array.from(
    new Set(
      records.flatMap((record) => record.kycDocuments.map((doc) => doc.url).filter(Boolean))
    )
  );

  const resolvedEntries = await Promise.all(
    keys.map(async (key) => {
      try {
        const isLegacyUrl = /^https?:\/\//i.test(key);
        const fetched = isLegacyUrl
          ? await fetch(key).then(async (res) =>
              res.ok ? { buffer: Buffer.from(await res.arrayBuffer()) } : null
            )
          : await downloadObject(key);
        if (!fetched) return [key, key] as const;

        const compressed = await compressImageBufferForPdf(fetched.buffer);
        return [key, compressed?.dataUrl ?? key] as const;
      } catch {
        return [key, key] as const;
      }
    })
  );
  const resolved = new Map(resolvedEntries);

  return records.map((record) => ({
    ...record,
    kycDocuments: record.kycDocuments.map((doc) => ({
      ...doc,
      url: resolved.get(doc.url) || doc.url,
    })),
  }));
}
