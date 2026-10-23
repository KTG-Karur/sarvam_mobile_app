
export const CLIENT_KYC_DOCUMENT_TYPES = [
    {
        value: 'client_photo',
        label: 'Member Photo',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'aadhaar_front',
        label: 'Aadhaar Front',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'aadhaar_back',
        label: 'Aadhaar Back',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'pan_card',
        label: 'PAN Card Upload',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'voter_id',
        label: 'Voter ID Front',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'voter_id_back',
        label: 'Voter ID Back',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'bank_passbook',
        label: 'Bank Passbook',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
    {
        value: 'smart_card_front',
        label: 'Smart Card Front Upload',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
    {
        value: 'smart_card_back',
        label: 'Smart Card Back',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
    {
        value: 'gas_bill',
        label: 'NOC (Gas Bill)',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'house_image_1',
        label: 'House Image 1',
        accept: 'image/jpeg,image/jpg,image/png',
    },
        {
        value: 'house_image_2',
        label: 'House Image 2',
        accept: 'image/jpeg,image/jpg,image/png',
    },
            {
        value: 'house_image_3',
        label: 'House Image 3',
        accept: 'image/jpeg,image/jpg,image/png',
    },
        {
        value: 'noc_image_1',
        label: 'NOC Image 1',
        accept: 'image/jpeg,image/jpg,image/png',
    },
        {
        value: 'noc_image_2',
        label: 'NOC Image 2',
        accept: 'image/jpeg,image/jpg,image/png',
    },
            {
        value: 'noc_image_3',
        label: 'NOC Image 3',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'location_qr',
        label: 'Location QR',
        accept: 'image/jpeg,image/jpg,image/png',
    },
] as const;

export const CO_APPLICANT_KYC_DOCUMENT_TYPES = [
    {
        value: 'co_applicant_photo',
        label: 'Co-Applicant Photo',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        // This is the value Enrollment (/dashboard/client/enrollment) actually
        // uploads new co-applicant Aadhaar-front photos under — 'co_applicant_aadhaar_front'
        // is a separate, unused value with no uploads and is intentionally not
        // listed here to avoid a duplicate "Co-Applicant Aadhaar Front" row.
        value: 'co_applicant_other_id',
        label: 'Co-Applicant Aadhaar Front',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
    {
        value: 'co_applicant_aadhaar_back',
        label: 'CA Aadhaar Back',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'co_applicant_pan_card',
        label: 'Co-Applicant PAN Card Upload',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'co_applicant_voter_id',
        label: 'Co-Applicant Voter ID Front',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'co_applicant_voter_id_back',
        label: 'Co-Applicant Voter ID Back',
        accept: 'image/jpeg,image/jpg,image/png',
    },
    {
        value: 'co_applicant_other_id_front',
        label: 'Co-Applicant Other ID Front',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
    {
        value: 'co_applicant_other_id_back',
        label: 'Co-Applicant Other ID Back',
        accept: 'image/jpeg,image/jpg,image/png,application/pdf',
    },
] as const;

export const SUPPORTED_KYC_DOCUMENT_TYPES = [
    ...CLIENT_KYC_DOCUMENT_TYPES,
    ...CO_APPLICANT_KYC_DOCUMENT_TYPES,
] as const;

export type SupportedKycDocumentType = (typeof SUPPORTED_KYC_DOCUMENT_TYPES)[number]['value'];

export const SUPPORTED_KYC_DOCUMENT_TYPE_VALUES = SUPPORTED_KYC_DOCUMENT_TYPES.map(
    (type) => type.value,
) as [SupportedKycDocumentType, ...SupportedKycDocumentType[]];

export const CLIENT_KYC_DOCUMENT_TYPE_VALUES = CLIENT_KYC_DOCUMENT_TYPES.map(
    (type) => type.value,
) as [(typeof CLIENT_KYC_DOCUMENT_TYPES)[number]['value'], ...(typeof CLIENT_KYC_DOCUMENT_TYPES)[number]['value'][]];

export const CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES = CO_APPLICANT_KYC_DOCUMENT_TYPES.map(
    (type) => type.value,
) as [(typeof CO_APPLICANT_KYC_DOCUMENT_TYPES)[number]['value'], ...(typeof CO_APPLICANT_KYC_DOCUMENT_TYPES)[number]['value'][]];

export function getKycDocumentTypeLabel(documentType: string): string {
    return (
        SUPPORTED_KYC_DOCUMENT_TYPES.find((type) => type.value === documentType)?.label || documentType
    );
}

export function getKycDocumentScope(documentType: string): 'client' | 'co_applicant' | 'unknown' {
    if (CLIENT_KYC_DOCUMENT_TYPE_VALUES.includes(documentType as (typeof CLIENT_KYC_DOCUMENT_TYPE_VALUES)[number])) {
        return 'client';
    }

    if (CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES.includes(documentType as (typeof CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES)[number])) {
        return 'co_applicant';
    }

    return 'unknown';
}

/** Matches `/api/kyc/aadhaar/upload` storage owner segment (FormData field `owner` or alias `entityType`). */
export type KycUploadOwner = 'client' | 'nominee' | 'coApplicant';

/** Matches `/api/kyc/aadhaar/upload` storage category segment. */
export type KycUploadCategory = 'kyc' | 'photos' | 'nominee';

export function resolveKycUploadOwner(params: {
    documentType: string;
    explicitOwner?: KycUploadOwner;
}): KycUploadOwner {
    if (params.explicitOwner) {
        return params.explicitOwner;
    }
    if (params.documentType.startsWith('co_applicant_')) {
        return 'coApplicant';
    }
    return 'client';
}

export function resolveKycUploadCategory(params: { documentType: string; owner: KycUploadOwner }): KycUploadCategory {
    if (params.documentType.includes('photo')) {
        return 'photos';
    }
    if (params.owner === 'nominee') {
        return 'nominee';
    }
    return 'kyc';
}

/** Appends `owner` and `category` for KYC upload FormData (keeps storage paths consistent with enrollment uploads). */
export function appendKycUploadOwnerAndCategory(
    formData: FormData,
    documentType: string,
    options?: { explicitOwner?: KycUploadOwner },
): void {
    const owner = resolveKycUploadOwner({ documentType, explicitOwner: options?.explicitOwner });
    const category = resolveKycUploadCategory({ documentType, owner });
    formData.append('owner', owner);
    formData.append('category', category);
}
   