'use client';

import { useMemo } from 'react';
import type { EnrollmentFieldConfig } from '@/hooks/useEnrollmentValidation';
import {
    SUPPORTED_KYC_DOCUMENT_TYPE_VALUES,
    CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES,
} from '@/components/client/kyc-document-types';

interface KYCDocument {
    id: string;
    documentType: string;
    fileUrl: string;
    fileName: string;
}

const FIELDKEY_TO_DOC_TYPE: Record<string, string> = {
    aadhaarFront:                 'aadhaar_front',
    aadhaarBack:                  'aadhaar_back',
    clientPhoto:                  'client_photo',
    bankPassbook:                 'bank_passbook',
    nomineePhoto:                 'nominee_photo',
    voterIdImage:                 'voter_id',
    voterIdBackImage:             'voter_id_back',
    pancardUpload:                'pan_card',
    coApplicantAadhaarFront:      'co_applicant_other_id',
    coApplicantAadhaarBack:       'co_applicant_aadhaar_back',
    coApplicantPhoto:             'co_applicant_photo',
    coApplicantVoterIdUpload:     'co_applicant_voter_id',
    coApplicantVoterIdBackUpload: 'co_applicant_voter_id_back',
    coApplicantPancardUpload:     'co_applicant_pan_card',
    coApplicantOtherIdFront:      'co_applicant_other_id_front',
    coApplicantOtherIdBack:       'co_applicant_other_id_back',
};

function toDocType(fieldKey: string): string {
    return FIELDKEY_TO_DOC_TYPE[fieldKey] ?? fieldKey;
}

function isDocumentField(fieldKey: string): boolean {
    const docType = toDocType(fieldKey);
    return (SUPPORTED_KYC_DOCUMENT_TYPE_VALUES as readonly string[]).includes(docType) ||
        (CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES as readonly string[]).includes(docType);
}

const CLIENT_DETAILS_FIELD_KEYS = new Set([
    'mobileNumber', 'otherIdNo', 'clientName', 'lastName',
    'pancardNo', 'votersIdNo', 'dateOfBirth', 'fatherName',
    'gender', 'permanentAddress', 'pincode', 'postOffice',
    'state', 'district', 'country',
]);

const CLIENT_OTHER_DETAILS_FIELD_KEYS = new Set([
    'email', 'caste', 'community', 'religion',
    'economicActivityTypeId', 'economicActivityId',
    'qualification', 'maritalStatus',
    'spouseName', 'spouseDob', 'spouseMobileNumber', 'spouseGender',
    'spouseEconomicActivityTypeId', 'spouseEconomicActivityId',
    'noOfChildren', 'monthlyFamilyIncome', 'monthlyFamilyExpense',
    'houseStatus', 'ifscCode', 'bankAcNo', 'bankName', 'bankBranch',
    'bankAccountType', 'motherName', 'smartCardNo',
    'latitude', 'longitude',
]);

const FIELD_KEY_TO_CLIENT_KEY: Record<string, string> = {
    clientName: 'firstName',
    requestedLoanAmount: 'requestedAmount',   // seeder key differs from API field name
};

// These fieldKeys are seeded under page: 'loan_details' in EnrollmentValidationConfig
// (its own admin-config tab, separate from Co-Applicant) and render on the Loan
// Details tab here — checked by loanDetailsComplete below, not coApplicantComplete.
const LOAN_DETAILS_FIELD_KEYS = new Set([
    'requestedLoanProductTypeId', 'requestedLoanFrequency', 'requestedLoanProductId',
    'requestedLoanAmount', 'requestedLoanPurposeTypeId', 'requestedLoanPurposeId',
    'memberGroupStatus', 'requestedCenterId', 'requestedGroupId',
]);

export function useClientUpdateCompletion(
    currentClient: any,
    documents: KYCDocument[],
    configArray: EnrollmentFieldConfig[]
): { kycDetailsComplete: boolean; clientOtherDetailsComplete: boolean; kycDocsComplete: boolean; coApplicantComplete: boolean; loanDetailsComplete: boolean } {
    const uploadedTypes = useMemo(() => documents.map((d) => d.documentType), [documents]);

    const kycDocsComplete = useMemo(() => {
        const requiredDocFields = configArray.filter(
            (c) => (c.page === 'kyc' || c.page === 'client_details') && c.isRequired && isDocumentField(c.fieldKey)
        );
        if (requiredDocFields.length === 0) return true;
        return requiredDocFields.every((c) => uploadedTypes.includes(toDocType(c.fieldKey)));
    }, [configArray, uploadedTypes]);

    const kycDetailsComplete = useMemo(() => {
        if (!currentClient) return false;
        const requiredFields = configArray.filter(
            (c) => CLIENT_DETAILS_FIELD_KEYS.has(c.fieldKey) && c.isRequired && !isDocumentField(c.fieldKey)
        );
        if (requiredFields.length === 0) return true;
        return requiredFields.every((c) => {
            const key = FIELD_KEY_TO_CLIENT_KEY[c.fieldKey] ?? c.fieldKey;
            const val = currentClient[key];
            return val !== null && val !== undefined && val !== '';
        });
    }, [currentClient, configArray]);

    const clientOtherDetailsComplete = useMemo(() => {
        if (!currentClient) return false;
        const requiredFields = configArray.filter(
            (c) => CLIENT_OTHER_DETAILS_FIELD_KEYS.has(c.fieldKey) && c.isRequired
        );
        if (requiredFields.length === 0) return true;
        return requiredFields.every((c) => {
            const key = FIELD_KEY_TO_CLIENT_KEY[c.fieldKey] ?? c.fieldKey;
            const val = currentClient[key];
            return val !== null && val !== undefined && val !== '';
        });
    }, [currentClient, configArray]);

    const coApplicantComplete = useMemo(() => {
        // Check required fields first — if nothing is required, always complete.
        // Loan Details fields now have their own page: 'loan_details' in
        // EnrollmentValidationConfig, so c.page === 'co_applicant' already excludes
        // them — checked instead by loanDetailsComplete below.
        const requiredFields = configArray.filter(
            (c) => c.page === 'co_applicant' && c.isRequired
        );
        if (requiredFields.length === 0) return true;

        // Required fields exist but no co-applicant record yet.
        if (!currentClient?.coApplicant) return false;

        const coApp = currentClient.coApplicant;
        const coAppUploadedTypes = uploadedTypes.filter((t) =>
            (CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES as readonly string[]).includes(t)
        );

        const fieldMap: Record<string, string> = {
            caOtherIdNo:                       'otherIdNo',
            caVoterIdNo:                       'voterIdNo',
            caPancardNo:                       'pancardNo',
            coApplicantName:                   'name',
            coApplicantGender:                 'gender',
            coApplicantDob:                    'dateOfBirth',
            coApplicantAge:                    'age',
            coApplicantRelation:               'relationWithClient',
            coApplicantMobileNumber:           'mobileNumber',
            coApplicantEconomicActivityTypeId: 'economicActivityTypeId',
            coApplicantEconomicActivityId:     'economicActivityId',
        };

        return requiredFields.every((c) => {
            if (isDocumentField(c.fieldKey)) {
                return coAppUploadedTypes.includes(toDocType(c.fieldKey));
            }
            const actualKey = fieldMap[c.fieldKey] ?? c.fieldKey;
            const val = coApp[actualKey];
            return val !== null && val !== undefined && val !== '';
        });
    }, [currentClient, configArray, uploadedTypes]);

    const loanDetailsComplete = useMemo(() => {
        // Once the client is APPROVED, the Loan Details tab no longer offers
        // editing for these fields (they're hidden — see LoanDetailsUpdateForm's
        // isApproved gate) in favor of showing the client's real ongoing loan.
        // Don't flag the tab incomplete for pre-approval "requested" data that
        // can no longer be filled in from this page — that would show a red
        // indicator for something that's no longer actionable (e.g. a client
        // whose loan was created via the manual Application screen instead of
        // through this "requested" flow will always have these fields null).
        if (currentClient?.approvalStatus === 'APPROVED') return true;
        const requiredFields = configArray.filter(
            (c) => LOAN_DETAILS_FIELD_KEYS.has(c.fieldKey) && c.isRequired
        );
        if (requiredFields.length === 0) return true;
        if (!currentClient) return false;
        return requiredFields.every((c) => {
            const key = FIELD_KEY_TO_CLIENT_KEY[c.fieldKey] ?? c.fieldKey;
            const val = currentClient[key];
            return val !== null && val !== undefined && val !== '';
        });
    }, [currentClient, configArray]);

    return { kycDetailsComplete, clientOtherDetailsComplete, kycDocsComplete, coApplicantComplete, loanDetailsComplete };
}
