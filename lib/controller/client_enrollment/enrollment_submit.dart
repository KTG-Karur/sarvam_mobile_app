import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Final-submit assembly (`POST /api/clients/enrollment`) + pre-submit
/// validation. Field keys below are a literal transcription of the backend's
/// `clientEnrollmentSchema` (`kyc`/`client`/`nominee` nesting) — see the
/// plan doc for the confirmed contract.
mixin EnrollmentSubmitMixin on GetxController {
  EnrollmentApiService get api;
  RxBool get isLoading;
  RxInt get currentStep;
  RxMap<String, EnrollmentDocState> get kycDocuments;
  bool isRequired(String fieldKey, {bool? defaultValue});
  Future<void> deleteDraftAfterSubmit();

  // Tab 1
  TextEditingController get mobileNumberCtrl;
  TextEditingController get otherIdNoCtrl;
  TextEditingController get clientNameCtrl;
  TextEditingController get lastNameCtrl;
  TextEditingController get pancardNoCtrl;
  TextEditingController get votersIdNoCtrl;
  TextEditingController get dobCtrl;
  TextEditingController get fatherNameCtrl;
  Rxn<String> get gender;
  TextEditingController get permanentAddressCtrl;
  TextEditingController get pincodeCtrl;
  TextEditingController get postOfficeCtrl;
  TextEditingController get stateCtrl;
  TextEditingController get districtCtrl;
  TextEditingController get countryCtrl;

  // Tab 3
  TextEditingController get emailCtrl;
  TextEditingController get ageCtrl;
  Rxn<String> get caste;
  Rxn<String> get community;
  Rxn<String> get economicActivityTypeId;
  Rxn<String> get economicActivityId;
  Rxn<String> get religion;
  Rxn<String> get qualification;
  Rxn<String> get maritalStatus;
  TextEditingController get spouseNameCtrl;
  TextEditingController get spouseDobCtrl;
  TextEditingController get spouseMobileNumberCtrl;
  Rxn<String> get spouseGender;
  Rxn<String> get spouseEconomicActivityTypeId;
  Rxn<String> get spouseEconomicActivityId;
  TextEditingController get noOfChildrenCtrl;
  TextEditingController get monthlyFamilyIncomeCtrl;
  TextEditingController get monthlyFamilyExpenseCtrl;
  TextEditingController get ifscCodeCtrl;
  TextEditingController get bankAcNoCtrl;
  TextEditingController get bankNameCtrl;
  TextEditingController get bankBranchCtrl;
  Rxn<String> get bankAccountType;
  Rxn<String> get houseStatus;
  TextEditingController get motherNameCtrl;
  TextEditingController get smartCardNoCtrl;

  // Tab 4
  Rxn<String> get nomineeRelation;
  TextEditingController get nomineeNameCtrl;
  TextEditingController get nomineePhoneNumberCtrl;
  Rxn<String> get nomineeGender;
  TextEditingController get nomineeDateOfBirthCtrl;
  TextEditingController get nomineeAgeCtrl;
  Rxn<String> get coApplicantEconomicActivityTypeId;
  Rxn<String> get coApplicantEconomicActivityId;
  TextEditingController get caPancardNoCtrl;
  TextEditingController get caVoterIdNoCtrl;
  TextEditingController get caOtherIdNoCtrl;
  Rxn<String> get caPancardNoError;
  Rxn<String> get caVoterIdNoError;
  Rxn<String> get caOtherIdNoError;

  // Tab 5
  Rxn<String> get memberGroupStatus;
  Rxn<String> get requestedCenterId;
  Rxn<String> get requestedGroupId;
  Rxn<String> get requestedLoanProductTypeId;
  Rxn<String> get requestedLoanProductId;
  RxString get requestedLoanFrequency;
  Rxn<String> get requestedLoanPurposeTypeId;
  Rxn<String> get requestedLoanPurposeId;

  // Tab 6
  RxString get latitude;
  RxString get longitude;

  String? _blank(String value) => value.trim().isEmpty ? null : value.trim();

  int? _blankInt(String value) =>
      value.trim().isEmpty ? null : int.tryParse(value.trim());

  String? _formatDateForApi(String? text) {
    if (text == null || text.trim().isEmpty) return null;
    final str = text.trim();
    final dmy = RegExp(r'^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$');
    final match = dmy.firstMatch(str);
    if (match != null) {
      final day = match.group(1)!.padLeft(2, '0');
      final month = match.group(2)!.padLeft(2, '0');
      final year = match.group(3)!;
      return '$year-$month-$day';
    }
    return str;
  }

  /// Drops null-valued keys. The backend's Zod schemas accept a field being
  /// *absent* (undefined) but not explicit JSON `null` for optional
  /// string/number fields — sending `null` fails with "Expected string,
  /// received null" even though the field is otherwise optional.
  Map<String, dynamic> _stripNulls(Map<String, dynamic> map) =>
      Map.fromEntries(map.entries.where((e) => e.value != null));

  Map<String, dynamic> buildSubmitPayload() {
    final aadhaarFront = kycDocuments[EnrollmentOptions.docAadhaarFront];
    final aadhaarBack = kycDocuments[EnrollmentOptions.docAadhaarBack];

    final additionalDocuments = kycDocuments.entries
        .where(
          (e) =>
              e.value.isUploaded &&
              e.key != EnrollmentOptions.docAadhaarFront &&
              e.key != EnrollmentOptions.docAadhaarBack,
        )
        .map(
          (e) => {
            'documentType': e.key,
            'fileUrl': e.value.fileUrl,
            'fileName': e.value.fileName,
          },
        )
        .toList();

    return {
      'kyc': _stripNulls({
        'mobileNumber': mobileNumberCtrl.text.trim(),
        'caVoterIdNo': _blank(caVoterIdNoCtrl.text),
        'votersIdNo': _blank(votersIdNoCtrl.text),
        'caOtherIdNo': _blank(caOtherIdNoCtrl.text),
        'otherIdNo': _blank(otherIdNoCtrl.text),
        'pancardNo': _blank(pancardNoCtrl.text),
        'caPancardNo': _blank(caPancardNoCtrl.text),
        'smartCardNo': _blank(smartCardNoCtrl.text),
        'aadhaarFrontFileUrl': aadhaarFront?.fileUrl,
        'aadhaarFrontFileName': aadhaarFront?.fileName,
        'aadhaarFrontFileSize': aadhaarFront?.fileSize,
        'aadhaarFrontMimeType': aadhaarFront?.mimeType,
        'aadhaarBackFileUrl': aadhaarBack?.fileUrl,
        'aadhaarBackFileName': aadhaarBack?.fileName,
        'aadhaarBackFileSize': aadhaarBack?.fileSize,
        'aadhaarBackMimeType': aadhaarBack?.mimeType,
      }),
      'client': _stripNulls({
        'memberGroupStatus': memberGroupStatus.value,
        'requestedCenterId': requestedCenterId.value,
        'requestedGroupId': requestedGroupId.value,
        'firstName': _blank(clientNameCtrl.text),
        'lastName': _blank(lastNameCtrl.text),
        'phone': mobileNumberCtrl.text.trim(),
        'email': _blank(emailCtrl.text),
        'permanentAddress': _blank(permanentAddressCtrl.text),
        'pincode': _blank(pincodeCtrl.text),
        'postOffice': _blank(postOfficeCtrl.text),
        'district': _blank(districtCtrl.text),
        'state': _blank(stateCtrl.text),
        'country': _blank(countryCtrl.text) ?? 'India',
        'dateOfBirth': _formatDateForApi(dobCtrl.text),
        'age': _blankInt(ageCtrl.text),
        'gender': gender.value,
        'caste': caste.value,
        'community': community.value,
        'religion': religion.value,
        'economicActivityTypeId': economicActivityTypeId.value,
        'economicActivityId': economicActivityId.value,
        'qualification': qualification.value,
        'maritalStatus': maritalStatus.value,
        'spouseName': _blank(spouseNameCtrl.text),
        'spouseDob': _formatDateForApi(spouseDobCtrl.text),
        'spouseMobileNumber': _blank(spouseMobileNumberCtrl.text),
        'spouseGender': spouseGender.value,
        'spouseEconomicActivityTypeId': spouseEconomicActivityTypeId.value,
        'spouseEconomicActivityId': spouseEconomicActivityId.value,
        'fatherName': _blank(fatherNameCtrl.text),
        'motherName': _blank(motherNameCtrl.text),
        'noOfChildren': _blankInt(noOfChildrenCtrl.text),
        'monthlyFamilyIncome': _blank(monthlyFamilyIncomeCtrl.text),
        'monthlyFamilyExpense': _blank(monthlyFamilyExpenseCtrl.text),
        'ifscCode': _blank(ifscCodeCtrl.text),
        'bankAcNo': _blank(bankAcNoCtrl.text),
        'bankName': _blank(bankNameCtrl.text),
        'bankBranch': _blank(bankBranchCtrl.text),
        'bankAccountType': bankAccountType.value,
        'houseStatus': houseStatus.value,
        'latitude': _blank(latitude.value),
        'longitude': _blank(longitude.value),
      }),
      'nominee': _stripNulls({
        'nomineeName': _blank(nomineeNameCtrl.text),
        'nomineePhoneNumber': _blank(nomineePhoneNumberCtrl.text),
        'nomineeGender': nomineeGender.value,
        'nomineeDateOfBirth': _formatDateForApi(nomineeDateOfBirthCtrl.text),
        'nomineeAge': _blankInt(nomineeAgeCtrl.text),
        'nomineeRelation': nomineeRelation.value,
        'requestedLoanProductTypeId': requestedLoanProductTypeId.value,
        'requestedLoanFrequency': requestedLoanFrequency.value,
        'requestedLoanProductId': requestedLoanProductId.value,
        'requestedLoanPurposeTypeId': requestedLoanPurposeTypeId.value,
        'requestedLoanPurposeId': requestedLoanPurposeId.value,
        'coApplicantEconomicActivityTypeId':
            coApplicantEconomicActivityTypeId.value,
        'coApplicantEconomicActivityId': coApplicantEconomicActivityId.value,
      }),
      'nomineeIsCoApplicant': true,
      'isExistingClient': false,
      'additionalDocuments': additionalDocuments,
    };
  }

  /// Returns `null` when valid, or an error message when it isn't — also
  /// jumps [currentStep] to the first tab with a problem.
  String? validateBeforeSubmit() {
    // Step 0: Member Details
    if (mobileNumberCtrl.text.trim().isEmpty) {
      currentStep.value = 0;
      return 'Mobile Number is required.';
    }
    if (clientNameCtrl.text.trim().isEmpty) {
      currentStep.value = 0;
      return 'First Name is required.';
    }
    if (isRequired('lastName') && lastNameCtrl.text.trim().isEmpty) {
      currentStep.value = 0;
      return 'Last Name is required.';
    }
    if (isRequired('dateOfBirth') && dobCtrl.text.trim().isEmpty) {
      currentStep.value = 0;
      return 'Date of Birth is required.';
    }
    if (isRequired('gender') && gender.value == null) {
      currentStep.value = 0;
      return 'Gender is required.';
    }
    if (isRequired('votersIdNo') && votersIdNoCtrl.text.trim().isEmpty) {
      currentStep.value = 0;
      return 'Voter ID is required.';
    }

    // Step 1: Credit Check
    if (isRequired('otherIdNo') && otherIdNoCtrl.text.trim().isEmpty) {
      currentStep.value = 1;
      return 'Aadhaar Number is required.';
    }
    if (isRequired('pancardNo') && pancardNoCtrl.text.trim().isEmpty) {
      currentStep.value = 1;
      return 'PAN Card is required.';
    }

    // Step 2: Other Details
    if (isRequired('pincode') && pincodeCtrl.text.trim().isEmpty) {
      currentStep.value = 2;
      return 'Pincode is required.';
    }
    if (isRequired('ifscCode') && ifscCodeCtrl.text.trim().isEmpty) {
      currentStep.value = 2;
      return 'IFSC Code is required.';
    }
    if (isRequired('bankAcNo') && bankAcNoCtrl.text.trim().isEmpty) {
      currentStep.value = 2;
      return 'Bank Account Number is required.';
    }

    // Step 3: Co-Applicant
    if ((isRequired('coApplicantName') || isRequired('nomineeName')) &&
        nomineeNameCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'Co-Applicant Name is required.';
    }
    if ((isRequired('coApplicantRelation') || isRequired('nomineeRelation')) &&
        nomineeRelation.value == null) {
      currentStep.value = 3;
      return 'Co-Applicant Relation is required.';
    }
    if ((isRequired('coApplicantMobileNumber') || isRequired('nomineePhoneNumber')) &&
        nomineePhoneNumberCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'Co-Applicant Mobile Number is required.';
    }
    if ((isRequired('coApplicantDob') || isRequired('nomineeDateOfBirth')) &&
        nomineeDateOfBirthCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'Co-Applicant Date of Birth is required.';
    }
    if (isRequired('caOtherIdNo') && caOtherIdNoCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'CA Aadhaar ID is required.';
    }
    if (isRequired('caVoterIdNo') && caVoterIdNoCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'CA Voter ID is required.';
    }
    if (isRequired('caPancardNo') && caPancardNoCtrl.text.trim().isEmpty) {
      currentStep.value = 3;
      return 'CA PAN Card is required.';
    }
    if (isRequired('coApplicantEconomicActivityTypeId') &&
        coApplicantEconomicActivityTypeId.value == null) {
      currentStep.value = 3;
      return 'Co-Applicant Economic Activity Type is required.';
    }
    if (isRequired('coApplicantEconomicActivityId') &&
        coApplicantEconomicActivityId.value == null) {
      currentStep.value = 3;
      return 'Co-Applicant Economic Activity is required.';
    }

    // Client vs co-applicant identity-collision check
    final collisions = <String, String>{
      'Mobile Number': mobileNumberCtrl.text.trim(),
      'Aadhaar Number': otherIdNoCtrl.text.trim(),
      'PAN Card Number': pancardNoCtrl.text.trim(),
      'Voter ID Number': votersIdNoCtrl.text.trim(),
    };
    final coApplicantValues = <String, String>{
      'Mobile Number': nomineePhoneNumberCtrl.text.trim(),
      'Aadhaar Number': caOtherIdNoCtrl.text.trim(),
      'PAN Card Number': caPancardNoCtrl.text.trim(),
      'Voter ID Number': caVoterIdNoCtrl.text.trim(),
    };
    for (final label in collisions.keys) {
      final a = collisions[label]!;
      final b = coApplicantValues[label]!;
      if (a.isNotEmpty && b.isNotEmpty && a == b) {
        currentStep.value = 3;
        return 'Client and Co-Applicant cannot use the same $label.';
      }
    }

    // Step 4: Loan Details
    if (memberGroupStatus.value == null ||
        requestedCenterId.value == null ||
        requestedGroupId.value == null) {
      currentStep.value = 4;
      return 'Select Group Status, Center and Group before submitting.';
    }
    if (isRequired('requestedLoanProductId') && requestedLoanProductId.value == null) {
      currentStep.value = 4;
      return 'Requested Loan Product is required.';
    }

    return null;
  }

  Future<bool> submitEnrollment() async {
    final error = validateBeforeSubmit();
    if (error != null) {
      Get.snackbar(
        'Cannot Submit',
        error,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
      return false;
    }

    isLoading.value = true;
    try {
      final result = await api.submitEnrollment(buildSubmitPayload());
      await deleteDraftAfterSubmit();
      Get.snackbar(
        'Enrollment Submitted',
        'Client ${result['clientId'] ?? ''} enrolled successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      final errStr = e.toString();
      if (errStr.contains('CA ') ||
          errStr.contains('caOtherIdNo') ||
          errStr.contains('caVoterIdNo') ||
          errStr.contains('caPancardNo') ||
          errStr.contains('Co-Applicant') ||
          errStr.contains('nominee')) {
        currentStep.value = 3; // Co-Applicant tab
      } else if (errStr.contains('Group') ||
          errStr.contains('Center') ||
          errStr.contains('Loan')) {
        currentStep.value = 4; // Loan Details tab
      } else if (errStr.contains('Address') ||
          errStr.contains('Pincode') ||
          errStr.contains('Bank') ||
          errStr.contains('IFSC') ||
          errStr.contains('Income') ||
          errStr.contains('Expense')) {
        currentStep.value = 2; // Other Details tab
      } else if (errStr.contains('Aadhaar') || errStr.contains('PAN Card')) {
        currentStep.value = 1; // Credit Check tab
      } else if (errStr.contains('Mobile') ||
          errStr.contains('First Name') ||
          errStr.contains('Last Name') ||
          errStr.contains('Date of Birth') ||
          errStr.contains('Gender')) {
        currentStep.value = 0; // Member Details tab
      } else if (errStr.contains('Document') ||
          errStr.contains('Photo') ||
          errStr.contains('File') ||
          errStr.contains('Upload')) {
        currentStep.value = 5; // KYC Details tab
      }

      Get.snackbar(
        'Submission Failed',
        'Failed to submit enrollment: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }
}
