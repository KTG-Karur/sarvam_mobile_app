// ============================================================
// EMPLOYEE DOCUMENT ORDER & SLOTS
// app/lib/hr/document-order.ts
//
// The order employee documents are listed in, everywhere: the tile order of
// the onboarding Manual Entry form's Documents tab
// (components/hr/OnboardingDocumentUploader.tsx TILE_DEFS, mirrored by the
// public joinee page and the `doc_*` rows in onboarding-field-definitions.ts),
// followed by the HR-issued categories that have no onboarding tile. Keep it
// in step with that tile list.
//
// Pure (no Prisma / React) — used by the API and by client components.
// ============================================================

export const KYC_SUBTYPES = ['Aadhaar', 'PAN', 'DL / LLR', 'Voter ID', 'UAN', 'Photo'] as const;

type Slot = { category: string; subtype: string | null };

export const DOCUMENT_SLOT_ORDER: Slot[] = [
  ...KYC_SUBTYPES.map((subtype) => ({ category: 'KYC', subtype })),
  { category: 'RESUME', subtype: null },
  { category: 'EDUCATION_CERTIFICATE', subtype: null },
  { category: 'PRE_APPLICATION_ASSESSMENT', subtype: null },
  { category: 'BANK_PASSBOOK', subtype: null },
  { category: 'RELIEVING_LETTER_PAYSLIP', subtype: null },
  // HR-issued after onboarding — no intake tile, so they follow the intake documents.
  { category: 'JOINING_KIT', subtype: null },
  { category: 'APPOINTMENT_LETTER', subtype: null },
  { category: 'BGV_REPORT', subtype: null },
  { category: 'ORIGINAL_CERTIFICATE_ACK', subtype: null },
];

function slotIndex(doc: Slot): number {
  const exact = DOCUMENT_SLOT_ORDER.findIndex((s) => s.category === doc.category && s.subtype === doc.subtype);
  if (exact !== -1) return exact;
  // Unknown KYC subtype (or none): keep it with the other KYC documents, after the known ones.
  const kycEnd = DOCUMENT_SLOT_ORDER.findIndex((s) => s.category === 'KYC' && s.subtype === 'Photo');
  if (doc.category === 'KYC') return kycEnd + 0.5;
  const byCategory = DOCUMENT_SLOT_ORDER.findIndex((s) => s.category === doc.category);
  return byCategory !== -1 ? byCategory : DOCUMENT_SLOT_ORDER.length;
}

/**
 * Sorts documents into form order. Documents that share a slot (e.g. several
 * education certificates) keep their incoming order, so pass them newest-first.
 */
export function sortDocumentsInFormOrder<T extends Slot>(docs: T[]): T[] {
  return docs
    .map((doc, i) => ({ doc, i, s: slotIndex(doc) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .map((x) => x.doc);
}

/**
 * KYC documents are one-per-type: an employee has a single Aadhaar, PAN, DL/LLR,
 * Voter ID, UAN and Photo (the onboarding form gives each its own single-file
 * tile). Replacing one is done in place with "Update Document", not by adding
 * a second copy. Other categories (e.g. education certificates) can
 * legitimately repeat.
 */
export function isSingleCopyDocument(category: string, subtype: string | null | undefined): boolean {
  return category === 'KYC' && !!subtype && (KYC_SUBTYPES as readonly string[]).includes(subtype);
}
