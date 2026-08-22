/// Hardcoded dropdown option lists + KYC document-type constants, mirroring
/// the web app's `ClientEnrollmentForm.tsx` constants and
/// `app/lib/kyc-document-types.ts` exactly — values must match the web app
/// verbatim since they're sent to the same backend.
class EnrollmentOptions {
  static const genders = ['Male', 'Female', 'Transgender', 'Other'];
  static const castes = ['General', 'OBC', 'SC', 'ST', 'Other'];
  static const religions = ['Hindu', 'Muslim', 'Christian', 'Sikh', 'Other'];
  static const maritalStatuses = ['Single', 'Married', 'Divorced', 'Widowed'];
  static const houseStatuses = ['Owned', 'Rented', 'Leased', 'Other'];
  static const nomineeRelations = [
    'Father',
    'Mother',
    'Spouse',
    'Son',
    'Daughter',
    'Brother',
    'Sister',
  ];
  static const bankAccountTypes = [
    'Savings Account',
    'Current Account',
    'Salary Account',
    'Joint Account',
  ];
  static const memberGroupStatuses = [
    'NEW_CENTER_NEW_MEMBER',
    'EXISTING_CENTER_NEW_MEMBER',
  ];
  static const loanFrequencies = ['weekly'];

  static const communities = [
    'Vanniyar',
    'Thevar',
    'Kallar',
    'Maravar',
    'Agamudayar',
    'Gounder',
    'Kongu Vellalar',
    'Nadar',
    'Mudaliar',
    'Chettiar',
    'Pillai',
    'Vellalar',
    'Yadava',
    'Konar',
    'Idaiyar',
    'Devendra Kula Vellalar',
    'Paraiyar',
    'Arunthathiyar',
    'Pallar',
    'Irular',
    'Toda',
    'Kota',
    'Kurumba',
    'Labbai',
    'Rowther',
    'Marakkayar',
    'Iyer',
    'Iyengar',
    'Others',
  ];

  static const qualifications = [
    {'value': 'no_education', 'label': 'No Formal Education'},
    {'value': 'primary', 'label': 'Primary'},
    {'value': 'middle_school', 'label': 'Middle School'},
    {'value': 'sslc_10th', 'label': 'SSLC / 10th'},
    {'value': 'hsc_12th', 'label': 'HSC / 12th'},
    {'value': 'diploma_iti', 'label': 'Diploma / ITI'},
    {'value': 'graduate', 'label': 'Graduate'},
    {'value': 'post_graduate', 'label': 'Post Graduate'},
    {'value': 'professional_degree', 'label': 'Professional Degree'},
    {'value': 'doctorate', 'label': 'Doctorate'},
    {'value': 'other', 'label': 'Other'},
  ];

  // Member (client) KYC document types.
  static const docClientPhoto = 'client_photo';
  static const docAadhaarFront = 'aadhaar_front';
  static const docAadhaarBack = 'aadhaar_back';
  static const docPanCard = 'pan_card';
  static const docVoterId = 'voter_id';
  static const docVoterIdBack = 'voter_id_back';
  static const docBankPassbook = 'bank_passbook';
  static const docSmartCardFront = 'smart_card_front';
  static const docSmartCardBack = 'smart_card_back';

  // Co-applicant KYC document types.
  static const docCoApplicantPhoto = 'co_applicant_photo';
  static const docCoApplicantAadhaarFront = 'co_applicant_other_id';
  static const docCoApplicantAadhaarBack = 'co_applicant_aadhaar_back';
  static const docCoApplicantPanCard = 'co_applicant_pan_card';
  static const docCoApplicantVoterId = 'co_applicant_voter_id';
  static const docCoApplicantVoterIdBack = 'co_applicant_voter_id_back';
  static const docCoApplicantOtherIdFront = 'co_applicant_other_id_front';
  static const docCoApplicantOtherIdBack = 'co_applicant_other_id_back';

  // Residence verification document types.
  static const docHouseImage1 = 'house_image_1';
  static const docHouseImage2 = 'house_image_2';
  static const docHouseImage3 = 'house_image_3';
  static const docGasBill = 'gas_bill';
  static const docNocImage1 = 'noc_image_1';
  static const docNocImage2 = 'noc_image_2';
  static const docNocImage3 = 'noc_image_3';
  static const docLocationQr = 'location_qr';

  static const clientDocumentTypes = [
    docClientPhoto,
    docAadhaarFront,
    docAadhaarBack,
    docPanCard,
    docVoterId,
    docVoterIdBack,
    docBankPassbook,
    docSmartCardFront,
    docSmartCardBack,
  ];

  static const coApplicantDocumentTypes = [
    docCoApplicantPhoto,
    docCoApplicantAadhaarFront,
    docCoApplicantAadhaarBack,
    docCoApplicantPanCard,
    docCoApplicantVoterId,
    docCoApplicantVoterIdBack,
    docCoApplicantOtherIdFront,
    docCoApplicantOtherIdBack,
  ];

  static const residenceDocumentTypes = [
    docHouseImage1,
    docHouseImage2,
    docHouseImage3,
    docGasBill,
    docNocImage1,
    docNocImage2,
    docNocImage3,
  ];

  /// Document types that also accept a PDF upload (all others are image-only).
  static const pdfEligibleDocumentTypes = [
    docBankPassbook,
    docSmartCardFront,
    docSmartCardBack,
    docCoApplicantAadhaarFront,
    docCoApplicantOtherIdFront,
    docCoApplicantOtherIdBack,
  ];
}
