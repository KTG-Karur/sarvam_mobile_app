/// Human-readable labels for KYC `documentType` values, mirroring the web
/// app's `app/lib/kyc-document-types.ts` (`getKycDocumentTypeLabel`).
const Map<String, String> kycDocTypeLabels = {
  'client_photo': 'Member / Client Photo',
  'aadhaar_front': 'Aadhaar Card - Front',
  'aadhaar_back': 'Aadhaar Card - Back',
  'pan_card': 'PAN Card',
  'voter_id': 'Voter ID - Front',
  'voter_id_back': 'Voter ID - Back',
  'bank_passbook': 'Bank Passbook',
  'signature': 'Signature',
  'smart_card_front': 'Smart Card - Front',
  'smart_card_back': 'Smart Card - Back',
  'gas_bill': 'NOC (Gas Bill)',
  'house_image_1': 'House Image 1',
  'house_image_2': 'House Image 2',
  'house_image_3': 'House Image 3',
  'noc_image_1': 'NOC Image 1',
  'noc_image_2': 'NOC Image 2',
  'noc_image_3': 'NOC Image 3',
  'location_qr': 'Location QR',
  'co_applicant_photo': 'Co-Applicant Photo',
  'co_applicant_aadhaar_front': 'Co-Applicant Aadhaar - Front',
  'co_applicant_aadhaar_back': 'Co-Applicant Aadhaar - Back',
  'co_applicant_pan_card': 'Co-Applicant PAN Card',
  'co_applicant_voter_id': 'Co-Applicant Voter ID',
  'co_applicant_signature': 'Co-Applicant Signature',
  'co_applicant_voter_id_back': 'Co-Applicant Voter ID - Back',
  'co_applicant_other_id_front': 'Co-Applicant Other ID - Front',
  'co_applicant_other_id_back': 'Co-Applicant Other ID - Back',
};

String kycDocTypeLabel(String documentType) =>
    kycDocTypeLabels[documentType] ?? documentType;
