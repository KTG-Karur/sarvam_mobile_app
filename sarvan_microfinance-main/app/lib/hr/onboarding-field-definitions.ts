// ============================================================
// ONBOARDING FIELD DEFINITIONS — canonical list AND display order
// app/lib/hr/onboarding-field-definitions.ts
//
// The order below is the order the fields appear in the manual-entry form
// (components/hr/OnboardingRequestForm.tsx), tab by tab. The field-validation
// admin page (HrOnboardingFieldConfigAdmin) reads it back through
// hrOnboardingValidationService.getConfig() so it always mirrors the form —
// the database has no sort column and its own row order is arbitrary, so this
// list is the single source of truth for "which field comes after which".
//
// When a field is added to or moved in the form, add or move it here too.
// Pure data (no Prisma) so it is safe to import from server services, the
// seeder and client bundles alike.
// ============================================================

export type HrOnboardingSection =
  | 'personal' | 'address' | 'organization' | 'identity' | 'bank' | 'insurance' | 'family' | 'documents';

export interface HrOnboardingFieldConfigSeed {
  fieldKey: string;
  fieldLabel: string;
  section: HrOnboardingSection;
  isRequired: boolean;
  isAlwaysRequired: boolean;
}

/**
 * Section (tab) order. Matches the form's tab bar; 'organization' is not a tab
 * on the intake form at all — it is the "Finalize Employee Details" panel the
 * approver fills in AFTER intake — so it comes last.
 */
export const HR_ONBOARDING_SECTION_ORDER: HrOnboardingSection[] = [
  'personal', 'address', 'identity', 'bank', 'insurance', 'family', 'documents', 'organization',
];

/**
 * Complete New Employee Onboarding field configuration.
 *
 * "documents" governs only the red-asterisk hint on each tile in
 * OnboardingDocumentUploader.tsx — same cosmetic-only treatment every other
 * section already gets (no section here is a hard submission/approval gate;
 * handleCreate's button and the public submit route both use their own
 * small hardcoded required subsets, unrelated to this config). Each KYC
 * subtype is its own row (doc_KYC_AADHAAR, doc_KYC_PAN, ...), matching how
 * they're separate tiles, not one shared "KYC" entry.
 *
 * No `branchId` entry — branch is hard-required by `bodySchema` in
 * app/api/hr/onboarding/[id]/submit-for-approval/route.ts (the admin picks
 * it there, not on the intake form), so a config row for it here would
 * never actually govern anything: even locked at isAlwaysRequired: true, its
 * isRequired toggle could never be the thing that blocks a submission, since
 * the zod schema already guarantees it's present before that check runs.
 *
 * The "organization" section fields (departmentId/designationId/
 * reportingManagerId/dateOfJoining) are not collected on the intake form —
 * they're gathered by the admin in the "Finalize Employee Details" panel at
 * final approval (app/api/hr/onboarding/[id]/action/route.ts), using this exact
 * required-toggle at that later point.
 *
 * Every field here maps to a nullable User column (or has a safe fallback,
 * like employeeName falling back to the generated Employee ID), so they
 * default to `isRequired: true` as a sane starting point but are NOT locked
 * — admin can untoggle any of them.
 */
export const HR_ONBOARDING_FIELDS: HrOnboardingFieldConfigSeed[] = [
  // === Personal Details ===
  { fieldKey: 'employeeName',           fieldLabel: 'Employee Name',            section: 'personal', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'mobileNumber',           fieldLabel: 'Mobile Number',            section: 'personal', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'email',                  fieldLabel: 'Email ID',                 section: 'personal', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'dateOfBirth',            fieldLabel: 'Date of Birth',            section: 'personal', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'gender',                 fieldLabel: 'Gender',                   section: 'personal', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'maritalStatus',          fieldLabel: 'Marital Status',           section: 'personal', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'bloodGroup',             fieldLabel: 'Blood Group',              section: 'personal', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'educationQualification', fieldLabel: 'Education Qualification',  section: 'personal', isRequired: false, isAlwaysRequired: false },

  // === Address ===
  { fieldKey: 'currentAddress',         fieldLabel: 'Current Address',          section: 'address', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'permanentAddress',       fieldLabel: 'Permanent Address',        section: 'address', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'emergencyContactName',     fieldLabel: 'Emergency Contact Name',         section: 'address', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'emergencyContactRelation', fieldLabel: 'Emergency Contact Relationship', section: 'address', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'emergencyContactNumber',   fieldLabel: 'Emergency Contact Number',       section: 'address', isRequired: false, isAlwaysRequired: false },

  // === Identity & Statutory Details ===
  { fieldKey: 'aadhaarNumber', fieldLabel: 'Aadhaar Number', section: 'identity', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'panNumber',     fieldLabel: 'PAN Number',     section: 'identity', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'dlNumber',      fieldLabel: 'DL & LLR Number', section: 'identity', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'voterIdNumber', fieldLabel: 'Voter ID Number', section: 'identity', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'uanNumber',     fieldLabel: 'UAN Number',      section: 'identity', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'esiNumber',     fieldLabel: 'ESI Number',      section: 'identity', isRequired: false, isAlwaysRequired: false },

  // === Bank Details ===
  { fieldKey: 'bankName',       fieldLabel: 'Bank Name',       section: 'bank', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'bankBranchName', fieldLabel: 'Bank Branch Name', section: 'bank', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'accountNumber',  fieldLabel: 'Account Number',  section: 'bank', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'ifscCode',       fieldLabel: 'IFSC Code',       section: 'bank', isRequired: false, isAlwaysRequired: false },

  // === Insurance ===
  { fieldKey: 'insuranceCompanyName',  fieldLabel: 'Insurance Company Name',  section: 'insurance', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'insurancePolicyNumber', fieldLabel: 'Insurance Policy Number', section: 'insurance', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'insuranceValidFrom',    fieldLabel: 'Valid From Date',         section: 'insurance', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'insuranceValidTo',      fieldLabel: 'Valid To Date',           section: 'insurance', isRequired: false, isAlwaysRequired: false },

  // === Family Details ===
  { fieldKey: 'fatherName',             fieldLabel: 'Father Name',              section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'fatherAge',              fieldLabel: 'Father Age',               section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'fatherAadhaarNumber',    fieldLabel: 'Father Aadhaar Number',    section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'motherName',             fieldLabel: 'Mother Name',              section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'motherAge',              fieldLabel: 'Mother Age',               section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'motherAadhaarNumber',    fieldLabel: 'Mother Aadhaar Number',    section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeName',               fieldLabel: 'Wife Name',                section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeAge',                fieldLabel: 'Wife Age',                 section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeAadhaarNumber',      fieldLabel: 'Wife Aadhaar Number',      section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeBankAccountNumber',  fieldLabel: 'Wife Bank Account Number', section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeIfscCode',           fieldLabel: 'Wife IFSC Code',           section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'wifeContactNumber',      fieldLabel: 'Wife Contact Number',      section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandName',               fieldLabel: 'Husband Name',               section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandAge',                fieldLabel: 'Husband Age',                section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandAadhaarNumber',      fieldLabel: 'Husband Aadhaar Number',     section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandBankAccountNumber',  fieldLabel: 'Husband Bank Account Number', section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandIfscCode',           fieldLabel: 'Husband IFSC Code',          section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'husbandContactNumber',      fieldLabel: 'Husband Contact Number',     section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'weddingDate',            fieldLabel: 'Wedding Date',             section: 'family', isRequired: false, isAlwaysRequired: false },
  // Children are a repeatable list, so these apply per added child row — they
  // never force a married employee to add a child (see CHILD_FIELD_CONFIG_KEYS).
  { fieldKey: 'childGender',            fieldLabel: 'Child Gender',             section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'childAge',               fieldLabel: 'Child Age',                section: 'family', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'childAadhaarNumber',     fieldLabel: 'Child Aadhaar Number',     section: 'family', isRequired: false, isAlwaysRequired: false },

  // === Documents — one row per tile, in the tile order of components/hr/OnboardingDocumentUploader.tsx ===
  { fieldKey: 'doc_KYC_AADHAAR',                fieldLabel: 'Aadhaar',                              section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_KYC_PAN',                    fieldLabel: 'PAN',                                  section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_KYC_DL',                     fieldLabel: 'DL / LLR',                             section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_KYC_VOTER_ID',               fieldLabel: 'Voter ID',                             section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_KYC_UAN',                    fieldLabel: 'UAN',                                  section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_KYC_PHOTO',                  fieldLabel: 'Photo',                                section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_RESUME',                     fieldLabel: 'Resume',                               section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_EDUCATION_CERTIFICATE',      fieldLabel: 'Education Certificate',                section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_PRE_APPLICATION_ASSESSMENT', fieldLabel: 'Pre-Application Assessment',           section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_BANK_PASSBOOK',              fieldLabel: 'Bank Passbook',                        section: 'documents', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'doc_RELIEVING_LETTER_PAYSLIP',   fieldLabel: 'Relieving Letter / Payslip',           section: 'documents', isRequired: false, isAlwaysRequired: false },

  // === Organization — the "Finalize Employee Details" panel at final approval (not on the intake form), in its field order ===
  { fieldKey: 'departmentId',        fieldLabel: 'Department',           section: 'organization', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'designationId',       fieldLabel: 'Designation',          section: 'organization', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'reportingManagerId',  fieldLabel: 'Reporting Manager',    section: 'organization', isRequired: false, isAlwaysRequired: false },
  { fieldKey: 'dateOfJoining',       fieldLabel: 'Date of Joining',      section: 'organization', isRequired: true,  isAlwaysRequired: false },
  { fieldKey: 'monthlyCtc',          fieldLabel: 'Month CTC Pay',        section: 'organization', isRequired: true,  isAlwaysRequired: false },
];

const FIELD_INDEX = new Map(HR_ONBOARDING_FIELDS.map((f, i) => [f.fieldKey, i]));
const SECTION_INDEX = new Map(HR_ONBOARDING_SECTION_ORDER.map((s, i) => [s, i]));

/**
 * Sorts config rows into form order: by section (tab order), then by position
 * in HR_ONBOARDING_FIELDS. A row the list doesn't know about (a field added to
 * the database by hand) sorts after the known ones in its section, by key —
 * it is never dropped.
 */
export function compareOnboardingFields(
  a: { section: string; fieldKey: string },
  b: { section: string; fieldKey: string }
): number {
  const sa = SECTION_INDEX.get(a.section as HrOnboardingSection) ?? Number.MAX_SAFE_INTEGER;
  const sb = SECTION_INDEX.get(b.section as HrOnboardingSection) ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  const fa = FIELD_INDEX.get(a.fieldKey) ?? Number.MAX_SAFE_INTEGER;
  const fb = FIELD_INDEX.get(b.fieldKey) ?? Number.MAX_SAFE_INTEGER;
  if (fa !== fb) return fa - fb;
  return a.fieldKey.localeCompare(b.fieldKey);
}
