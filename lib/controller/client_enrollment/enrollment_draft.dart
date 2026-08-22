import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Server-synced draft save/restore, matching `POST/GET/DELETE
/// /api/clients/draft`. The draft body is intentionally flatter than the
/// final-submit body (no requestedCenterId/requestedGroupId/
/// memberGroupStatus/co-applicant-economic-activity fields exist in the
/// backend's draft schema, and the co-applicant phone key there is
/// `nomineePhone`, not `nomineePhoneNumber`) — this mirrors the web app's
/// own draft/submit asymmetry rather than "fixing" it.
mixin EnrollmentDraftMixin on GetxController {
  EnrollmentApiService get api;
  RxMap<String, EnrollmentDocState> get kycDocuments;
  Rxn<String> get draftDbId;

  final isAutoSaving = false.obs;
  final lastAutoSavedAt = Rxn<DateTime>();
  Timer? _autoSaveTimer;
  Timer? _periodicSaveTimer;

  TextEditingController get mobileNumberCtrl;
  TextEditingController get clientNameCtrl;
  TextEditingController get lastNameCtrl;
  TextEditingController get emailCtrl;
  TextEditingController get dobCtrl;
  TextEditingController get ageCtrl;
  Rxn<String> get gender;
  Rxn<String> get caste;
  Rxn<String> get community;
  Rxn<String> get religion;
  Rxn<String> get qualification;
  Rxn<String> get maritalStatus;
  Rxn<String> get houseStatus;
  TextEditingController get fatherNameCtrl;
  TextEditingController get motherNameCtrl;
  TextEditingController get noOfChildrenCtrl;
  TextEditingController get permanentAddressCtrl;
  TextEditingController get pincodeCtrl;
  TextEditingController get postOfficeCtrl;
  TextEditingController get districtCtrl;
  TextEditingController get stateCtrl;
  TextEditingController get countryCtrl;
  RxString get latitude;
  RxString get longitude;
  Rxn<String> get economicActivityTypeId;
  Rxn<String> get economicActivityId;
  TextEditingController get monthlyFamilyIncomeCtrl;
  TextEditingController get monthlyFamilyExpenseCtrl;
  TextEditingController get spouseNameCtrl;
  TextEditingController get spouseDobCtrl;
  TextEditingController get spouseMobileNumberCtrl;
  Rxn<String> get spouseGender;
  Rxn<String> get spouseEconomicActivityTypeId;
  Rxn<String> get spouseEconomicActivityId;
  TextEditingController get ifscCodeCtrl;
  TextEditingController get bankAcNoCtrl;
  TextEditingController get bankNameCtrl;
  TextEditingController get bankBranchCtrl;
  Rxn<String> get bankAccountType;
  TextEditingController get votersIdNoCtrl;
  TextEditingController get caVoterIdNoCtrl;
  TextEditingController get otherIdNoCtrl;
  TextEditingController get caOtherIdNoCtrl;
  TextEditingController get pancardNoCtrl;
  TextEditingController get caPancardNoCtrl;
  TextEditingController get smartCardNoCtrl;
  TextEditingController get nomineeNameCtrl;
  Rxn<String> get nomineeRelation;
  TextEditingController get nomineePhoneNumberCtrl;
  Rxn<String> get nomineeGender;
  TextEditingController get nomineeDateOfBirthCtrl;
  TextEditingController get nomineeAgeCtrl;
  Rxn<String> get coApplicantEconomicActivityTypeId;
  Rxn<String> get coApplicantEconomicActivityId;
  Future<void> onEconomicActivityTypeChanged(
    String? typeId, {
    required EaScope scope,
  });
  Rxn<String> get memberGroupStatus;
  Rxn<String> get requestedCenterId;
  Rxn<String> get requestedGroupId;
  Future<void> onCenterChanged(String? centerId);
  void onLoanProductSelected(String? productId);
  Future<void> onLoanPurposeTypeChanged(String? typeId);
  Rxn<String> get requestedLoanProductId;
  Rxn<String> get requestedLoanProductTypeId;
  RxString get requestedLoanFrequency;
  Rxn<String> get requestedLoanPurposeTypeId;
  Rxn<String> get requestedLoanPurposeId;

  String _formatDob(String? raw) {
    if (raw == null || raw.isEmpty) return '';
    final clean = raw.split('T').first.trim();
    if (clean.contains('-')) {
      final parts = clean.split('-');
      if (parts.length == 3 && parts[0].length == 4) {
        return '${parts[2].padLeft(2, '0')}-${parts[1].padLeft(2, '0')}-${parts[0]}';
      }
    }
    return clean;
  }

  Map<String, dynamic> _buildDraftBody() {
    return {
      'mobileNumber': mobileNumberCtrl.text.trim(),
      'firstName': clientNameCtrl.text.trim(),
      'lastName': lastNameCtrl.text.trim(),
      'email': emailCtrl.text.trim(),
      'dateOfBirth': dobCtrl.text.trim(),
      'age': ageCtrl.text.trim(),
      'gender': gender.value,
      'caste': caste.value,
      'community': community.value,
      'religion': religion.value,
      'qualification': qualification.value,
      'maritalStatus': maritalStatus.value,
      'houseStatus': houseStatus.value,
      'fatherName': fatherNameCtrl.text.trim(),
      'motherName': motherNameCtrl.text.trim(),
      'noOfChildren': noOfChildrenCtrl.text.trim(),
      'permanentAddress': permanentAddressCtrl.text.trim(),
      'pincode': pincodeCtrl.text.trim(),
      'postOffice': postOfficeCtrl.text.trim(),
      'district': districtCtrl.text.trim(),
      'state': stateCtrl.text.trim(),
      'country': countryCtrl.text.trim(),
      'latitude': latitude.value,
      'longitude': longitude.value,
      'economicActivityTypeId': economicActivityTypeId.value,
      'economicActivityId': economicActivityId.value,
      'monthlyFamilyIncome': monthlyFamilyIncomeCtrl.text.trim(),
      'monthlyFamilyExpense': monthlyFamilyExpenseCtrl.text.trim(),
      'spouseName': spouseNameCtrl.text.trim(),
      'spouseDob': spouseDobCtrl.text.trim(),
      'spouseMobileNumber': spouseMobileNumberCtrl.text.trim(),
      'spouseGender': spouseGender.value,
      'spouseEconomicActivityTypeId': spouseEconomicActivityTypeId.value,
      'spouseEconomicActivityId': spouseEconomicActivityId.value,
      'ifscCode': ifscCodeCtrl.text.trim(),
      'bankAcNo': bankAcNoCtrl.text.trim(),
      'bankName': bankNameCtrl.text.trim(),
      'bankBranch': bankBranchCtrl.text.trim(),
      'bankAccountType': bankAccountType.value,
      'votersIdNo': votersIdNoCtrl.text.trim(),
      'caVoterIdNo': caVoterIdNoCtrl.text.trim(),
      'otherIdNo': otherIdNoCtrl.text.trim(),
      'caOtherIdNo': caOtherIdNoCtrl.text.trim(),
      'pancardNo': pancardNoCtrl.text.trim(),
      'caPancardNo': caPancardNoCtrl.text.trim(),
      'smartCardNo': smartCardNoCtrl.text.trim(),
      'nomineeName': nomineeNameCtrl.text.trim(),
      'nomineeRelation': nomineeRelation.value,
      'nomineePhone': nomineePhoneNumberCtrl.text.trim(),
      'nomineeGender': nomineeGender.value,
      'nomineeDateOfBirth': nomineeDateOfBirthCtrl.text.trim(),
      'nomineeAge': nomineeAgeCtrl.text.trim(),
      'coApplicantEconomicActivityTypeId':
          coApplicantEconomicActivityTypeId.value,
      'coApplicantEconomicActivityId': coApplicantEconomicActivityId.value,
      'memberGroupStatus': memberGroupStatus.value,
      'requestedCenterId': requestedCenterId.value,
      'requestedGroupId': requestedGroupId.value,
      'requestedLoanProductId': requestedLoanProductId.value,
      'requestedLoanProductTypeId': requestedLoanProductTypeId.value,
      'requestedLoanFrequency': requestedLoanFrequency.value,
      'requestedLoanPurposeTypeId': requestedLoanPurposeTypeId.value,
      'requestedLoanPurposeId': requestedLoanPurposeId.value,
      'kycDocuments': kycDocuments.entries
          .where((e) => e.value.isUploaded)
          .map(
            (e) => {
              'documentType': e.key,
              'fileUrl': e.value.fileUrl,
              'fileName': e.value.fileName,
              'fileSize': e.value.fileSize,
              'mimeType': e.value.mimeType,
            },
          )
          .toList(),
      if (draftDbId.value != null) 'existingClientId': draftDbId.value,
    };
  }

  void scheduleAutoSave() {
    final mobile = mobileNumberCtrl.text.trim();
    if (mobile.length < 10) return;
    _autoSaveTimer?.cancel();
    _autoSaveTimer = Timer(const Duration(milliseconds: 1500), () {
      saveDraft(silent: true);
    });
  }

  void startAutoSaveListeners() {
    final textCtrls = [
      mobileNumberCtrl,
      clientNameCtrl,
      lastNameCtrl,
      emailCtrl,
      dobCtrl,
      fatherNameCtrl,
      motherNameCtrl,
      noOfChildrenCtrl,
      permanentAddressCtrl,
      pincodeCtrl,
      postOfficeCtrl,
      districtCtrl,
      stateCtrl,
      monthlyFamilyIncomeCtrl,
      monthlyFamilyExpenseCtrl,
      spouseNameCtrl,
      spouseDobCtrl,
      spouseMobileNumberCtrl,
      ifscCodeCtrl,
      bankAcNoCtrl,
      votersIdNoCtrl,
      caVoterIdNoCtrl,
      otherIdNoCtrl,
      caOtherIdNoCtrl,
      pancardNoCtrl,
      caPancardNoCtrl,
      smartCardNoCtrl,
      nomineeNameCtrl,
      nomineePhoneNumberCtrl,
      nomineeDateOfBirthCtrl,
    ];
    for (final ctrl in textCtrls) {
      ctrl.addListener(scheduleAutoSave);
    }

    final rxnVars = [
      gender,
      caste,
      community,
      religion,
      qualification,
      maritalStatus,
      houseStatus,
      economicActivityTypeId,
      economicActivityId,
      spouseGender,
      spouseEconomicActivityTypeId,
      spouseEconomicActivityId,
      bankAccountType,
      nomineeRelation,
      nomineeGender,
      requestedLoanProductId,
      requestedLoanProductTypeId,
      requestedLoanPurposeTypeId,
      requestedLoanPurposeId,
    ];
    for (final rxn in rxnVars) {
      ever(rxn, (_) => scheduleAutoSave());
    }

    ever(kycDocuments, (_) => scheduleAutoSave());

    _periodicSaveTimer?.cancel();
    _periodicSaveTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mobileNumberCtrl.text.trim().length >= 10) {
        saveDraft(silent: true);
      }
    });
  }

  void cancelAutoSaveTimers() {
    _autoSaveTimer?.cancel();
    _periodicSaveTimer?.cancel();
  }

  Future<void> saveDraft({bool silent = false}) async {
    final mobile = mobileNumberCtrl.text.trim();
    if (mobile.length < 10) {
      if (!silent) {
        Get.snackbar(
          'Mobile number required',
          'Enter at least a 10-digit mobile number before saving a draft.',
          backgroundColor: Colors.orange,
          colorText: Colors.white,
        );
      }
      return;
    }
    try {
      isAutoSaving.value = true;
      final result = await api.saveDraft(_buildDraftBody());
      if (result != null && result['id'] != null) {
        draftDbId.value = result['id'].toString();
      }
      lastAutoSavedAt.value = DateTime.now();
      if (!silent) {
        Get.snackbar(
          'Draft Saved',
          'Your progress has been saved as a draft.',
          backgroundColor: const Color(0xFF008A3D),
          colorText: Colors.white,
        );
      }
    } catch (e) {
      if (!silent) {
        Get.snackbar(
          'Draft Save Failed',
          'Failed to save draft: $e',
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
        );
      }
    } finally {
      isAutoSaving.value = false;
    }
  }

  Future<void> loadDraftIfExists() async {
    final mobile = mobileNumberCtrl.text.trim();
    if (mobile.length < 10) return;
    try {
      final draft = await api.loadDraft(mobile);
      if (draft == null) return;

      draftDbId.value = (draft['id'] ?? draft['dbId'])?.toString();
      clientNameCtrl.text = draft['firstName']?.toString() ?? clientNameCtrl.text;
      lastNameCtrl.text = draft['lastName']?.toString() ?? lastNameCtrl.text;
      emailCtrl.text = draft['email']?.toString() ?? emailCtrl.text;
      final dobVal = (draft['dateOfBirth'] ?? draft['dob'])?.toString();
      if (dobVal != null && dobVal.isNotEmpty) {
        dobCtrl.text = _formatDob(dobVal);
      }
      gender.value = draft['gender']?.toString() ?? gender.value;
      caste.value = draft['caste']?.toString() ?? caste.value;
      community.value = draft['community']?.toString() ?? community.value;
      religion.value = draft['religion']?.toString() ?? religion.value;
      qualification.value = draft['qualification']?.toString() ?? qualification.value;
      maritalStatus.value = draft['maritalStatus']?.toString() ?? maritalStatus.value;
      houseStatus.value = draft['houseStatus']?.toString() ?? houseStatus.value;
      fatherNameCtrl.text = draft['fatherName']?.toString() ?? fatherNameCtrl.text;
      motherNameCtrl.text = draft['motherName']?.toString() ?? motherNameCtrl.text;
      noOfChildrenCtrl.text = draft['noOfChildren']?.toString() ?? noOfChildrenCtrl.text;
      permanentAddressCtrl.text =
          draft['permanentAddress']?.toString() ?? permanentAddressCtrl.text;
      pincodeCtrl.text = draft['pincode']?.toString() ?? pincodeCtrl.text;
      postOfficeCtrl.text = draft['postOffice']?.toString() ?? postOfficeCtrl.text;
      districtCtrl.text = draft['district']?.toString() ?? districtCtrl.text;
      stateCtrl.text = draft['state']?.toString() ?? stateCtrl.text;
      countryCtrl.text = draft['country']?.toString() ?? countryCtrl.text;

      final lat = (draft['latitude'] ?? draft['lat'] ?? draft['location']?['latitude'])?.toString();
      if (lat != null && lat.isNotEmpty && lat != 'null') {
        latitude.value = lat;
      }
      final lng = (draft['longitude'] ?? draft['lng'] ?? draft['location']?['longitude'])?.toString();
      if (lng != null && lng.isNotEmpty && lng != 'null') {
        longitude.value = lng;
      }

      economicActivityTypeId.value =
          draft['economicActivityTypeId']?.toString() ?? economicActivityTypeId.value;
      economicActivityId.value =
          draft['economicActivityId']?.toString() ?? economicActivityId.value;
      if (economicActivityTypeId.value != null &&
          economicActivityTypeId.value!.isNotEmpty) {
        onEconomicActivityTypeChanged(
          economicActivityTypeId.value,
          scope: EaScope.client,
        );
      }

      monthlyFamilyIncomeCtrl.text =
          draft['monthlyFamilyIncome']?.toString() ?? monthlyFamilyIncomeCtrl.text;
      monthlyFamilyExpenseCtrl.text =
          draft['monthlyFamilyExpense']?.toString() ?? monthlyFamilyExpenseCtrl.text;
      spouseNameCtrl.text = draft['spouseName']?.toString() ?? spouseNameCtrl.text;

      final spouseDobVal = (draft['spouseDob'] ?? draft['spouseDateOfBirth'])?.toString();
      if (spouseDobVal != null && spouseDobVal.isNotEmpty) {
        spouseDobCtrl.text = _formatDob(spouseDobVal);
      }

      spouseMobileNumberCtrl.text =
          draft['spouseMobileNumber']?.toString() ?? spouseMobileNumberCtrl.text;
      spouseGender.value = draft['spouseGender']?.toString() ?? spouseGender.value;
      spouseEconomicActivityTypeId.value =
          draft['spouseEconomicActivityTypeId']?.toString() ??
          spouseEconomicActivityTypeId.value;
      spouseEconomicActivityId.value =
          draft['spouseEconomicActivityId']?.toString() ?? spouseEconomicActivityId.value;
      if (spouseEconomicActivityTypeId.value != null &&
          spouseEconomicActivityTypeId.value!.isNotEmpty) {
        onEconomicActivityTypeChanged(
          spouseEconomicActivityTypeId.value,
          scope: EaScope.spouse,
        );
      }

      ifscCodeCtrl.text = draft['ifscCode']?.toString() ?? ifscCodeCtrl.text;
      bankAcNoCtrl.text = draft['bankAcNo']?.toString() ?? bankAcNoCtrl.text;
      bankNameCtrl.text = draft['bankName']?.toString() ?? bankNameCtrl.text;
      bankBranchCtrl.text = draft['bankBranch']?.toString() ?? bankBranchCtrl.text;
      bankAccountType.value = draft['bankAccountType']?.toString() ?? bankAccountType.value;
      votersIdNoCtrl.text = draft['votersIdNo']?.toString() ?? votersIdNoCtrl.text;
      caVoterIdNoCtrl.text = draft['caVoterIdNo']?.toString() ?? caVoterIdNoCtrl.text;
      otherIdNoCtrl.text = draft['otherIdNo']?.toString() ?? otherIdNoCtrl.text;
      caOtherIdNoCtrl.text = draft['caOtherIdNo']?.toString() ?? caOtherIdNoCtrl.text;
      pancardNoCtrl.text = draft['pancardNo']?.toString() ?? pancardNoCtrl.text;
      caPancardNoCtrl.text = draft['caPancardNo']?.toString() ?? caPancardNoCtrl.text;
      smartCardNoCtrl.text = draft['smartCardNo']?.toString() ?? smartCardNoCtrl.text;
      nomineeNameCtrl.text = draft['nomineeName']?.toString() ?? nomineeNameCtrl.text;
      nomineeRelation.value = draft['nomineeRelation']?.toString() ?? nomineeRelation.value;
      nomineePhoneNumberCtrl.text =
          draft['nomineePhone']?.toString() ?? nomineePhoneNumberCtrl.text;
      nomineeGender.value = draft['nomineeGender']?.toString() ?? nomineeGender.value;

      final nomineeDobVal = (draft['nomineeDateOfBirth'] ?? draft['nomineeDob'])?.toString();
      if (nomineeDobVal != null && nomineeDobVal.isNotEmpty) {
        nomineeDateOfBirthCtrl.text = _formatDob(nomineeDobVal);
      }
      nomineeAgeCtrl.text = draft['nomineeAge']?.toString() ?? nomineeAgeCtrl.text;

      coApplicantEconomicActivityTypeId.value =
          draft['coApplicantEconomicActivityTypeId']?.toString() ??
          coApplicantEconomicActivityTypeId.value;
      coApplicantEconomicActivityId.value =
          draft['coApplicantEconomicActivityId']?.toString() ??
          coApplicantEconomicActivityId.value;
      if (coApplicantEconomicActivityTypeId.value != null &&
          coApplicantEconomicActivityTypeId.value!.isNotEmpty) {
        onEconomicActivityTypeChanged(
          coApplicantEconomicActivityTypeId.value,
          scope: EaScope.coApplicant,
        );
      }

      memberGroupStatus.value =
          draft['memberGroupStatus']?.toString() ??
          draft['groupStatus']?.toString() ??
          memberGroupStatus.value;
      final centerId = (draft['requestedCenterId'] ?? draft['centerId'])?.toString();
      if (centerId != null && centerId.isNotEmpty && centerId != 'null') {
        requestedCenterId.value = centerId;
        await onCenterChanged(centerId);
      }
      final groupId = (draft['requestedGroupId'] ?? draft['groupId'])?.toString();
      if (groupId != null && groupId.isNotEmpty && groupId != 'null') {
        requestedGroupId.value = groupId;
      }

      requestedLoanProductTypeId.value =
          draft['requestedLoanProductTypeId']?.toString() ??
          requestedLoanProductTypeId.value;
      requestedLoanFrequency.value =
          draft['requestedLoanFrequency']?.toString() ?? requestedLoanFrequency.value;
      requestedLoanProductId.value =
          draft['requestedLoanProductId']?.toString() ?? requestedLoanProductId.value;
      if (requestedLoanProductId.value != null &&
          requestedLoanProductId.value!.isNotEmpty) {
        onLoanProductSelected(requestedLoanProductId.value);
      }
      requestedLoanPurposeTypeId.value =
          draft['requestedLoanPurposeTypeId']?.toString() ??
          requestedLoanPurposeTypeId.value;
      if (requestedLoanPurposeTypeId.value != null &&
          requestedLoanPurposeTypeId.value!.isNotEmpty) {
        await onLoanPurposeTypeChanged(requestedLoanPurposeTypeId.value);
      }
      requestedLoanPurposeId.value =
          draft['requestedLoanPurposeId']?.toString() ?? requestedLoanPurposeId.value;

      final docs = draft['kycDocuments'];
      if (docs is List) {
        for (final doc in docs) {
          if (doc is! Map) continue;
          final type = doc['documentType']?.toString();
          final fileUrl = doc['fileUrl']?.toString();
          if (type == null || fileUrl == null || fileUrl.isEmpty) continue;
          kycDocuments[type] = EnrollmentDocState(
            fileUrl: fileUrl,
            fileName: doc['fileName']?.toString(),
            fileSize: doc['fileSize'] is int ? doc['fileSize'] as int : null,
            mimeType: doc['mimeType']?.toString(),
          );
        }
      }

      Get.snackbar(
        'Draft Restored',
        'A saved draft for this mobile number was restored.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
    } catch (e) {
      debugPrint('Failed to load draft: $e');
    }
  }

  Future<void> deleteDraftAfterSubmit() async {
    final id = draftDbId.value;
    if (id == null) return;
    try {
      await api.deleteDraft(id);
    } catch (e) {
      debugPrint('Failed to delete draft after submit: $e');
    }
  }
}
