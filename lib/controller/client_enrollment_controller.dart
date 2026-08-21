import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_draft.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_submit.dart';

/// Drives the FDO "Member Enrollment" 6-tab wizard, matching the web app's
/// `ClientEnrollmentForm` field-for-field and endpoint-for-endpoint. Split
/// across mixins by concern (lookups/uploads/draft/submit) since a single
/// 3000+ line controller would be unreviewable, while keeping one shared
/// reactive state object (tabs read/write each other's fields — e.g. Tab 4
/// co-applicant mirrors Tab 3's spouse fields).
class ClientEnrollmentController extends GetxController
    with
        EnrollmentLookupsMixin,
        EnrollmentUploadsMixin,
        EnrollmentDraftMixin,
        EnrollmentSubmitMixin {
  ClientEnrollmentController() : api = EnrollmentApiService(ApiClient());

  final EnrollmentApiService api;

  final currentStep = 0.obs;
  final isLoading = false.obs;

  // ---------------------------------------------------------------------
  // Tab 1 — Member Details
  // ---------------------------------------------------------------------
  final mobileNumberCtrl = TextEditingController();
  final mobileNumberFocus = FocusNode();
  final otherIdNoCtrl = TextEditingController(); // Aadhaar
  final otherIdNoFocus = FocusNode();
  final clientNameCtrl = TextEditingController(); // First Name
  final lastNameCtrl = TextEditingController();
  final pancardNoCtrl = TextEditingController();
  final pancardNoFocus = FocusNode();
  final votersIdNoCtrl = TextEditingController();
  final votersIdNoFocus = FocusNode();
  final dobCtrl = TextEditingController();
  final fatherNameCtrl = TextEditingController();
  final gender = Rxn<String>();
  final permanentAddressCtrl = TextEditingController();
  final pincodeCtrl = TextEditingController();
  final postOfficeCtrl = TextEditingController();
  final stateCtrl = TextEditingController();
  final districtCtrl = TextEditingController(); // "City" in the UI
  final countryCtrl = TextEditingController(text: 'India');

  final postOfficeOptions = <String>[].obs;
  final isFetchingPincode = false.obs;

  // ---------------------------------------------------------------------
  // Tab 2 — Credit Check (Highmark/CRIF)
  // ---------------------------------------------------------------------
  final highmarkConsent = false.obs;
  final Rxn<Map<String, dynamic>> highmarkReport = Rxn<Map<String, dynamic>>();
  final isRunningCreditCheck = false.obs;
  final isLoadingLatestReport = false.obs;

  // ---------------------------------------------------------------------
  // Tab 3 — Member Other Details
  // ---------------------------------------------------------------------
  final emailCtrl = TextEditingController();
  final ageCtrl = TextEditingController(); // read-only, derived from DOB
  final caste = Rxn<String>();
  final community = Rxn<String>();
  final economicActivityTypeId = Rxn<String>();
  final economicActivityId = Rxn<String>();
  final religion = Rxn<String>();
  final qualification = Rxn<String>();
  final maritalStatus = Rxn<String>();
  final spouseNameCtrl = TextEditingController();
  final spouseDobCtrl = TextEditingController();
  final spouseMobileNumberCtrl = TextEditingController();
  final spouseGender = Rxn<String>();
  final spouseEconomicActivityTypeId = Rxn<String>();
  final spouseEconomicActivityId = Rxn<String>();
  final noOfChildrenCtrl = TextEditingController();
  final monthlyFamilyIncomeCtrl = TextEditingController();
  final monthlyFamilyExpenseCtrl = TextEditingController();
  final ifscCodeCtrl = TextEditingController();
  final bankAcNoCtrl = TextEditingController();
  final bankAcNoFocus = FocusNode();
  final retypeBankAcNoCtrl = TextEditingController();
  final bankNameCtrl = TextEditingController();
  final bankBranchCtrl = TextEditingController();
  final bankAccountType = Rxn<String>();
  final houseStatus = Rxn<String>();
  final motherNameCtrl = TextEditingController();
  final smartCardNoCtrl = TextEditingController();

  final isFetchingIfsc = false.obs;
  final ifscLocked = false.obs;
  final ifscLookupAddress = ''.obs;

  // ---------------------------------------------------------------------
  // Tab 4 — Co-Applicant Details ("nominee" on the wire)
  // ---------------------------------------------------------------------
  final nomineeRelation = Rxn<String>();
  final nomineeNameCtrl = TextEditingController();
  final nomineePhoneNumberCtrl = TextEditingController();
  final nomineePhoneNumberFocus = FocusNode();
  final nomineePhoneNumberError = Rxn<String>();
  final mobileNumberError = Rxn<String>();
  final pancardNoError = Rxn<String>();
  final votersIdNoError = Rxn<String>();
  final caPancardNoError = Rxn<String>();
  final caVoterIdNoError = Rxn<String>();
  final caOtherIdNoError = Rxn<String>();
  final ifscCodeError = Rxn<String>();
  final bankAcNoError = Rxn<String>();
  final retypeBankAcNoError = Rxn<String>();
  final nomineeGender = Rxn<String>();
  final nomineeDateOfBirthCtrl = TextEditingController();
  final nomineeAgeCtrl = TextEditingController(); // read-only
  final coApplicantEconomicActivityTypeId = Rxn<String>();
  final coApplicantEconomicActivityId = Rxn<String>();
  final caPancardNoCtrl = TextEditingController();
  final caPancardNoFocus = FocusNode();
  final caVoterIdNoCtrl = TextEditingController();
  final caVoterIdNoFocus = FocusNode();
  final caOtherIdNoCtrl = TextEditingController();
  final caOtherIdNoFocus = FocusNode();

  final coApplicantFieldsLockedFromSpouse = false.obs;

  // ---------------------------------------------------------------------
  // Tab 5 — Loan Details
  // ---------------------------------------------------------------------
  final memberGroupStatus = Rxn<String>();
  final requestedCenterId = Rxn<String>();
  final requestedGroupId = Rxn<String>();
  final requestedLoanProductTypeId = Rxn<String>();
  final requestedLoanProductId = Rxn<String>();
  final requestedLoanFrequency = 'weekly'.obs;
  final requestedLoanPurposeTypeId = Rxn<String>();
  final requestedLoanPurposeId = Rxn<String>();
  final Rxn<Map<String, dynamic>> selectedProduct = Rxn<Map<String, dynamic>>();

  // ---------------------------------------------------------------------
  // Tab 6 — location (shared with Residence Verification uploads)
  // ---------------------------------------------------------------------
  final latitude = ''.obs;
  final longitude = ''.obs;
  final mapsUrl = ''.obs;
  final isLocating = false.obs;

  // ---------------------------------------------------------------------
  // Draft bookkeeping
  // ---------------------------------------------------------------------
  final Rxn<String> draftDbId = Rxn<String>();

  @override
  void onInit() {
    super.onInit();
    dobCtrl.addListener(_onDobChanged);
    nomineeDateOfBirthCtrl.addListener(_onNomineeDobChanged);
    mobileNumberFocus.addListener(() {
      if (!mobileNumberFocus.hasFocus) loadDraftIfExists();
    });
    otherIdNoFocus.addListener(() {
      if (!otherIdNoFocus.hasFocus) {
        checkUnique('otherIdNo', 'AADHAAR', 'CLIENT', otherIdNoCtrl.text);
      }
    });
    pancardNoFocus.addListener(() {
      if (!pancardNoFocus.hasFocus) {
        checkUnique('pancardNo', 'PAN', 'CLIENT', pancardNoCtrl.text);
      }
    });
    votersIdNoFocus.addListener(() {
      if (!votersIdNoFocus.hasFocus) {
        checkUnique('votersIdNo', 'VOTER_ID', 'CLIENT', votersIdNoCtrl.text);
      }
    });
    bankAcNoFocus.addListener(() {
      if (!bankAcNoFocus.hasFocus) {
        checkUnique('bankAcNo', 'BANK_ACCOUNT', 'CLIENT', bankAcNoCtrl.text);
      }
    });
    nomineePhoneNumberFocus.addListener(() {
      if (!nomineePhoneNumberFocus.hasFocus) {
        checkUnique(
          'nomineePhoneNumber',
          'MOBILE',
          'COAPPLICANT',
          nomineePhoneNumberCtrl.text,
          sibling: mobileNumberCtrl.text,
        );
      }
    });
    caOtherIdNoFocus.addListener(() {
      if (!caOtherIdNoFocus.hasFocus) {
        checkUnique(
          'caOtherIdNo',
          'AADHAAR',
          'COAPPLICANT',
          caOtherIdNoCtrl.text,
          sibling: otherIdNoCtrl.text,
        );
      }
    });
    caPancardNoFocus.addListener(() {
      if (!caPancardNoFocus.hasFocus) {
        checkUnique(
          'caPancardNo',
          'PAN',
          'COAPPLICANT',
          caPancardNoCtrl.text,
          sibling: pancardNoCtrl.text,
        );
      }
    });
    caVoterIdNoFocus.addListener(() {
      if (!caVoterIdNoFocus.hasFocus) {
        checkUnique(
          'caVoterIdNo',
          'VOTER_ID',
          'COAPPLICANT',
          caVoterIdNoCtrl.text,
          sibling: votersIdNoCtrl.text,
        );
      }
    });
    ifscCodeCtrl.addListener(() {
      validateIfsc(ifscCodeCtrl.text);
      onIfscChanged(ifscCodeCtrl.text);
    });
    bankAcNoCtrl.addListener(() {
      validateBankAccountNumbers();
    });
    retypeBankAcNoCtrl.addListener(() {
      validateBankAccountNumbers();
    });
    mobileNumberCtrl.addListener(
      () => validateMobileNumber(mobileNumberCtrl.text, mobileNumberError),
    );
    nomineePhoneNumberCtrl.addListener(
      () => validateMobileNumber(
        nomineePhoneNumberCtrl.text,
        nomineePhoneNumberError,
      ),
    );
    pancardNoCtrl.addListener(
      () => validatePan(pancardNoCtrl.text, pancardNoError),
    );
    caPancardNoCtrl.addListener(
      () => validatePan(caPancardNoCtrl.text, caPancardNoError),
    );
    votersIdNoCtrl.addListener(
      () => validateVoterId(votersIdNoCtrl.text, votersIdNoError),
    );
    caVoterIdNoCtrl.addListener(
      () => validateVoterId(caVoterIdNoCtrl.text, caVoterIdNoError),
    );
    pincodeCtrl.addListener(() {
      if (pincodeCtrl.text.length == 6) onPincodeChanged(pincodeCtrl.text);
    });

    spouseMobileNumberCtrl.addListener(_syncSpouseToNomineeIfLocked);
    spouseNameCtrl.addListener(_syncSpouseToNomineeIfLocked);
    spouseDobCtrl.addListener(_syncSpouseToNomineeIfLocked);
    ever(spouseGender, (_) => _syncSpouseToNomineeIfLocked());
    ever(spouseEconomicActivityTypeId, (id) {
      if (id != null && id.isNotEmpty) {
        onEconomicActivityTypeChanged(id, scope: EaScope.spouse);
      }
      _syncSpouseToNomineeIfLocked();
    });
    ever(spouseEconomicActivityId, (_) => _syncSpouseToNomineeIfLocked());

    loadStaticLookups();
    currentBranchId().then((branchId) {
      if (branchId.isNotEmpty) loadProductsForBranch(branchId);
    });
  }

  void validateMobileNumber(String value, Rxn<String> errorState) {
    final text = value.trim();
    if (text.isEmpty) {
      errorState.value = 'Enter a 10-digit phone number.';
      return;
    }
    if (!RegExp(r'^[6-9]\d{9}$').hasMatch(text)) {
      errorState.value = 'Please enter a valid 10-digit phone number.';
      return;
    }
    errorState.value = null;
  }

  void validatePan(String value, Rxn<String> errorState) {
    final text = value.trim().toUpperCase();
    if (text.isEmpty) {
      errorState.value = null;
      return;
    }
    if (!RegExp(r'^[A-Z]{5}[0-9]{4}[A-Z]$').hasMatch(text)) {
      errorState.value = 'PAN card must be in format: ABCDE1234F.';
      return;
    }
    errorState.value = null;
  }

  void validateVoterId(String value, Rxn<String> errorState) {
    final text = value.trim().toUpperCase();
    if (text.isEmpty) {
      errorState.value = null;
      return;
    }
    if (!RegExp(r'^[A-Z]{3}[0-9]{7}$').hasMatch(text) &&
        !RegExp(r'^[A-Z]{2}[0-9]{7}$').hasMatch(text)) {
      errorState.value =
          'Voter ID must be in standard format: ABC1234567 or Tamil Nadu format.';
      return;
    }
    errorState.value = null;
  }

  void validateIfsc(String value) {
    final text = value.trim().toUpperCase();
    if (text.isEmpty) {
      ifscCodeError.value = null;
      return;
    }
    if (!RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(text)) {
      ifscCodeError.value = 'IFSC code must be in format: SBIN0001234.';
      return;
    }
    ifscCodeError.value = null;
  }

  void validateBankAccountNumbers() {
    final a = bankAcNoCtrl.text.trim();
    final b = retypeBankAcNoCtrl.text.trim();
    if (a.isEmpty || b.isEmpty) {
      bankAcNoError.value = null;
      retypeBankAcNoError.value = null;
      return;
    }
    if (a != b) {
      bankAcNoError.value = 'Account numbers must match.';
      retypeBankAcNoError.value = 'Account numbers must match.';
      return;
    }
    bankAcNoError.value = null;
    retypeBankAcNoError.value = null;
  }

  void _onDobChanged() {
    final age = _calculateAge(dobCtrl.text);
    ageCtrl.text = age?.toString() ?? '';
  }

  void _onNomineeDobChanged() {
    final age = _calculateAge(nomineeDateOfBirthCtrl.text);
    nomineeAgeCtrl.text = age?.toString() ?? '';
  }

  void _syncSpouseToNomineeIfLocked() {
    if (coApplicantFieldsLockedFromSpouse.value || nomineeRelation.value == 'Spouse') {
      if (nomineeNameCtrl.text != spouseNameCtrl.text) {
        nomineeNameCtrl.text = spouseNameCtrl.text;
      }
      if (nomineeDateOfBirthCtrl.text != spouseDobCtrl.text) {
        nomineeDateOfBirthCtrl.text = spouseDobCtrl.text;
        _onNomineeDobChanged();
      }
      if (nomineePhoneNumberCtrl.text != spouseMobileNumberCtrl.text) {
        nomineePhoneNumberCtrl.text = spouseMobileNumberCtrl.text;
      }
      if (nomineeGender.value != spouseGender.value) {
        nomineeGender.value = spouseGender.value;
      }
      if (coApplicantEconomicActivityTypeId.value !=
          spouseEconomicActivityTypeId.value) {
        coApplicantEconomicActivityTypeId.value =
            spouseEconomicActivityTypeId.value;
        if (spouseEconomicActivityTypeId.value != null &&
            spouseEconomicActivityTypeId.value!.isNotEmpty) {
          onEconomicActivityTypeChanged(
            spouseEconomicActivityTypeId.value,
            scope: EaScope.coApplicant,
          );
        }
      }
      if (coApplicantEconomicActivityId.value !=
          spouseEconomicActivityId.value) {
        coApplicantEconomicActivityId.value = spouseEconomicActivityId.value;
      }
    }
  }

  /// When Relation === 'Spouse', mirror Tab 3's spouse fields into the
  /// co-applicant fields and lock them read-only; any other relation clears
  /// the lock and leaves the fields as the FDO's own entry.
  void onNomineeRelationChanged(String? relation) {
    nomineeRelation.value = relation;
    if (relation == 'Spouse') {
      coApplicantFieldsLockedFromSpouse.value = true;
      _syncSpouseToNomineeIfLocked();
    } else {
      coApplicantFieldsLockedFromSpouse.value = false;
    }
  }

  int? _calculateAge(String dobStr) {
    if (dobStr.isEmpty) return null;
    try {
      final dob = DateFormat('dd-MM-yyyy').parse(dobStr);
      final now = DateTime.now();
      int age = now.year - dob.year;
      if (now.month < dob.month ||
          (now.month == dob.month && now.day < dob.day)) {
        age--;
      }
      return age;
    } catch (e) {
      debugPrint('Error parsing DOB: $e');
      return null;
    }
  }

  Future<String> currentBranchId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('branchId') ?? '';
  }

  Future<void> fetchLocation() async {
    isLocating.value = true;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        Get.snackbar(
          'Location Service Disabled',
          'Please enable GPS to fetch location.',
        );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          Get.snackbar(
            'Permission Denied',
            'Location permissions are required.',
          );
          return;
        }
      }
      if (permission == LocationPermission.deniedForever) {
        Get.snackbar(
          'Permission Denied',
          'Location permissions are permanently denied.',
        );
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );

      latitude.value = position.latitude.toStringAsFixed(6);
      longitude.value = position.longitude.toStringAsFixed(6);
      mapsUrl.value =
          "https://www.google.com/maps/search/?api=1&query=${latitude.value},${longitude.value}";
      Get.snackbar('Success', 'Location fetched successfully.');
      unawaited(generateAndUploadLocationQr());
    } catch (e) {
      Get.snackbar('Error', 'Failed to get location: $e');
    } finally {
      isLocating.value = false;
    }
  }

  @override
  void onClose() {
    dobCtrl.removeListener(_onDobChanged);
    nomineeDateOfBirthCtrl.removeListener(_onNomineeDobChanged);

    mobileNumberCtrl.dispose();
    mobileNumberFocus.dispose();
    otherIdNoCtrl.dispose();
    otherIdNoFocus.dispose();
    clientNameCtrl.dispose();
    lastNameCtrl.dispose();
    pancardNoCtrl.dispose();
    pancardNoFocus.dispose();
    votersIdNoCtrl.dispose();
    votersIdNoFocus.dispose();
    dobCtrl.dispose();
    fatherNameCtrl.dispose();
    permanentAddressCtrl.dispose();
    pincodeCtrl.dispose();
    postOfficeCtrl.dispose();
    stateCtrl.dispose();
    districtCtrl.dispose();
    countryCtrl.dispose();

    emailCtrl.dispose();
    ageCtrl.dispose();
    spouseNameCtrl.dispose();
    spouseDobCtrl.dispose();
    spouseMobileNumberCtrl.dispose();
    noOfChildrenCtrl.dispose();
    monthlyFamilyIncomeCtrl.dispose();
    monthlyFamilyExpenseCtrl.dispose();
    ifscCodeCtrl.dispose();
    bankAcNoCtrl.dispose();
    bankAcNoFocus.dispose();
    retypeBankAcNoCtrl.dispose();
    bankNameCtrl.dispose();
    bankBranchCtrl.dispose();
    motherNameCtrl.dispose();
    smartCardNoCtrl.dispose();

    nomineeNameCtrl.dispose();
    nomineePhoneNumberCtrl.dispose();
    nomineePhoneNumberFocus.dispose();
    nomineeDateOfBirthCtrl.dispose();
    nomineeAgeCtrl.dispose();
    caPancardNoCtrl.dispose();
    caPancardNoFocus.dispose();
    caVoterIdNoCtrl.dispose();
    caVoterIdNoFocus.dispose();
    caOtherIdNoCtrl.dispose();
    caOtherIdNoFocus.dispose();

    super.onClose();
  }
}
