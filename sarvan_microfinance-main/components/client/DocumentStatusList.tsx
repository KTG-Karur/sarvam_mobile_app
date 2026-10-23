'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import type { EnrollmentFieldConfig } from '@/hooks/useEnrollmentValidation';
import {
    SUPPORTED_KYC_DOCUMENT_TYPE_VALUES,
    CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES,
} from '@/components/client/kyc-document-types';

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

interface DocumentStatusListProps {
    configArray: EnrollmentFieldConfig[];
    page: 'kyc' | 'client_details' | 'co_applicant' | 'client_other' | 'loan_details';
    uploadedDocumentTypes: string[];
}

export function DocumentStatusList({ configArray, page, uploadedDocumentTypes }: DocumentStatusListProps) {
    const docConfigs = configArray.filter((c) => {
        if (c.page !== page) return false;
        const docType = toDocType(c.fieldKey);
        return (SUPPORTED_KYC_DOCUMENT_TYPE_VALUES as readonly string[]).includes(docType) ||
            (CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES as readonly string[]).includes(docType);
    });

    if (docConfigs.length === 0) {
        return (
            <div className="mt-4 px-3 py-4 text-xs text-slate-400 dark:text-slate-500 text-center">
                No documents configured
            </div>
        );
    }

    return (
        <div className="mt-4">
            <h4 className="text-sm font-semibold mb-2 text-foreground dark:text-slate-200">Documents Status</h4>
            <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 dark:bg-brand-green-darker/60">
                            <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-300">Document</th>
                            <th className="text-center px-3 py-2 font-medium text-slate-600 dark:text-slate-300 w-24">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {docConfigs.map((c) => {
                            const docType = toDocType(c.fieldKey);
                            const uploaded = uploadedDocumentTypes.includes(docType);
                            return (
                                <tr key={c.fieldKey} className="border-t dark:border-sidebar-accent">
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                                        {c.fieldName}
                                        {c.isRequired
                                            ? <span className="text-red-500 ml-1">*</span>
                                            : <span className="text-slate-400 dark:text-slate-500 ml-1 text-xs">(Optional)</span>
                                        }
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                        {uploaded ? (
                                            <CheckCircle2 className="h-5 w-5 text-green-500 inline-block" />
                                        ) : (
                                            <XCircle className="h-5 w-5 text-red-400 inline-block" />
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
