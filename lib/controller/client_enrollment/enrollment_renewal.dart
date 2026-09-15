import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/services/loan_api_service.dart';

/// "Renewal Loan" mode for the Member Enrollment wizard — mirrors the web
/// app's `ClientEnrollmentForm` "Loan Type" dropdown: instead of a blank
/// enrollment, the FDO picks Center → Group → an existing approved member,
/// the form prefills every tab from that member's record (frozen except
/// address, co-applicant, Loan Details and house KYC — see
/// `RENEWAL_EDITABLE_KEYS` on web), and submit posts to
/// `POST /api/loans/renewal-application` instead of the normal enrollment
/// endpoint. Kept as its own mixin (rather than growing
/// `EnrollmentSubmitMixin`) since it's a genuinely separate submit path with
/// its own payload shape and validation order.
mixin EnrollmentRenewalMixin on GetxController {
  EnrollmentApiService get api;
  LoanApiService get loanApi;
  RxBool get isLoading;

  // Tab 1 — Member Details (identity, frozen) + address (editable)
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

  // Tab 2 — Credit Check
  Rxn<Map<String, dynamic>> get highmarkReport;

  // Tab 3 — Other Details (all frozen on renewal)
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
  TextEditingController get retypeBankAcNoCtrl;
  TextEditingController get bankNameCtrl;
  TextEditingController get bankBranchCtrl;
  Rxn<String> get bankAccountType;
  Rxn<String> get houseStatus;
  TextEditingController get motherNameCtrl;
  TextEditingController get smartCardNoCtrl;
  TextEditingController get caOtherIdNoCtrl;
  TextEditingController get caPancardNoCtrl;
  TextEditingController get caVoterIdNoCtrl;

  // Tab 4 — Co-Applicant (editable, "use existing" or "new")
  Rxn<String> get nomineeRelation;
  TextEditingController get nomineeNameCtrl;
  TextEditingController get nomineePhoneNumberCtrl;
  Rxn<String> get nomineeGender;
  TextEditingController get nomineeDateOfBirthCtrl;
  TextEditingController get nomineeAgeCtrl;
  Rxn<String> get coApplicantEconomicActivityTypeId;
  Rxn<String> get coApplicantEconomicActivityId;
  void onNomineeRelationChanged(String? relation);

  // Tab 5 — Loan Details (always fresh)
  Rxn<String> get requestedCenterId;
  Rxn<String> get requestedGroupId;
  Rxn<String> get requestedLoanProductTypeId;
  Rxn<String> get requestedLoanProductId;
  RxString get requestedLoanFrequency;
  Rxn<String> get requestedLoanPurposeTypeId;
  Rxn<String> get requestedLoanPurposeId;
  Rxn<Map<String, dynamic>> get selectedProduct;
  List<dynamic> get filteredProducts;
  int computeTenureMonths(int numberOfDues, String frequency);

  // Tab 6 — location + KYC uploads (lat/long mandatory re-capture; house
  // docs mandatory re-upload)
  RxString get latitude;
  RxString get longitude;
  RxString get mapsUrl;

  Future<void> onEconomicActivityTypeChanged(String? typeId, {required EaScope scope});

  // KYC/residence document state — declared concretely in
  // EnrollmentUploadsMixin, referenced here (both mixins live on the same
  // ClientEnrollmentController).
  EnrollmentDocState? docState(String documentType);

  // ---------------------------------------------------------------------
  // Renewal state
  // ---------------------------------------------------------------------

  /// 'MEMBER_ENROLLMENT' (default) or 'RENEWAL_LOAN'.
  final loanType = 'MEMBER_ENROLLMENT'.obs;
  bool get renewalMode => loanType.value == 'RENEWAL_LOAN';

  final rnCenterId = Rxn<String>();
  final rnGroupId = Rxn<String>();
  final rnEligibleMembers = <dynamic>[].obs;
  final rnMemberId = Rxn<String>(); // Client.id of the picked member
  final rnLoadingPrefill = false.obs;
  final rnPrefilled = false.obs;

  final rnCoMode = 'existing'.obs; // 'existing' | 'new'
  final rnCoApplicantId = Rxn<String>();
  final rnExistingCoApplicants = <dynamic>[].obs;

  final rnSubmitting = false.obs;

  /// Groups derived client-side from the eligible-members list for the
  /// picked center — mirrors web's `rnGroupOptions` (there is no separate
  /// "groups for renewal" endpoint).
  List<Map<String, String>> get rnGroupOptions {
    final seen = <String, Map<String, String>>{};
    for (final m in rnEligibleMembers) {
      if (m is! Map) continue;
      final gid = m['groupId']?.toString();
      if (gid == null || gid.isEmpty || seen.containsKey(gid)) continue;
      final label = '${m['groupCode'] ?? ''} ${m['groupName'] ?? ''}'.trim();
      seen[gid] = {'id': gid, 'label': label.isEmpty ? gid : label};
    }
    return seen.values.toList();
  }

  void onLoanTypeChanged(String? type) {
    loanType.value = type ?? 'MEMBER_ENROLLMENT';
    if (!renewalMode) {
      rnCenterId.value = null;
      rnGroupId.value = null;
      rnMemberId.value = null;
      rnEligibleMembers.clear();
      rnPrefilled.value = false;
    }
  }

  Future<void> onRnCenterChanged(String? centerId) async {
    rnCenterId.value = centerId;
    rnGroupId.value = null;
    rnMemberId.value = null;
    rnPrefilled.value = false;
    await _loadRnEligibleMembers();
  }

  Future<void> onRnGroupChanged(String? groupId) async {
    rnGroupId.value = groupId;
    rnMemberId.value = null;
    rnPrefilled.value = false;
    await _loadRnEligibleMembers();
  }

  Future<void> _loadRnEligibleMembers() async {
    final centerId = rnCenterId.value;
    if (centerId == null || centerId.isEmpty) {
      rnEligibleMembers.clear();
      return;
    }
    try {
      rnEligibleMembers.assignAll(
        await loanApi.getEligibleClientsForRenewal(centerId, groupId: rnGroupId.value),
      );
    } catch (e) {
      debugPrint('Failed to load renewal-eligible members: $e');
      rnEligibleMembers.clear();
    }
  }

  String? _fmtDate(dynamic value) {
    if (value == null) return null;
    final str = value.toString();
    if (str.isEmpty) return null;
    try {
      final iso = DateTime.tryParse(str);
      if (iso != null) return DateFormat('dd-MM-yyyy').format(iso);
    } catch (_) {}
    return str.length >= 10 ? str.substring(0, 10) : str;
  }

  String? _s(dynamic v) => v?.toString();

  /// Residence-proof document types that must be re-uploaded fresh for a
  /// renewal — carried-over docs never include these (matches web's
  /// `RN_EXCLUDE`).
  static const _rnExcludeDocs = {
    'house_image_1', 'house_image_2', 'house_image_3', 'location_qr',
    'gas_bill', 'noc_image_1', 'noc_image_2', 'noc_image_3',
  };

  /// Pulls the approved member's record into every tab (frozen except the
  /// editable areas) — mirrors web's `loadRenewalPrefill`.
  Future<void> loadRenewalPrefill(String clientId) async {
    rnLoadingPrefill.value = true;
    rnPrefilled.value = false;
    try {
      final d = await loanApi.getRenewalPrefill(clientId);
      if (d.isEmpty) {
        Get.snackbar(
          'Error',
          'Could not load member details.',
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
        );
        rnMemberId.value = null;
        return;
      }

      // Tab 1 — identity (frozen) + address (editable)
      mobileNumberCtrl.text = _s(d['phone']) ?? _s(d['mobileNumber']) ?? '';
      otherIdNoCtrl.text = _s(d['otherIdNo']) ?? '';
      clientNameCtrl.text = _s(d['firstName']) ?? '';
      lastNameCtrl.text = _s(d['lastName']) ?? '';
      pancardNoCtrl.text = _s(d['pancardNo']) ?? '';
      votersIdNoCtrl.text = _s(d['votersIdNo']) ?? '';
      smartCardNoCtrl.text = _s(d['smartCardNo']) ?? '';
      caOtherIdNoCtrl.text = _s(d['caOtherIdNo']) ?? '';
      caPancardNoCtrl.text = _s(d['caPancardNo']) ?? '';
      caVoterIdNoCtrl.text = _s(d['caVoterIdNo']) ?? '';
      dobCtrl.text = _fmtDate(d['dateOfBirth']) ?? '';
      fatherNameCtrl.text = _s(d['fatherName']) ?? '';
      motherNameCtrl.text = _s(d['motherName']) ?? '';
      gender.value = _s(d['gender']);
      permanentAddressCtrl.text = _s(d['permanentAddress']) ?? '';
      pincodeCtrl.text = _s(d['pincode']) ?? '';
      postOfficeCtrl.text = _s(d['postOffice']) ?? '';
      stateCtrl.text = _s(d['state']) ?? '';
      districtCtrl.text = _s(d['district']) ?? '';
      countryCtrl.text = _s(d['country']) ?? 'India';

      // Tab 2 — Credit Check: show the latest pulled report, if any.
      final latest = d['latestHighmark'];
      highmarkReport.value = latest is Map ? Map<String, dynamic>.from(latest) : null;

      // Tab 3 — Other Details (all frozen)
      emailCtrl.text = _s(d['email']) ?? '';
      final age = d['age'];
      ageCtrl.text = age != null ? age.toString() : '';
      caste.value = _s(d['caste']);
      community.value = _s(d['community']);
      religion.value = _s(d['religion']);
      qualification.value = _s(d['qualification']);
      maritalStatus.value = _s(d['maritalStatus']);
      spouseNameCtrl.text = _s(d['spouseName']) ?? '';
      spouseDobCtrl.text = _fmtDate(d['spouseDob']) ?? '';
      spouseMobileNumberCtrl.text = _s(d['spouseMobileNumber']) ?? '';
      spouseGender.value = _s(d['spouseGender']);
      final noOfChildren = d['noOfChildren'];
      noOfChildrenCtrl.text = noOfChildren != null ? noOfChildren.toString() : '';
      final income = d['monthlyFamilyIncome'];
      monthlyFamilyIncomeCtrl.text = income != null ? income.toString() : '';
      final expense = d['monthlyFamilyExpense'];
      monthlyFamilyExpenseCtrl.text = expense != null ? expense.toString() : '';
      ifscCodeCtrl.text = _s(d['ifscCode']) ?? '';
      bankAcNoCtrl.text = _s(d['bankAcNo']) ?? '';
      retypeBankAcNoCtrl.text = _s(d['bankAcNo']) ?? '';
      bankNameCtrl.text = _s(d['bankName']) ?? '';
      bankBranchCtrl.text = _s(d['bankBranch']) ?? '';
      bankAccountType.value = _s(d['bankAccountType']);
      houseStatus.value = _s(d['houseStatus']);

      final ecoTypeId = _s(d['economicActivityTypeId']);
      economicActivityTypeId.value = ecoTypeId;
      economicActivityId.value = _s(d['economicActivityId']);
      if (ecoTypeId != null && ecoTypeId.isNotEmpty) {
        await onEconomicActivityTypeChanged(ecoTypeId, scope: EaScope.client);
        economicActivityId.value = _s(d['economicActivityId']);
      }
      final spouseEcoTypeId = _s(d['spouseEconomicActivityTypeId']);
      spouseEconomicActivityTypeId.value = spouseEcoTypeId;
      spouseEconomicActivityId.value = _s(d['spouseEconomicActivityId']);
      if (spouseEcoTypeId != null && spouseEcoTypeId.isNotEmpty) {
        await onEconomicActivityTypeChanged(spouseEcoTypeId, scope: EaScope.spouse);
        spouseEconomicActivityId.value = _s(d['spouseEconomicActivityId']);
      }

      // Tab 5 — Loan Details always starts fresh for a renewal.
      final center = d['center'];
      requestedCenterId.value = (center is Map ? _s(center['id']) : null) ?? rnCenterId.value;
      requestedGroupId.value = rnGroupId.value;
      requestedLoanProductTypeId.value = null;
      requestedLoanProductId.value = null;
      requestedLoanFrequency.value = 'weekly';
      requestedLoanPurposeTypeId.value = null;
      requestedLoanPurposeId.value = null;
      selectedProduct.value = null;

      // Tab 6 — location + house KYC are mandatory fresh captures.
      latitude.value = '';
      longitude.value = '';
      mapsUrl.value = '';
      kycDocuments.clear();
      final docs = d['kycDocuments'];
      if (docs is List) {
        for (final doc in docs) {
          if (doc is! Map) continue;
          final type = doc['documentType']?.toString();
          final fileUrl = doc['fileUrl']?.toString();
          if (type == null || fileUrl == null || fileUrl.isEmpty) continue;
          if (_rnExcludeDocs.contains(type)) continue;
          kycDocuments[type] = EnrollmentDocState(
            fileUrl: fileUrl,
            fileName: doc['fileName']?.toString(),
            mimeType: doc['mimeType']?.toString(),
          );
        }
      }

      rnMemberId.value = clientId;
      rnPrefilled.value = true;

      // Co-applicant list is best-effort — a failure must not leave the
      // form stuck on an otherwise-usable prefill.
      try {
        final coList = await loanApi.getEligibleCoApplicants(clientId);
        rnExistingCoApplicants.assignAll(coList);
        if (coList.isNotEmpty) {
          rnCoMode.value = 'existing';
          Map? primary;
          for (final c in coList) {
            if (c is Map && c['isPrimary'] == true) {
              primary = c;
              break;
            }
          }
          final first = coList.first;
          rnCoApplicantId.value = _s((primary ?? (first is Map ? first : null))?['id']);
          onRnCoApplicantSelected(rnCoApplicantId.value);
        } else {
          rnCoMode.value = 'new';
          rnCoApplicantId.value = null;
          _clearCoApplicantFields();
        }
      } catch (e) {
        debugPrint('Failed to load eligible co-applicants: $e');
        rnExistingCoApplicants.clear();
        rnCoMode.value = 'new';
      }
    } catch (e) {
      Get.snackbar(
        'Error',
        'Could not load member details: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      rnMemberId.value = null;
    } finally {
      rnLoadingPrefill.value = false;
    }
  }

  void _clearCoApplicantFields() {
    nomineeRelation.value = null;
    nomineeNameCtrl.text = '';
    nomineePhoneNumberCtrl.text = '';
    nomineeGender.value = null;
    nomineeDateOfBirthCtrl.text = '';
    nomineeAgeCtrl.text = '';
    coApplicantEconomicActivityTypeId.value = null;
    coApplicantEconomicActivityId.value = null;
    caPancardNoCtrl.text = '';
    caVoterIdNoCtrl.text = '';
    caOtherIdNoCtrl.text = '';
  }

  /// Renewal — "Use existing" co-applicant: mirrors the picked co-applicant's
  /// details into the Co-Applicant tab's (now display-only) fields, purely
  /// for FDO/BM review. Submission for 'existing' mode only ever sends
  /// `coApplicantId` — see [buildRenewalPayload].
  void onRnCoApplicantSelected(String? id) {
    rnCoApplicantId.value = id;
    if (rnCoMode.value != 'existing' || id == null) return;
    Map? co;
    for (final c in rnExistingCoApplicants) {
      if (c is Map && c['id']?.toString() == id) {
        co = c;
        break;
      }
    }
    if (co == null) return;
    nomineeRelation.value = _s(co['relationWithClient']);
    nomineeNameCtrl.text = _s(co['name']) ?? '';
    nomineePhoneNumberCtrl.text = _s(co['mobileNumber']) ?? '';
    nomineeGender.value = _s(co['gender']);
    nomineeDateOfBirthCtrl.text = _fmtDate(co['dateOfBirth']) ?? '';
    final coAge = co['age'];
    nomineeAgeCtrl.text = coAge != null ? coAge.toString() : '';
    caPancardNoCtrl.text = _s(co['pancardNo']) ?? '';
    caVoterIdNoCtrl.text = _s(co['voterIdNo']) ?? '';
    caOtherIdNoCtrl.text = _s(co['otherIdNo']) ?? '';
    final coEaType = _s(co['economicActivityTypeId']);
    coApplicantEconomicActivityTypeId.value = coEaType;
    coApplicantEconomicActivityId.value = _s(co['economicActivityId']);
    if (coEaType != null && coEaType.isNotEmpty) {
      onEconomicActivityTypeChanged(coEaType, scope: EaScope.coApplicant).then((_) {
        coApplicantEconomicActivityId.value = _s(co?['economicActivityId']);
      });
    }
  }

  void onRnCoModeChanged(String mode) {
    rnCoMode.value = mode;
    if (mode == 'existing') {
      final fallbackId = rnExistingCoApplicants.isNotEmpty && rnExistingCoApplicants.first is Map
          ? (rnExistingCoApplicants.first as Map)['id']?.toString()
          : null;
      onRnCoApplicantSelected(rnCoApplicantId.value ?? fallbackId);
    } else {
      rnCoApplicantId.value = null;
      _clearCoApplicantFields();
    }
  }

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------

  /// Returns `null` when valid, or an error message otherwise — mirrors the
  /// order of `handleRenewalSubmit`'s checks on web.
  String? validateRenewalSubmit() {
    if (!rnPrefilled.value || rnMemberId.value == null) {
      return 'Pick Center → Group → Member first.';
    }
    final product = selectedProduct.value;
    if (requestedLoanProductId.value == null || product == null || product['loanAmount'] == null) {
      return 'Choose a product type, product and purpose in the Loan Details tab.';
    }
    if (requestedLoanPurposeId.value == null) {
      return 'Select a loan purpose in the Loan Details tab.';
    }
    if (docState('house_image_1')?.isUploaded != true) {
      return 'Re-upload House Image 1 in the KYC tab.';
    }
    if (latitude.value.trim().isEmpty || longitude.value.trim().isEmpty) {
      return 'Enter latitude & longitude (or use current location) in the KYC tab.';
    }
    if (docState('location_qr')?.isUploaded != true) {
      return 'Generate / upload the Location QR in the KYC tab.';
    }
    if (rnCoMode.value == 'existing' && (rnCoApplicantId.value == null || rnCoApplicantId.value!.isEmpty)) {
      return 'Select an existing co-applicant, or switch to "Add new".';
    }
    if (rnCoMode.value == 'new' &&
        (nomineeNameCtrl.text.trim().isEmpty ||
            nomineeRelation.value == null ||
            nomineePhoneNumberCtrl.text.trim().isEmpty)) {
      return 'Name, relation and mobile are required for a new co-applicant.';
    }
    return null;
  }

  RxMap<String, EnrollmentDocState> get kycDocuments;

  Map<String, dynamic> buildRenewalPayload() {
    final product = selectedProduct.value!;
    final numberOfDues = product['numberOfDues'] is int ? product['numberOfDues'] as int : null;
    final tenureMonths = numberOfDues != null
        ? computeTenureMonths(numberOfDues, requestedLoanFrequency.value)
        : 12;

    const houseKeys = ['house_image_1', 'house_image_2', 'house_image_3', 'location_qr'];
    final houseDocuments = <Map<String, dynamic>>[
      for (final k in houseKeys)
        if (docState(k)?.isUploaded == true)
          {
            'documentType': k,
            'fileUrl': docState(k)!.fileUrl,
            if (docState(k)!.fileName != null) 'fileName': docState(k)!.fileName,
          },
    ];

    final payload = <String, dynamic>{
      'clientId': rnMemberId.value,
      'centerId': requestedCenterId.value ?? rnCenterId.value,
      'loanProductId': requestedLoanProductId.value,
      'amount': '${product['loanAmount']}',
      'interestRate': '${product['interestRate'] ?? 0}',
      'tenureMonths': tenureMonths,
      'frequency': requestedLoanFrequency.value,
      'loanPurposeId': requestedLoanPurposeId.value,
      'proposedAddress': {
        'permanentAddress': _blank(permanentAddressCtrl.text),
        'pincode': _blank(pincodeCtrl.text),
        'postOffice': _blank(postOfficeCtrl.text),
        'district': _blank(districtCtrl.text),
        'state': _blank(stateCtrl.text),
        'country': _blank(countryCtrl.text),
        'latitude': _blank(latitude.value),
        'longitude': _blank(longitude.value),
      },
      'houseDocuments': houseDocuments,
    };

    if (rnCoMode.value == 'existing') {
      payload['coApplicant'] = {'mode': 'existing', 'coApplicantId': rnCoApplicantId.value};
    } else {
      payload['coApplicant'] = {
        'mode': 'new',
        'name': nomineeNameCtrl.text.trim(),
        'gender': nomineeGender.value ?? 'Other',
        'dateOfBirth': _isoDate(nomineeDateOfBirthCtrl.text) ?? DateTime.now().toIso8601String().substring(0, 10),
        'age': int.tryParse(nomineeAgeCtrl.text.trim()) ?? 0,
        'relationWithClient': nomineeRelation.value,
        'mobileNumber': nomineePhoneNumberCtrl.text.trim(),
        'economicActivityTypeId': coApplicantEconomicActivityTypeId.value,
        'economicActivityId': coApplicantEconomicActivityId.value,
        'voterIdNo': _blank(caVoterIdNoCtrl.text),
        'otherIdNo': _blank(caOtherIdNoCtrl.text),
        'pancardNo': _blank(caPancardNoCtrl.text),
      };
      const caKeys = [
        'co_applicant_photo',
        'co_applicant_other_id',
        'co_applicant_aadhaar_back',
        'co_applicant_pan_card',
      ];
      payload['coApplicantDocuments'] = <Map<String, dynamic>>[
        for (final k in caKeys)
          if (docState(k)?.isUploaded == true)
            {
              'documentType': k,
              'fileUrl': docState(k)!.fileUrl,
              if (docState(k)!.fileName != null) 'fileName': docState(k)!.fileName,
            },
      ];
    }
    return payload;
  }

  String? _blank(String value) => value.trim().isEmpty ? null : value.trim();

  String? _isoDate(String text) {
    if (text.trim().isEmpty) return null;
    try {
      return DateFormat('dd-MM-yyyy').parse(text.trim()).toIso8601String().substring(0, 10);
    } catch (_) {
      return null;
    }
  }

  Future<bool> submitRenewal() async {
    final error = validateRenewalSubmit();
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

    rnSubmitting.value = true;
    isLoading.value = true;
    try {
      final result = await loanApi.submitRenewalApplication(buildRenewalPayload());
      Get.snackbar(
        'Renewal loan submitted',
        'Loan ${result['loanNumber'] ?? ''} is now in the BM → AM → QC → Admin approval queue.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Submission Failed',
        'Failed to submit renewal loan: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      rnSubmitting.value = false;
      isLoading.value = false;
    }
  }
}
