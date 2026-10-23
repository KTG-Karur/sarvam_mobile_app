import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface EnrollmentFieldConfig {
  fieldKey: string;
  fieldName: string;
  page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details';
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

/**
 * Complete enrollment field configuration seeder.
 * Pages: client_details | client_other | co_applicant | loan_details | kyc
 */
export const ENROLLMENT_FIELDS: EnrollmentFieldConfig[] = [
  // === Section 1: Client Detail Validation ===
  { fieldKey: 'mobileNumber',     fieldName: 'Phone Number',      page: 'client_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'otherIdNo',        fieldName: 'Aadhaar Number',    page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'firstName',        fieldName: 'First Name',        page: 'client_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'clientName',       fieldName: 'First Name',        page: 'client_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'lastName',         fieldName: 'Last Name',         page: 'client_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'pancardNo',        fieldName: 'PAN Card Number',   page: 'client_details', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'votersIdNo',       fieldName: 'Voter ID Number',   page: 'client_details', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'dateOfBirth',      fieldName: 'DOB',               page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'fatherName',       fieldName: 'Father Name',       page: 'client_details', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'gender',           fieldName: 'Gender',            page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'permanentAddress', fieldName: 'Permanent Address', page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'pincode',          fieldName: 'Pincode',           page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'postOffice',       fieldName: 'Post Office',       page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'state',            fieldName: 'State',             page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'district',         fieldName: 'City',              page: 'client_details', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'country',          fieldName: 'Country',           page: 'client_details', isRequired: true,  isAlwaysRequired: false },

  // === Section 2: Client Other Details Validation ===
  { fieldKey: 'email',                        fieldName: 'Email',                         page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'age',                          fieldName: 'Age',                           page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'religion',                     fieldName: 'Religion',                      page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'caste',                        fieldName: 'Caste',                         page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'community',                    fieldName: 'Community',                     page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'economicActivityTypeId',       fieldName: 'Economic Activity Type',        page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'economicActivityId',           fieldName: 'Economic Activity',             page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'qualification',                fieldName: 'Qualification',                 page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'maritalStatus',                fieldName: 'Marital Status',                page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'spouseName',                   fieldName: 'Spouse Name',                   page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'spouseDob',                    fieldName: 'Spouse DOB',                    page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'spouseMobileNumber',           fieldName: 'Spouse Mobile Number',          page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'spouseGender',                 fieldName: 'Spouse Gender',                 page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'spouseEconomicActivityTypeId', fieldName: 'Spouse Economic Activity Type', page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'spouseEconomicActivityId',     fieldName: 'Spouse Economic Activity',      page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'noOfChildren',                 fieldName: 'Number of Children',            page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'monthlyFamilyIncome',          fieldName: 'Monthly Family Income',         page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'monthlyFamilyExpense',         fieldName: 'Monthly Family Expense',        page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'ifscCode',                     fieldName: 'IFSC Code',                     page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'bankAcNo',                     fieldName: 'Bank Account Number',           page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'retypeBankAcNo',               fieldName: 'Retype Bank Account Number',    page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'bankName',                     fieldName: 'Bank Name',                     page: 'client_other', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'bankBranch',                   fieldName: 'Bank Branch',                   page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'bankAccountType',              fieldName: 'Bank Account Type',             page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'motherName',                   fieldName: 'Mother Name',                   page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'smartCardNo',                  fieldName: 'Smart Card Number',             page: 'client_other', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'houseStatus',                  fieldName: 'House Status',                  page: 'client_other', isRequired: false, isAlwaysRequired: false },

  // === Section 3: Co-Applicant Validation ===
  { fieldKey: 'coApplicantRelation',        fieldName: 'Relation With Client',         page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantName',            fieldName: 'Co-Applicant Name',            page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantGender',          fieldName: 'Gender',                       page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantDob',             fieldName: 'Co-Applicant DOB',             page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantMobileNumber',    fieldName: 'Co-Applicant Phone Number',    page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantAge',             fieldName: 'Age',                          page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'caPancardNo',               fieldName: 'Co-Applicant PAN Card Number', page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'caVoterIdNo',               fieldName: 'Co-Applicant Voter ID Number', page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'caOtherIdNo',               fieldName: 'Co-Applicant Aadhaar Number',  page: 'co_applicant', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'coApplicantEconomicActivityTypeId', fieldName: 'Co-Applicant Economic Activity Type', page: 'co_applicant', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantEconomicActivityId',     fieldName: 'Co-Applicant Economic Activity',      page: 'co_applicant', isRequired: false, isAlwaysRequired: false },

  // === Section 3b: Loan Details Validation ===
  { fieldKey: 'memberGroupStatus',          fieldName: 'Group Status',                 page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedCenterId',          fieldName: 'Center',                       page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedGroupId',           fieldName: 'Requested Group',              page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  // Product Type / Frequency / Loan Product are mandatory and locked for the same
  // reason as Loan Purpose below: without a selected Loan Product the enrollment
  // captures no requestedAmount, so the post-approval auto first-loan creation
  // (first-loan.service.ts) silently skips and the approved member never reaches
  // Loan Indexation. Keep all of loan_details required so an incomplete loan
  // request can never be submitted into the approval queue.
  { fieldKey: 'requestedLoanProductTypeId', fieldName: 'Product Type',                 page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedLoanFrequency',     fieldName: 'Frequency',                    page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedLoanProductId',     fieldName: 'Loan Product',                 page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedLoanAmount',        fieldName: 'Loan Amount',                  page: 'loan_details', isRequired: false, isAlwaysRequired: false },
  // Loan Purpose (+ its prerequisite Purpose Type) are mandatory and locked: a missing
  // Loan Purpose makes the post-approval auto first-loan creation (first-loan.service.ts)
  // silently skip, so the approved member never reaches Loan Indexation.
  { fieldKey: 'requestedLoanPurposeTypeId', fieldName: 'Loan Purpose Type',            page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },
  { fieldKey: 'requestedLoanPurposeId',     fieldName: 'Loan Purpose',                 page: 'loan_details', isRequired: true,  isAlwaysRequired: true  },

  // === Section 4: KYC Details Validation ===
  // fieldName values below are kept in exact sync with the live labels shown on
  // /dashboard/client/enrollment's KYC Details tab (the source of truth) —
  // do not rename fieldKey (it's the seeder's upsert identity / preserves
  // isRequired), only fieldName (display label).
  { fieldKey: 'aadhaarFront',             fieldName: 'Aadhaar Front',                     page: 'kyc', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'aadhaarBack',              fieldName: 'Aadhaar Back',                      page: 'kyc', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'voterIdImage',             fieldName: 'Voter ID Front',                    page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'voterIdBackImage',         fieldName: 'Voter ID Back',                     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'pancardUpload',            fieldName: 'PAN Card Upload',                   page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'smart_card_front',         fieldName: 'Smart Card Front Upload',           page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'smart_card_back',          fieldName: 'Smart Card Back',                   page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'clientPhoto',              fieldName: 'Member Photo',                      page: 'kyc', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'bankPassbook',             fieldName: 'Bank Passbook',                     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantAadhaarFront',  fieldName: 'Co-Applicant Aadhaar Front',        page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantAadhaarBack',   fieldName: 'CA Aadhaar Back',                   page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantVoterIdUpload',    fieldName: 'Co-Applicant Voter ID Front',      page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantVoterIdBackUpload', fieldName: 'Co-Applicant Voter ID Back',    page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantPancardUpload',    fieldName: 'Co-Applicant PAN Card Upload',   page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantOtherIdFront',     fieldName: 'Co-Applicant Other ID Front',    page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantOtherIdBack',      fieldName: 'Co-Applicant Other ID Back',     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'coApplicantPhoto',            fieldName: 'Co-Applicant Photo',             page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'house_image_1',            fieldName: 'House Image 1',                     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'house_image_2',            fieldName: 'House Image 2',                     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'house_image_3',            fieldName: 'House Image 3',                     page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'gas_bill',                 fieldName: 'NOC (Gas Bill)',                    page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'noc_image_1',              fieldName: 'NOC Image 1',                       page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'noc_image_2',              fieldName: 'NOC Image 2',                       page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'noc_image_3',              fieldName: 'NOC Image 3',                       page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'location_qr',              fieldName: 'Location QR',                       page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'latitude',                 fieldName: 'Latitude',                          page: 'kyc', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'longitude',                fieldName: 'Longitude',                         page: 'kyc', isRequired: false, isAlwaysRequired: false },
];

export async function seedEnrollmentValidationConfigs(resetExisting = false): Promise<void> {
  try {
    if (resetExisting) {
      console.log('🗑️  Deleting existing enrollment validation configs...');
      await prisma.enrollmentValidationConfig.deleteMany({});
    }

    console.log('📝 Seeding enrollment validation configs...');

    const createdCount = { created: 0, updated: 0 };

    for (const field of ENROLLMENT_FIELDS) {
      const existing = await prisma.enrollmentValidationConfig.findUnique({
        where: { fieldKey: field.fieldKey },
      });

      if (existing) {
        // Always sync fieldName, page, and isAlwaysRequired from the seeder spec.
        // Preserve isRequired for admin-toggleable fields — admins control that via
        // the UI — but force isRequired: true on locked (isAlwaysRequired) fields:
        // a locked field that isn't required is a contradiction, and it's how the
        // "member approved but missing from Loan Indexation" bug slips back in.
        await prisma.enrollmentValidationConfig.update({
          where: { fieldKey: field.fieldKey },
          data: {
            fieldName: field.fieldName,
            page: field.page,
            isAlwaysRequired: field.isAlwaysRequired,
            ...(field.isAlwaysRequired ? { isRequired: true } : {}),
          },
        });
        createdCount.updated++;
        console.log(`  🔄 ${field.fieldKey} (synced)`);
      } else {
        await prisma.enrollmentValidationConfig.create({
          data: {
            fieldKey: field.fieldKey,
            fieldName: field.fieldName,
            page: field.page,
            isRequired: field.isRequired,
            isAlwaysRequired: field.isAlwaysRequired,
          },
        });
        createdCount.created++;
        console.log(`  ✅ ${field.fieldKey} (created)`);
      }
    }

    // Remove DB records for fieldKeys no longer in the spec
    const validKeys = ENROLLMENT_FIELDS.map((f) => f.fieldKey);
    const deleted = await prisma.enrollmentValidationConfig.deleteMany({
      where: { fieldKey: { notIn: validKeys } },
    });
    if (deleted.count > 0) {
      console.log(`  🗑️  Removed ${deleted.count} obsolete field(s) from DB`);
    }

    console.log(
      `\n✨ Seeding complete! Created: ${createdCount.created}, Updated: ${createdCount.updated}, Total: ${ENROLLMENT_FIELDS.length}`
    );
  } catch (error) {
    console.error('❌ Error seeding enrollment validation configs:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  seedEnrollmentValidationConfigs(false)
    .then(() => {
      console.log('✨ Done!');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
