import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Which "slot" an economic-activity-type→activity cascade belongs to — the
/// web app renders this exact cascade 3 independent times (client, spouse,
/// co-applicant), each with its own selection state.
enum EaScope { client, spouse, coApplicant }

/// Remote-lookup state (centers, groups, products, economic activities, ...)
/// + the cascading-dropdown invalidation logic + the enrollment-validation
/// required-field config + identity-uniqueness/IFSC/pincode side effects.
mixin EnrollmentLookupsMixin on GetxController {
  EnrollmentApiService get api;

  // Referenced from the main controller class (all fields declared there).
  Rxn<String> get memberGroupStatus;
  Rxn<String> get requestedCenterId;
  Rxn<String> get requestedGroupId;
  Rxn<String> get economicActivityTypeId;
  Rxn<String> get economicActivityId;
  Rxn<String> get spouseEconomicActivityTypeId;
  Rxn<String> get spouseEconomicActivityId;
  Rxn<String> get coApplicantEconomicActivityTypeId;
  Rxn<String> get coApplicantEconomicActivityId;
  Rxn<String> get requestedLoanProductTypeId;
  Rxn<String> get requestedLoanProductId;
  RxString get requestedLoanFrequency;
  Rxn<String> get requestedLoanPurposeTypeId;
  Rxn<String> get requestedLoanPurposeId;
  Rxn<Map<String, dynamic>> get selectedProduct;
  TextEditingController get pincodeCtrl;
  TextEditingController get postOfficeCtrl;
  TextEditingController get stateCtrl;
  TextEditingController get districtCtrl;
  TextEditingController get ifscCodeCtrl;
  TextEditingController get bankNameCtrl;
  TextEditingController get bankBranchCtrl;
  RxBool get isFetchingIfsc;
  RxBool get ifscLocked;
  RxString get ifscLookupAddress;
  RxList<String> get postOfficeOptions;
  RxBool get isFetchingPincode;
  TextEditingController get mobileNumberCtrl;
  TextEditingController get otherIdNoCtrl;
  TextEditingController get clientNameCtrl;
  TextEditingController get lastNameCtrl;
  RxBool get highmarkConsent;
  Rxn<Map<String, dynamic>> get highmarkReport;
  RxBool get isRunningCreditCheck;
  RxBool get isLoadingLatestReport;

  final approvedCenters = <dynamic>[].obs;
  final groupsForCenter = <dynamic>[].obs;
  final loanProductTypes = <dynamic>[].obs;
  final productsForBranch = <dynamic>[].obs;
  final loanPurposeTypes = <dynamic>[].obs;
  final loanPurposesForType = <dynamic>[].obs;
  final economicActivityTypes = <dynamic>[].obs;
  final economicActivitiesForType = <dynamic>[].obs;
  final spouseEconomicActivitiesForType = <dynamic>[].obs;
  final coApplicantEconomicActivitiesForType = <dynamic>[].obs;
  final RxMap<String, bool> requiredFieldMap = <String, bool>{}.obs;

  static const Map<String, String> _webToMobileFieldKeys = {
    'coApplicantRelation': 'nomineeRelation',
    'coApplicantName': 'nomineeName',
    'coApplicantMobileNumber': 'nomineePhoneNumber',
    'coApplicantGender': 'nomineeGender',
    'coApplicantDob': 'nomineeDateOfBirth',
    'coApplicantAge': 'nomineeAge',
  };

  static const Set<String> _defaultRequiredFields = {
    'mobileNumber',
    'firstName',
    'lastName',
    'otherIdNo',
    'dateOfBirth',
    'gender',
    'permanentAddress',
    'pincode',
    'postOffice',
    'state',
    'district',
    'country',
    'economicActivityTypeId',
    'economicActivityId',
    'maritalStatus',
    'monthlyFamilyIncome',
    'ifscCode',
    'bankAcNo',
    'bankName',
    'requestedCenterId',
    'requestedLoanProductId',
    'nomineeName',
    'nomineePhoneNumber',
    'nomineeRelation',
    'nomineeGender',
    'nomineeDateOfBirth',
  };

  bool isRequired(String fieldKey, {bool? defaultValue}) {
    if (requiredFieldMap.containsKey(fieldKey)) {
      return requiredFieldMap[fieldKey] ?? false;
    }
    for (final entry in _webToMobileFieldKeys.entries) {
      if (entry.value == fieldKey && requiredFieldMap.containsKey(entry.key)) {
        return requiredFieldMap[entry.key] ?? false;
      }
    }
    return defaultValue ?? _defaultRequiredFields.contains(fieldKey);
  }

  Future<void> loadStaticLookups() async {
    await Future.wait([
      _loadApprovedCenters(),
      _loadLoanProductTypes(),
      _loadLoanPurposeTypes(),
      _loadEconomicActivityTypes(),
      _loadRequiredFieldMap(),
    ]);
  }

  Future<void> _loadRequiredFieldMap() async {
    try {
      final rows = await api.getEnrollmentValidationConfig();
      final map = <String, bool>{};
      for (final row in rows) {
        if (row is Map && row['fieldKey'] != null) {
          final k = row['fieldKey'].toString();
          final val = row['isRequired'] == true;
          map[k] = val;
          final mobileKey = _webToMobileFieldKeys[k];
          if (mobileKey != null) {
            map[mobileKey] = val;
          }
        }
      }
      requiredFieldMap.assignAll(map);
    } catch (e) {
      debugPrint('Failed to load enrollment validation config: $e');
    }
  }

  Future<void> _loadApprovedCenters() async {
    try {
      approvedCenters.assignAll(await api.getApprovedCenters());
    } catch (e) {
      debugPrint('Failed to load centers: $e');
    }
  }

  Future<void> _loadLoanProductTypes() async {
    try {
      loanProductTypes.assignAll(await api.getLoanProductTypes());
    } catch (e) {
      debugPrint('Failed to load loan product types: $e');
    }
  }

  Future<void> _loadLoanPurposeTypes() async {
    try {
      loanPurposeTypes.assignAll(await api.getLoanPurposeTypes());
    } catch (e) {
      debugPrint('Failed to load loan purpose types: $e');
    }
  }

  Future<void> _loadEconomicActivityTypes() async {
    try {
      economicActivityTypes.assignAll(await api.getEconomicActivityTypes());
    } catch (e) {
      debugPrint('Failed to load economic activity types: $e');
    }
  }

  /// Centers filtered to zero-client only when starting a brand new center.
  List<dynamic> get filteredCenters {
    if (memberGroupStatus.value != 'NEW_CENTER_NEW_MEMBER') {
      return approvedCenters;
    }
    return approvedCenters
        .where((c) => (c is Map ? (c['clientCount'] ?? 0) : 0) == 0)
        .toList();
  }

  /// Groups filtered to zero-member only when starting a brand new center.
  List<dynamic> get filteredGroups {
    if (memberGroupStatus.value != 'NEW_CENTER_NEW_MEMBER') {
      return groupsForCenter;
    }
    return groupsForCenter
        .where((g) => (g is Map ? (g['memberCount'] ?? 0) : 0) == 0)
        .toList();
  }

  /// Products filtered client-side by the chosen product type + frequency
  /// (the `/api/products` endpoint has no server-side filter for either).
  List<dynamic> get filteredProducts {
    return productsForBranch.where((p) {
      if (p is! Map) return false;
      final typeId =
          p['loanProductTypeId'] ?? (p['loanProductType'] is Map ? p['loanProductType']['id'] : null);
      final matchesType = requestedLoanProductTypeId.value == null ||
          typeId == requestedLoanProductTypeId.value;
      final matchesFrequency = (p['frequency']?.toString().toLowerCase()) ==
          requestedLoanFrequency.value.toLowerCase();
      return matchesType && matchesFrequency;
    }).toList();
  }

  void onMemberGroupStatusChanged(String? status) {
    memberGroupStatus.value = status;
    requestedCenterId.value = null;
    requestedGroupId.value = null;
    groupsForCenter.clear();
  }

  Future<void> onCenterChanged(String? centerId) async {
    requestedCenterId.value = centerId;
    requestedGroupId.value = null;
    groupsForCenter.clear();
    if (centerId == null || centerId.isEmpty) return;
    try {
      groupsForCenter.assignAll(await api.getGroupsForCenter(centerId));
    } catch (e) {
      debugPrint('Failed to load groups for center: $e');
    }
  }

  Future<void> loadProductsForBranch(String branchId) async {
    if (branchId.isEmpty) return;
    try {
      productsForBranch.assignAll(await api.getProducts(branchId));
    } catch (e) {
      debugPrint('Failed to load products: $e');
    }
  }

  void onLoanProductTypeChanged(String? typeId) {
    requestedLoanProductTypeId.value = typeId;
    requestedLoanProductId.value = null;
    selectedProduct.value = null;
  }

  void onLoanProductSelected(String? productId) {
    requestedLoanProductId.value = productId;
    if (productId == null) {
      selectedProduct.value = null;
      return;
    }
    Map<String, dynamic>? match;
    for (final p in filteredProducts) {
      if (p is Map && '${p['id']}' == productId) {
        match = Map<String, dynamic>.from(p);
        break;
      }
    }
    selectedProduct.value = match;
  }

  /// Mirrors `computeTenureMonths` in `ClientEnrollmentForm.tsx` — must stay
  /// numerically identical to the web app's display value.
  int computeTenureMonths(int numberOfDues, String frequency) {
    final freq = frequency.toLowerCase();
    if (freq == 'weekly') return (numberOfDues / 4.33).ceil();
    if (freq == 'biweekly') return (numberOfDues / 2.17).ceil();
    if (freq == 'daily') return (numberOfDues / 30).ceil();
    if (freq == 'quarterly') return numberOfDues * 3;
    return numberOfDues;
  }

  Future<void> onLoanPurposeTypeChanged(String? typeId) async {
    requestedLoanPurposeTypeId.value = typeId;
    requestedLoanPurposeId.value = null;
    loanPurposesForType.clear();
    if (typeId == null || typeId.isEmpty) return;
    try {
      loanPurposesForType.assignAll(await api.getLoanPurposes(typeId));
    } catch (e) {
      debugPrint('Failed to load loan purposes: $e');
    }
  }

  Future<void> onEconomicActivityTypeChanged(
    String? typeId, {
    required EaScope scope,
  }) async {
    switch (scope) {
      case EaScope.client:
        economicActivityTypeId.value = typeId;
        economicActivityId.value = null;
        economicActivitiesForType.clear();
        break;
      case EaScope.spouse:
        spouseEconomicActivityTypeId.value = typeId;
        spouseEconomicActivityId.value = null;
        spouseEconomicActivitiesForType.clear();
        break;
      case EaScope.coApplicant:
        coApplicantEconomicActivityTypeId.value = typeId;
        coApplicantEconomicActivityId.value = null;
        coApplicantEconomicActivitiesForType.clear();
        break;
    }
    if (typeId == null || typeId.isEmpty) return;
    try {
      final activities = await api.getEconomicActivities(typeId);
      switch (scope) {
        case EaScope.client:
          economicActivitiesForType.assignAll(activities);
          break;
        case EaScope.spouse:
          spouseEconomicActivitiesForType.assignAll(activities);
          break;
        case EaScope.coApplicant:
          coApplicantEconomicActivitiesForType.assignAll(activities);
          break;
      }
    } catch (e) {
      debugPrint('Failed to load economic activities: $e');
    }
  }

  Future<void> onPincodeChanged(String pincode) async {
    if (pincode.length != 6) return;
    isFetchingPincode.value = true;
    try {
      final result = await api.lookupPincode(pincode);
      final status = result?['Status']?.toString();
      if (result == null || status != 'Success') {
        postOfficeOptions.clear();
        return;
      }
      final offices = result['PostOffice'];
      if (offices is List && offices.isNotEmpty) {
        postOfficeOptions.assignAll(
          offices.map((o) => (o as Map)['Name'].toString()),
        );
        final first = offices.first as Map;
        postOfficeCtrl.text = first['Name']?.toString() ?? '';
        stateCtrl.text = first['State']?.toString() ?? '';
        districtCtrl.text = first['District']?.toString() ?? '';
      }
    } catch (e) {
      debugPrint('Pincode lookup failed: $e');
    } finally {
      isFetchingPincode.value = false;
    }
  }

  Future<void> onIfscChanged(String rawCode) async {
    final code = rawCode.trim().toUpperCase();
    final isValidFormat = RegExp(r'^[A-Z]{4}0[A-Z0-9]{6}$').hasMatch(code);
    if (!isValidFormat) {
      ifscLocked.value = false;
      ifscLookupAddress.value = '';
      return;
    }
    isFetchingIfsc.value = true;
    try {
      final result = await api.lookupIfsc(code);
      if (result != null) {
        bankNameCtrl.text = result['bankName']?.toString() ?? '';
        bankBranchCtrl.text = result['branchName']?.toString() ?? '';
        ifscLookupAddress.value = result['address']?.toString() ?? '';
        ifscLocked.value = true;
      } else {
        ifscLocked.value = false;
        ifscLookupAddress.value = '';
      }
    } catch (e) {
      ifscLocked.value = false;
      ifscLookupAddress.value = '';
      debugPrint('IFSC lookup failed: $e');
    } finally {
      isFetchingIfsc.value = false;
    }
  }

  Future<void> checkUnique(
    String fieldKey,
    String field,
    String side,
    String value, {
    String? sibling,
  }) async {
    if (value.trim().isEmpty) return;
    try {
      final result = await api.checkIdentityUniqueness(
        field: field,
        value: value.trim(),
        side: side,
        siblingValue: sibling,
      );
      if (result['isDuplicate'] == true) {
        Get.snackbar(
          'Duplicate $fieldKey',
          result['message']?.toString() ?? 'This value is already in use.',
          backgroundColor: Colors.orange,
          colorText: Colors.white,
        );
      }
    } catch (e) {
      debugPrint('Uniqueness check failed for $fieldKey: $e');
    }
  }

  Future<void> loadLatestHighmarkIfAny() async {
    final aadhaar = otherIdNoCtrl.text.trim();
    if (aadhaar.length != 12) return;
    isLoadingLatestReport.value = true;
    try {
      highmarkReport.value = await api.getLatestHighmarkReport(aadhaar);
    } catch (e) {
      debugPrint('Failed to load latest Highmark report: $e');
    } finally {
      isLoadingLatestReport.value = false;
    }
  }

  Future<void> runCreditCheck() async {
    if (!highmarkConsent.value) {
      Get.snackbar(
        'Consent Required',
        'Client consent is required before running a credit check.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }
    final aadhaar = otherIdNoCtrl.text.trim();
    final phone = mobileNumberCtrl.text.trim();
    if (aadhaar.length != 12 || phone.length < 10) {
      Get.snackbar(
        'Missing Details',
        'A valid 12-digit Aadhaar and mobile number are required to run a credit check.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }
    isRunningCreditCheck.value = true;
    try {
      highmarkReport.value = await api.runHighmarkCheck({
        'firstName': clientNameCtrl.text.trim(),
        'lastName': lastNameCtrl.text.trim(),
        'aadhaar': aadhaar,
        'phone': phone,
        'consentObtained': true,
      });
      Get.snackbar(
        'Credit Check Complete',
        'Highmark report retrieved successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        'Credit Check Failed',
        'Failed to run credit check: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isRunningCreditCheck.value = false;
    }
  }
}
