import type { ClientEnrollmentData } from '@/app/lib/validations/client-enrollment.validation';

/**
 * Maps every enrollment field (kyc/client/nominee) to its EnrollmentValidationConfig
 * fieldKey and how to read its current value out of a parsed enrollment payload.
 * Mirrors the client-side `fieldMap`/`CONFIG_KEY_OVERRIDE` pair in
 * ClientEnrollmentForm.tsx's handleSubmit — kept in one place so the server-side
 * check (app/api/clients/enrollment/route.ts) and the client-side check can't drift
 * on which config fieldKey a given payload field maps to.
 */
export interface EnrollmentFieldMapEntry {
    configKey: string;
    label: string;
    getValue: (data: ClientEnrollmentData) => unknown;
}

export const ENROLLMENT_FIELD_CONFIG_MAP: EnrollmentFieldMapEntry[] = [
    // KYC fields
    { configKey: 'mobileNumber', label: 'Mobile Number', getValue: (d) => d.kyc.mobileNumber },
    { configKey: 'otherIdNo', label: 'Aadhaar Number', getValue: (d) => d.kyc.otherIdNo },
    { configKey: 'votersIdNo', label: 'Voter ID Number', getValue: (d) => d.kyc.votersIdNo },
    { configKey: 'caOtherIdNo', label: 'CA Aadhaar ID', getValue: (d) => d.kyc.caOtherIdNo },
    { configKey: 'caPancardNo', label: 'CA PAN Card', getValue: (d) => d.kyc.caPancardNo },
    { configKey: 'caVoterIdNo', label: 'CA Voter ID', getValue: (d) => d.kyc.caVoterIdNo },
    // Member Details fields
    { configKey: 'clientName', label: 'Member Name', getValue: (d) => d.client.firstName },
    { configKey: 'lastName', label: 'Last Name', getValue: (d) => d.client.lastName },
    { configKey: 'permanentAddress', label: 'Permanent Address', getValue: (d) => d.client.permanentAddress },
    { configKey: 'pincode', label: 'Pincode', getValue: (d) => d.client.pincode },
    { configKey: 'postOffice', label: 'Post Office', getValue: (d) => d.client.postOffice },
    { configKey: 'district', label: 'District', getValue: (d) => d.client.district },
    { configKey: 'state', label: 'State', getValue: (d) => d.client.state },
    { configKey: 'country', label: 'Country', getValue: (d) => d.client.country },
    { configKey: 'dateOfBirth', label: 'Date of Birth', getValue: (d) => d.client.dateOfBirth },
    { configKey: 'age', label: 'Age', getValue: (d) => d.client.age },
    { configKey: 'gender', label: 'Gender', getValue: (d) => d.client.gender },
    { configKey: 'caste', label: 'Caste', getValue: (d) => d.client.caste },
    { configKey: 'community', label: 'Community', getValue: (d) => d.client.community },
    { configKey: 'religion', label: 'Religion', getValue: (d) => d.client.religion },
    { configKey: 'economicActivityTypeId', label: 'Economic Activity Type', getValue: (d) => d.client.economicActivityTypeId },
    { configKey: 'economicActivityId', label: 'Economic Activity', getValue: (d) => d.client.economicActivityId },
    { configKey: 'qualification', label: 'Qualification', getValue: (d) => d.client.qualification },
    { configKey: 'maritalStatus', label: 'Marital Status', getValue: (d) => d.client.maritalStatus },
    { configKey: 'spouseName', label: 'Spouse Name', getValue: (d) => d.client.spouseName },
    { configKey: 'spouseDob', label: 'Spouse Date of Birth', getValue: (d) => d.client.spouseDob },
    { configKey: 'spouseMobileNumber', label: 'Spouse Mobile Number', getValue: (d) => d.client.spouseMobileNumber },
    { configKey: 'spouseGender', label: 'Spouse Gender', getValue: (d) => d.client.spouseGender },
    { configKey: 'bankAccountType', label: 'Bank Account Type', getValue: (d) => d.client.bankAccountType },
    { configKey: 'spouseEconomicActivityTypeId', label: 'Spouse Economic Activity Type', getValue: (d) => d.client.spouseEconomicActivityTypeId },
    { configKey: 'spouseEconomicActivityId', label: 'Spouse Economic Activity', getValue: (d) => d.client.spouseEconomicActivityId },
    { configKey: 'fatherName', label: 'Father Name', getValue: (d) => d.client.fatherName },
    { configKey: 'motherName', label: 'Mother Name', getValue: (d) => d.client.motherName },
    { configKey: 'noOfChildren', label: 'Number of Children', getValue: (d) => d.client.noOfChildren },
    { configKey: 'monthlyFamilyIncome', label: 'Monthly Family Income', getValue: (d) => d.client.monthlyFamilyIncome },
    { configKey: 'monthlyFamilyExpense', label: 'Monthly Family Expense', getValue: (d) => d.client.monthlyFamilyExpense },
    { configKey: 'ifscCode', label: 'IFSC Code', getValue: (d) => d.client.ifscCode },
    { configKey: 'bankAcNo', label: 'Bank Account Number', getValue: (d) => d.client.bankAcNo },
    { configKey: 'bankName', label: 'Bank Name', getValue: (d) => d.client.bankName },
    { configKey: 'bankBranch', label: 'Bank Branch', getValue: (d) => d.client.bankBranch },
    { configKey: 'houseStatus', label: 'House Status', getValue: (d) => d.client.houseStatus },
    { configKey: 'latitude', label: 'Latitude', getValue: (d) => d.client.latitude },
    { configKey: 'longitude', label: 'Longitude', getValue: (d) => d.client.longitude },
    { configKey: 'memberGroupStatus', label: 'Group Status', getValue: (d) => d.client.memberGroupStatus },
    { configKey: 'requestedCenterId', label: 'Center', getValue: (d) => d.client.requestedCenterId },
    { configKey: 'requestedGroupId', label: 'Requested Group', getValue: (d) => d.client.requestedGroupId },
    // Nominee / Co-Applicant fields — CONFIG_KEY_OVERRIDE-equivalent names already
    // resolved directly to the real enrollment-validation fieldKey here.
    { configKey: 'coApplicantName', label: 'Co-Applicant Name', getValue: (d) => d.nominee.nomineeName },
    { configKey: 'coApplicantMobileNumber', label: 'Co-Applicant Phone', getValue: (d) => d.nominee.nomineePhoneNumber },
    { configKey: 'coApplicantGender', label: 'Co-Applicant Gender', getValue: (d) => d.nominee.nomineeGender },
    { configKey: 'coApplicantDob', label: 'Co-Applicant Date of Birth', getValue: (d) => d.nominee.nomineeDateOfBirth },
    { configKey: 'coApplicantAge', label: 'Co-Applicant Age', getValue: (d) => d.nominee.nomineeAge },
    { configKey: 'coApplicantRelation', label: 'Co-Applicant Relation', getValue: (d) => d.nominee.nomineeRelation },
    { configKey: 'requestedLoanProductTypeId', label: 'Loan Product Type', getValue: (d) => d.nominee.requestedLoanProductTypeId },
    { configKey: 'requestedLoanFrequency', label: 'Loan Frequency', getValue: (d) => d.nominee.requestedLoanFrequency },
    { configKey: 'requestedLoanProductId', label: 'Loan Product', getValue: (d) => d.nominee.requestedLoanProductId },
    { configKey: 'requestedLoanPurposeTypeId', label: 'Loan Purpose Type', getValue: (d) => d.nominee.requestedLoanPurposeTypeId },
    { configKey: 'requestedLoanPurposeId', label: 'Loan Purpose', getValue: (d) => d.nominee.requestedLoanPurposeId },
    { configKey: 'coApplicantEconomicActivityTypeId', label: 'Co-Applicant Economic Activity Type', getValue: (d) => d.nominee.coApplicantEconomicActivityTypeId },
    { configKey: 'coApplicantEconomicActivityId', label: 'Co-Applicant Economic Activity', getValue: (d) => d.nominee.coApplicantEconomicActivityId },
];

/** Document-upload fieldKeys checked against `additionalDocuments`/aadhaar file fields — mirrors ClientEnrollmentForm.tsx's `allPossibleDocs`. */
export interface EnrollmentDocFieldMapEntry {
    /** documentType value as stored in KYC/additionalDocuments, or a dedicated aadhaar field name. */
    documentType: string;
    configKey: string;
    label: string;
}

export const ENROLLMENT_DOC_FIELD_CONFIG_MAP: EnrollmentDocFieldMapEntry[] = [
    { documentType: 'aadhaar_front', configKey: 'aadhaarFrontFileUrl', label: 'Aadhaar Front Image' },
    { documentType: 'aadhaar_back', configKey: 'aadhaarBackFileUrl', label: 'Aadhaar Back Image' },
    { documentType: 'co_applicant_aadhaar_back', configKey: 'coApplicantAadhaarBack', label: 'Co-Applicant Aadhaar - Back' },
    { documentType: 'client_photo', configKey: 'clientPhoto', label: 'Member Photo' },
    { documentType: 'bank_passbook', configKey: 'bankPassbook', label: 'Bank Passbook' },
    { documentType: 'co_applicant_photo', configKey: 'coApplicantPhoto', label: 'Co-Applicant Photo' },
    { documentType: 'voter_id', configKey: 'voterIdImage', label: 'Voter ID - Front' },
    { documentType: 'voter_id_back', configKey: 'voterIdBackImage', label: 'Voter ID - Back' },
    { documentType: 'smart_card_front', configKey: 'smart_card_front', label: 'Smart Card Front Upload' },
    { documentType: 'smart_card_back', configKey: 'smart_card_back', label: 'Smart Card Back Upload' },
    { documentType: 'house_image_1', configKey: 'house_image_1', label: 'House Image 1' },
    { documentType: 'house_image_2', configKey: 'house_image_2', label: 'House Image 2' },
    { documentType: 'house_image_3', configKey: 'house_image_3', label: 'House Image 3' },
    { documentType: 'gas_bill', configKey: 'gas_bill', label: 'NOC (Gas Bill)' },
    { documentType: 'noc_image_1', configKey: 'noc_image_1', label: 'NOC Image 1' },
    { documentType: 'noc_image_2', configKey: 'noc_image_2', label: 'NOC Image 2' },
    { documentType: 'noc_image_3', configKey: 'noc_image_3', label: 'NOC Image 3' },
    { documentType: 'location_qr', configKey: 'location_qr', label: 'Location QR' },
];

/**
 * Client Update PATCH payload key ↔ config fieldKey map. Most PATCH keys match the
 * config fieldKey 1:1 — only IFSC differs (`bankIFSC` on the payload vs `ifscCode`
 * in config, matching KYCDetailsFlatForm.tsx's own `ifscCode: { formKey: 'bankIFSC' }`
 * pairing).
 */
export const CLIENT_UPDATE_FIELD_CONFIG_MAP: Record<string, string> = {
    mobileNumber: 'mobileNumber',
    otherIdNo: 'otherIdNo',
    pancardNo: 'pancardNo',
    votersIdNo: 'votersIdNo',
    dateOfBirth: 'dateOfBirth',
    fatherName: 'fatherName',
    gender: 'gender',
    permanentAddress: 'permanentAddress',
    pincode: 'pincode',
    postOffice: 'postOffice',
    district: 'district',
    state: 'state',
    country: 'country',
    email: 'email',
    age: 'age',
    religion: 'religion',
    caste: 'caste',
    community: 'community',
    economicActivityTypeId: 'economicActivityTypeId',
    economicActivityId: 'economicActivityId',
    qualification: 'qualification',
    maritalStatus: 'maritalStatus',
    spouseName: 'spouseName',
    spouseDob: 'spouseDob',
    spouseMobileNumber: 'spouseMobileNumber',
    spouseGender: 'spouseGender',
    spouseEconomicActivityTypeId: 'spouseEconomicActivityTypeId',
    spouseEconomicActivityId: 'spouseEconomicActivityId',
    noOfChildren: 'noOfChildren',
    monthlyFamilyIncome: 'monthlyFamilyIncome',
    monthlyFamilyExpense: 'monthlyFamilyExpense',
    bankIFSC: 'ifscCode',
    bankAcNo: 'bankAcNo',
    bankName: 'bankName',
    bankBranch: 'bankBranch',
    bankAccountType: 'bankAccountType',
    motherName: 'motherName',
    smartCardNo: 'smartCardNo',
    houseStatus: 'houseStatus',
    requestedLoanProductTypeId: 'requestedLoanProductTypeId',
    requestedLoanFrequency: 'requestedLoanFrequency',
    requestedLoanProductId: 'requestedLoanProductId',
    requestedLoanPurposeTypeId: 'requestedLoanPurposeTypeId',
    requestedLoanPurposeId: 'requestedLoanPurposeId',
    memberGroupStatus: 'memberGroupStatus',
    requestedCenterId: 'requestedCenterId',
    requestedGroupId: 'requestedGroupId',
};
