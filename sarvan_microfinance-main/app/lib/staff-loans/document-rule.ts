import { LEAVE_PROOF_ALLOWED_MIME, sniffMime } from '@/app/lib/leave-attachment-rule';

/** Client-safe constants shared by the upload route, the apply form and the save service. */
export const STAFF_LOAN_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
export const STAFF_LOAN_DOCUMENT_ALLOWED_MIME = LEAVE_PROOF_ALLOWED_MIME;
export const STAFF_LOAN_DOCUMENT_ACCEPT = 'image/jpeg,image/png,application/pdf';
export { sniffMime };
