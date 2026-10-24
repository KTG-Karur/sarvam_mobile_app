import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_uploads.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_lookups.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

class MemberUpdateController extends GetxController
    with EnrollmentUploadsMixin, EnrollmentLookupsMixin {
  @override
  final EnrollmentApiService api = EnrollmentApiService(ApiClient());
  
  final String clientId;
  MemberUpdateController({required this.clientId});

  final currentStep = 0.obs;
  final isLoading = true.obs;
  final loadingMessage = 'Fetching client data...'.obs;

  // Form Fields (reusing names from ClientEnrollmentController for consistency)
  
  // Tab 1: Member Details
  @override
  final mobileNumberCtrl = TextEditingController();
  @override
  final otherIdNoCtrl = TextEditingController(); // Aadhaar
  @override
  final clientNameCtrl = TextEditingController(); // First Name
  @override
  final lastNameCtrl = TextEditingController();
  final pancardNoCtrl = TextEditingController();
  final votersIdNoCtrl = TextEditingController();
  final dobCtrl = TextEditingController();
  final fatherNameCtrl = TextEditingController();
  final gender = Rxn<String>();
  final permanentAddressCtrl = TextEditingController();
  @override
  final pincodeCtrl = TextEditingController();
  @override
  final postOfficeCtrl = TextEditingController();
  @override
  final stateCtrl = TextEditingController();
  @override
  final districtCtrl = TextEditingController();
  final countryCtrl = TextEditingController(text: 'India');
  
  // Tab 2: Other Details
  final emailCtrl = TextEditingController();
  final ageCtrl = TextEditingController();
  final caste = Rxn<String>();
  final community = Rxn<String>();
  @override
  final economicActivityTypeId = Rxn<String>();
  @override
  final economicActivityId = Rxn<String>();
  final religion = Rxn<String>();
  final qualification = Rxn<String>();
  final maritalStatus = Rxn<String>();
  final spouseNameCtrl = TextEditingController();
  final spouseDobCtrl = TextEditingController();
  final spouseMobileNumberCtrl = TextEditingController();
  final spouseGender = Rxn<String>();
  @override
  final spouseEconomicActivityTypeId = Rxn<String>();
  @override
  final spouseEconomicActivityId = Rxn<String>();
  final noOfChildrenCtrl = TextEditingController();
  final monthlyFamilyIncomeCtrl = TextEditingController();
  final monthlyFamilyExpenseCtrl = TextEditingController();
  @override
  final ifscCodeCtrl = TextEditingController();
  final bankAcNoCtrl = TextEditingController();
  final retypeBankAcNoCtrl = TextEditingController();
  @override
  final bankNameCtrl = TextEditingController();
  @override
  final bankBranchCtrl = TextEditingController();
  final bankAccountType = Rxn<String>();
  final houseStatus = Rxn<String>();
  final motherNameCtrl = TextEditingController();
  final smartCardNoCtrl = TextEditingController();
  
  // Tab 3: Co-Applicant
  final nomineeRelation = Rxn<String>();
  final nomineeNameCtrl = TextEditingController();
  final nomineePhoneNumberCtrl = TextEditingController();
  final nomineeGender = Rxn<String>();
  final nomineeDateOfBirthCtrl = TextEditingController();
  final nomineeAgeCtrl = TextEditingController();
  @override
  final coApplicantEconomicActivityTypeId = Rxn<String>();
  @override
  final coApplicantEconomicActivityId = Rxn<String>();
  final caPancardNoCtrl = TextEditingController();
  final caVoterIdNoCtrl = TextEditingController();
  final caOtherIdNoCtrl = TextEditingController();
  
  // Tab 4: Loan Details
  @override
  final requestedLoanProductTypeId = Rxn<String>();
  @override
  final requestedLoanProductId = Rxn<String>();
  @override
  final requestedLoanFrequency = 'weekly'.obs;
  @override
  final requestedLoanPurposeTypeId = Rxn<String>();
  @override
  final requestedLoanPurposeId = Rxn<String>();
  final requestedLoanAmountCtrl = TextEditingController();
  
  String? _clientDbId;
  final ongoingLoans = <dynamic>[].obs;
  final isLoadingOngoingLoans = false.obs;
  
  // Tab 5: KYC Documents
  @override
  final latitude = ''.obs;
  @override
  final longitude = ''.obs;
  @override
  final mapsUrl = ''.obs;
  final isLocating = false.obs;
  
  @override
  final memberGroupStatus = Rxn<String>();
  @override
  final requestedCenterId = Rxn<String>();
  @override
  final requestedGroupId = Rxn<String>();
  final centerName = Rxn<String>();
  final centerCode = Rxn<String>();
  @override
  final selectedProduct = Rxn<Map<String, dynamic>>();
  @override
  final isFetchingIfsc = false.obs;
  @override
  final ifscLocked = false.obs;
  @override
  final ifscLookupAddress = ''.obs;
  @override
  final postOfficeOptions = <String>[].obs;
  @override
  final isFetchingPincode = false.obs;
  @override
  final highmarkConsent = false.obs;
  @override
  final highmarkReport = Rxn<Map<String, dynamic>>();
  @override
  final isRunningCreditCheck = false.obs;
  @override
  final isLoadingLatestReport = false.obs;

  @override
  Future<void> pickAndUploadDocument(
    String documentType, {
    required String owner,
    bool allowPdf = false,
    ImageSource? source,
    String? clientId,
    bool forceStandardUpload = false,
  }) {
    // Member Update always uses standard upload for replacements to match web parity,
    // unless the document specifically requires a retake (handled via reupload endpoint).
    final isRetake = kycDocuments[documentType]?.isRetakeRequired ?? false;

    return super.pickAndUploadDocument(
      documentType,
      owner: owner,
      allowPdf: allowPdf,
      source: source,
      clientId: clientId ?? this.clientId,
      forceStandardUpload: !isRetake,
    );
  }

  @override
  Future<String> currentBranchId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('branchId') ?? '';
  }

  @override
  void onInit() {
    super.onInit();
    loadStaticLookups();
    _initData();
    dobCtrl.addListener(_onDobChanged);
    nomineeDateOfBirthCtrl.addListener(_onNomineeDobChanged);
  }

  Future<void> _initData() async {
    await loadClientData();
    _setupListeners();
  }

  void _setupListeners() {
    ifscCodeCtrl.addListener(() => onIfscChanged(ifscCodeCtrl.text));
    pincodeCtrl.addListener(() {
      if (pincodeCtrl.text.length == 6) onPincodeChanged(pincodeCtrl.text);
    });

    ever(economicActivityTypeId, (id) {
      if (id != null) onEconomicActivityTypeChanged(id, scope: EaScope.client);
    });
    ever(spouseEconomicActivityTypeId, (id) {
      if (id != null) onEconomicActivityTypeChanged(id, scope: EaScope.spouse);
    });
    ever(coApplicantEconomicActivityTypeId, (id) {
      if (id != null) onEconomicActivityTypeChanged(id, scope: EaScope.coApplicant);
    });
  }

  void _onDobChanged() {
    if (dobCtrl.text.isEmpty) {
      ageCtrl.text = '';
      return;
    }
    try {
      final dob = DateFormat('dd-MM-yyyy').parse(dobCtrl.text);
      final age = DateTime.now().year - dob.year;
      ageCtrl.text = age.toString();
    } catch (_) {}
  }

  void _onNomineeDobChanged() {
    if (nomineeDateOfBirthCtrl.text.isEmpty) {
      nomineeAgeCtrl.text = '';
      return;
    }
    try {
      final dob = DateFormat('dd-MM-yyyy').parse(nomineeDateOfBirthCtrl.text);
      final age = DateTime.now().year - dob.year;
      nomineeAgeCtrl.text = age.toString();
    } catch (_) {}
  }
  
  Future<void> fetchLocation() async {
    isLocating.value = true;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        Get.snackbar('Location Service Disabled', 'Please enable GPS to fetch location.');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          Get.snackbar('Permission Denied', 'Location permissions are required.');
          return;
        }
      }
      if (permission == LocationPermission.deniedForever) {
        Get.snackbar('Permission Denied', 'Location permissions are permanently denied.');
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );

      latitude.value = position.latitude.toStringAsFixed(6);
      longitude.value = position.longitude.toStringAsFixed(6);
      mapsUrl.value = "https://www.google.com/maps/search/?api=1&query=${latitude.value},${longitude.value}";
      Get.snackbar('Success', 'Location fetched successfully.');
      unawaited(generateAndUploadLocationQr());
    } catch (e) {
      Get.snackbar('Error', 'Failed to get location: $e');
    } finally {
      isLocating.value = false;
    }
  }

  Future<void> loadClientData() async {
    loadingMessage.value = 'Fetching client data...';
    isLoading.value = true;
    try {
      final data = await api.getClientDetail(clientId);
      if (data != null) {
        await populateFields(data);
        
        // Following web way: fetch all KYC documents separately
        final kycDocs = await api.getKycDocuments(clientId);
        _mapKycDocuments(kycDocs);
      }
    } catch (e) {
      debugPrint("Exception in loadClientData: $e");
      Get.snackbar('Error', 'Failed to load client details: $e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> populateFields(Map<String, dynamic> data) async {
    // Tab 1: Member Details
    clientNameCtrl.text = data['firstName'] ?? '';
    lastNameCtrl.text = data['lastName'] ?? '';
    mobileNumberCtrl.text = data['mobileNumber'] ?? '';
    otherIdNoCtrl.text = data['otherIdNo'] ?? '';
    pancardNoCtrl.text = data['pancardNo'] ?? '';
    votersIdNoCtrl.text = data['votersIdNo'] ?? '';
    if (data['dateOfBirth'] != null) {
      try {
        final dt = DateTime.parse(data['dateOfBirth']);
        dobCtrl.text = DateFormat('dd-MM-yyyy').format(dt);
      } catch (_) {
        dobCtrl.text = data['dateOfBirth'].toString();
      }
    }
    fatherNameCtrl.text = data['fatherName'] ?? '';
    motherNameCtrl.text = data['motherName'] ?? '';
    gender.value = data['gender'];
    permanentAddressCtrl.text = data['permanentAddress'] ?? '';
    pincodeCtrl.text = data['pincode'] ?? '';
    postOfficeCtrl.text = data['postOffice'] ?? '';
    stateCtrl.text = data['state'] ?? '';
    districtCtrl.text = data['district'] ?? '';
    countryCtrl.text = data['country'] ?? 'India';

    // Tab 2: Other Details
    emailCtrl.text = data['email'] ?? '';
    ageCtrl.text = data['age']?.toString() ?? '';
    caste.value = data['caste'];
    community.value = data['community'];
    religion.value = data['religion'];
    qualification.value = data['qualification'];
    maritalStatus.value = data['maritalStatus'];
    
    economicActivityTypeId.value = data['economicActivityTypeId'];
    if (economicActivityTypeId.value != null) {
      try {
        final list = await api.getEconomicActivities(economicActivityTypeId.value!);
        economicActivitiesForType.assignAll(list);
      } catch (_) {}
    }
    economicActivityId.value = data['economicActivityId'];

    spouseNameCtrl.text = data['spouseName'] ?? '';
    if (data['spouseDob'] != null) {
      try {
        final dt = DateTime.parse(data['spouseDob']);
        spouseDobCtrl.text = DateFormat('dd-MM-yyyy').format(dt);
      } catch (_) {
        spouseDobCtrl.text = data['spouseDob'].toString();
      }
    }
    spouseMobileNumberCtrl.text = data['spouseMobileNumber'] ?? '';
    spouseGender.value = data['spouseGender'];
    
    spouseEconomicActivityTypeId.value = data['spouseEconomicActivityTypeId'];
    if (spouseEconomicActivityTypeId.value != null) {
      try {
        final list = await api.getEconomicActivities(spouseEconomicActivityTypeId.value!);
        spouseEconomicActivitiesForType.assignAll(list);
      } catch (_) {}
    }
    spouseEconomicActivityId.value = data['spouseEconomicActivityId'];

    noOfChildrenCtrl.text = data['noOfChildren']?.toString() ?? '';
    monthlyFamilyIncomeCtrl.text = data['monthlyFamilyIncome']?.toString() ?? '';
    monthlyFamilyExpenseCtrl.text = data['monthlyFamilyExpense']?.toString() ?? '';
    houseStatus.value = data['houseStatus'];
    smartCardNoCtrl.text = data['smartCardNo'] ?? '';

    ifscCodeCtrl.text = data['ifscCode'] ?? '';
    bankAcNoCtrl.text = data['bankAcNo'] ?? '';
    retypeBankAcNoCtrl.text = data['bankAcNo'] ?? '';
    bankNameCtrl.text = data['bankName'] ?? '';
    bankBranchCtrl.text = data['bankBranch'] ?? '';
    bankAccountType.value = data['bankAccountType'];

    // Tab 3: Co-Applicant
    final coApp = data['coApplicant'];
    if (coApp != null) {
      nomineeNameCtrl.text = coApp['name'] ?? '';
      nomineeRelation.value = coApp['relationWithClient'];
      nomineePhoneNumberCtrl.text = coApp['mobileNumber'] ?? '';
      nomineeGender.value = coApp['gender'];
      if (coApp['dateOfBirth'] != null) {
        try {
          final dt = DateTime.parse(coApp['dateOfBirth']);
          nomineeDateOfBirthCtrl.text = DateFormat('dd-MM-yyyy').format(dt);
        } catch (_) {
          nomineeDateOfBirthCtrl.text = coApp['dateOfBirth'].toString();
        }
      }
      nomineeAgeCtrl.text = coApp['age']?.toString() ?? '';
      
      coApplicantEconomicActivityTypeId.value = coApp['economicActivityTypeId'];
      if (coApplicantEconomicActivityTypeId.value != null) {
        try {
          final list = await api.getEconomicActivities(coApplicantEconomicActivityTypeId.value!);
          coApplicantEconomicActivitiesForType.assignAll(list);
        } catch (_) {}
      }
      coApplicantEconomicActivityId.value = coApp['economicActivityId'];

      caPancardNoCtrl.text = coApp['pancardNo'] ?? '';
      caVoterIdNoCtrl.text = coApp['voterIdNo'] ?? '';
      caOtherIdNoCtrl.text = coApp['otherIdNo'] ?? '';
    }

    // Tab 4: Loan Details
    requestedLoanProductTypeId.value = data['requestedLoanProductTypeId'];
    requestedLoanProductId.value = data['requestedLoanProductId'];
    requestedLoanFrequency.value = data['requestedLoanFrequency'] ?? 'weekly';
    requestedLoanPurposeTypeId.value = data['requestedLoanPurposeTypeId'];
    requestedLoanPurposeId.value = data['requestedLoanPurposeId'];
    requestedLoanAmountCtrl.text = data['requestedLoanAmount']?.toString() ?? '';

    // Member Group Status
    memberGroupStatus.value = data['centerId'] != null ? 'EXISTING_CENTER_NEW_MEMBER' : null;
    requestedCenterId.value = data['centerId'];
    requestedGroupId.value = data['groupId'];
    centerName.value = data['center']?['name'];
    centerCode.value = data['center']?['code']?.toString();

    // Fetch Ongoing Loans using DB ID
    _clientDbId = data['id'];
    if (_clientDbId != null) {
      unawaited(fetchOngoingLoans());
    }

    // Tab 5: KYC Documents
    latitude.value = data['latitude']?.toString() ?? '';
    longitude.value = data['longitude']?.toString() ?? '';
    if (latitude.value.isNotEmpty && longitude.value.isNotEmpty) {
      mapsUrl.value = "https://www.google.com/maps/search/?api=1&query=${latitude.value},${longitude.value}";
    }

    final kycList = data['kycDocuments'];
    if (kycList is List) {
      _mapKycDocuments(kycList);
    }
  }

  void _mapKycDocuments(List<dynamic> kycList) {
    debugPrint('MEMBER_UPDATE_DEBUG: Mapping ${kycList.length} documents.');
    for (final doc in kycList) {
      final type = doc['documentType']?.toString();
      if (type != null) {
        debugPrint('MEMBER_UPDATE_DEBUG: Processing document $type. Raw fileUrl: ${doc['fileUrl']}');
        // Flatten review decisions: if any stage (BM, AM) requires retake, flag it.
        String? decision;
        String? remark;
        if (doc['bmDecision'] == 'RETAKE_REQUIRED' || doc['amDecision'] == 'RETAKE_REQUIRED') {
          decision = 'RETAKE_REQUIRED';
          remark = doc['bmRemark'] ?? doc['amRemark'];
        }

        kycDocuments[type] = EnrollmentDocState(
          id: doc['id']?.toString(),
          fileUrl: doc['fileUrl'],
          fileName: doc['fileName'],
          fileSize: doc['fileSize'] is int ? doc['fileSize'] : int.tryParse('${doc['fileSize']}'),
          mimeType: doc['mimeType'],
          reviewDecision: decision,
          reviewRemark: remark,
        );
      }
    }
  }
  
  Future<void> fetchOngoingLoans() async {
    if (_clientDbId == null) return;
    isLoadingOngoingLoans.value = true;
    try {
      final list = await api.getLoans(_clientDbId!);
      ongoingLoans.assignAll(list);
    } catch (e) {
      debugPrint("Error fetching ongoing loans: $e");
    } finally {
      isLoadingOngoingLoans.value = false;
    }
  }

  @override
  void removeDocument(String documentType) async {
    final state = kycDocuments[documentType];
    if (state?.id != null) {
      try {
        Get.dialog(
          const Center(child: CircularProgressIndicator(color: Color(0xFF00843D))),
          barrierDismissible: false,
        );
        await api.deleteKycDocument(clientId: clientId, documentId: state!.id!);
        Get.back();
      } catch (e) {
        Get.back();
        Get.snackbar('Error', 'Failed to delete document: $e');
        return;
      }
    }
    super.removeDocument(documentType);
  }

  static const Map<String, String> _allDocLabels = {
    EnrollmentOptions.docClientPhoto: 'Member / Client Photo',
    EnrollmentOptions.docAadhaarFront: 'Aadhaar Front',
    EnrollmentOptions.docAadhaarBack: 'Aadhaar Back',
    EnrollmentOptions.docPanCard: 'PAN Card',
    EnrollmentOptions.docVoterId: 'Voter ID Front',
    EnrollmentOptions.docVoterIdBack: 'Voter ID Back',
    EnrollmentOptions.docBankPassbook: 'Bank Passbook',
    EnrollmentOptions.docSmartCardFront: 'Smart Card Front',
    EnrollmentOptions.docSmartCardBack: 'Smart Card Back',
    EnrollmentOptions.docCoApplicantPhoto: 'Co-Applicant Photo',
    EnrollmentOptions.docCoApplicantAadhaarFront: 'Co-Applicant Aadhaar Front',
    EnrollmentOptions.docCoApplicantAadhaarBack: 'Co-Applicant Aadhaar Back',
    EnrollmentOptions.docCoApplicantPanCard: 'Co-Applicant PAN Card',
    EnrollmentOptions.docCoApplicantVoterId: 'Co-Applicant Voter ID Front',
    EnrollmentOptions.docCoApplicantVoterIdBack: 'Co-Applicant Voter ID Back',
    EnrollmentOptions.docCoApplicantOtherIdFront: 'Co-Applicant Other ID Front',
    EnrollmentOptions.docCoApplicantOtherIdBack: 'Co-Applicant Other ID Back',
    EnrollmentOptions.docHouseImage1: 'House Image 1',
    EnrollmentOptions.docHouseImage2: 'House Image 2',
    EnrollmentOptions.docHouseImage3: 'House Image 3',
    EnrollmentOptions.docGasBill: 'NOC (Gas Bill)',
    EnrollmentOptions.docNocImage1: 'NOC Image 1',
    EnrollmentOptions.docNocImage2: 'NOC Image 2',
    EnrollmentOptions.docNocImage3: 'NOC Image 3',
    EnrollmentOptions.docLocationQr: 'Location QR',
  };

  Future<void> submitUpdate() async {
    loadingMessage.value = 'Updating member details...';
    isLoading.value = true;
    try {
      // Tab 5: Location Validation
      if (latitude.value.isEmpty || longitude.value.isEmpty) {
        throw 'Latitude and Longitude are mandatory. Please use "Use Current Location".';
      }

      // KYC Documents Validation
      final mandatoryDocs = [
        EnrollmentOptions.docClientPhoto,
        EnrollmentOptions.docAadhaarFront,
        EnrollmentOptions.docAadhaarBack,
        EnrollmentOptions.docVoterId,
        EnrollmentOptions.docVoterIdBack,
        EnrollmentOptions.docBankPassbook,
        EnrollmentOptions.docSmartCardFront,
        EnrollmentOptions.docSmartCardBack,
        EnrollmentOptions.docCoApplicantPhoto,
        EnrollmentOptions.docCoApplicantAadhaarFront,
        EnrollmentOptions.docCoApplicantAadhaarBack,
        EnrollmentOptions.docCoApplicantVoterId,
        EnrollmentOptions.docCoApplicantVoterIdBack,
        EnrollmentOptions.docCoApplicantOtherIdFront,
        EnrollmentOptions.docCoApplicantOtherIdBack,
        EnrollmentOptions.docHouseImage1,
        EnrollmentOptions.docGasBill, // NOC (Gas Bill)
        EnrollmentOptions.docLocationQr,
      ];

      for (final docType in mandatoryDocs) {
        if (kycDocuments[docType]?.isUploaded != true) {
          throw 'Required document missing: ${_allDocLabels[docType] ?? docType}';
        }
      }

      final body = <String, dynamic>{
        // Tab 1: Member Details
        'firstName': clientNameCtrl.text,
        'lastName': lastNameCtrl.text,
        'mobileNumber': mobileNumberCtrl.text,
        if (otherIdNoCtrl.text.isNotEmpty) 'otherIdNo': otherIdNoCtrl.text,
        if (pancardNoCtrl.text.isNotEmpty) 'pancardNo': pancardNoCtrl.text,
        if (votersIdNoCtrl.text.isNotEmpty) 'votersIdNo': votersIdNoCtrl.text,
        if (dobCtrl.text.isNotEmpty)
          'dateOfBirth': DateFormat('yyyy-MM-dd').format(DateFormat('dd-MM-yyyy').parse(dobCtrl.text)),
        'fatherName': fatherNameCtrl.text,
        if (motherNameCtrl.text.isNotEmpty) 'motherName': motherNameCtrl.text,
        if (gender.value != null) 'gender': gender.value,
        'permanentAddress': permanentAddressCtrl.text,
        'pincode': pincodeCtrl.text,
        if (postOfficeCtrl.text.isNotEmpty) 'postOffice': postOfficeCtrl.text,
        if (stateCtrl.text.isNotEmpty) 'state': stateCtrl.text,
        if (districtCtrl.text.isNotEmpty) 'district': districtCtrl.text,
        'country': countryCtrl.text,

        // Tab 2: Other Details
        if (emailCtrl.text.isNotEmpty) 'email': emailCtrl.text,
        if (ageCtrl.text.isNotEmpty) 'age': int.tryParse(ageCtrl.text),
        if (caste.value != null) 'caste': caste.value,
        if (community.value != null) 'community': community.value,
        if (religion.value != null) 'religion': religion.value,
        if (qualification.value != null) 'qualification': qualification.value,
        if (maritalStatus.value != null) 'maritalStatus': maritalStatus.value,
        if (economicActivityTypeId.value != null) 'economicActivityTypeId': economicActivityTypeId.value,
        if (economicActivityId.value != null) 'economicActivityId': economicActivityId.value,

        if (spouseNameCtrl.text.isNotEmpty) 'spouseName': spouseNameCtrl.text,
        if (spouseDobCtrl.text.isNotEmpty)
          'spouseDob': DateFormat('yyyy-MM-dd').format(DateFormat('dd-MM-yyyy').parse(spouseDobCtrl.text)),
        if (spouseMobileNumberCtrl.text.isNotEmpty) 'spouseMobileNumber': spouseMobileNumberCtrl.text,
        if (spouseGender.value != null) 'spouseGender': spouseGender.value,
        if (spouseEconomicActivityTypeId.value != null)
          'spouseEconomicActivityTypeId': spouseEconomicActivityTypeId.value,
        if (spouseEconomicActivityId.value != null) 'spouseEconomicActivityId': spouseEconomicActivityId.value,

        if (noOfChildrenCtrl.text.isNotEmpty) 'noOfChildren': int.tryParse(noOfChildrenCtrl.text),
        if (monthlyFamilyIncomeCtrl.text.isNotEmpty)
          'monthlyFamilyIncome': int.tryParse(monthlyFamilyIncomeCtrl.text),
        if (monthlyFamilyExpenseCtrl.text.isNotEmpty)
          'monthlyFamilyExpense': int.tryParse(monthlyFamilyExpenseCtrl.text),
        if (houseStatus.value != null) 'houseStatus': houseStatus.value,
        if (smartCardNoCtrl.text.isNotEmpty) 'smartCardNo': smartCardNoCtrl.text,

        'bankName': bankNameCtrl.text,
        'bankBranch': bankBranchCtrl.text,
        'bankIFSC': ifscCodeCtrl.text,
        'bankAcNo': bankAcNoCtrl.text,
        if (bankAccountType.value != null) 'bankAccountType': bankAccountType.value,

        // Tab 3: Co-Applicant
        if (nomineeNameCtrl.text.isNotEmpty)
          'coApplicant': {
            'name': nomineeNameCtrl.text,
            if (nomineeRelation.value != null) 'relationWithClient': nomineeRelation.value,
            if (nomineePhoneNumberCtrl.text.isNotEmpty) 'mobileNumber': nomineePhoneNumberCtrl.text,
            if (nomineeGender.value != null) 'gender': nomineeGender.value,
            if (nomineeDateOfBirthCtrl.text.isNotEmpty)
              'dateOfBirth':
                  DateFormat('yyyy-MM-dd').format(DateFormat('dd-MM-yyyy').parse(nomineeDateOfBirthCtrl.text)),
            if (nomineeAgeCtrl.text.isNotEmpty) 'age': int.tryParse(nomineeAgeCtrl.text),
            if (coApplicantEconomicActivityTypeId.value != null)
              'economicActivityTypeId': coApplicantEconomicActivityTypeId.value,
            if (coApplicantEconomicActivityId.value != null)
              'economicActivityId': coApplicantEconomicActivityId.value,
            if (caPancardNoCtrl.text.isNotEmpty) 'pancardNo': caPancardNoCtrl.text,
            if (caVoterIdNoCtrl.text.isNotEmpty) 'voterIdNo': caVoterIdNoCtrl.text,
            if (caOtherIdNoCtrl.text.isNotEmpty) 'otherIdNo': caOtherIdNoCtrl.text,
          },

        // Tab 4: Loan Details - New Loan Request removed per requirements

        // Tab 5: Location
        'latitude': latitude.value,
        'longitude': longitude.value,

        // KYC Documents
        'kycDocuments': kycDocuments.entries.where((e) => e.value.isUploaded).map((e) => {
              if (e.value.id != null) 'id': e.value.id,
              'documentType': e.key,
              'fileUrl': e.value.fileUrl,
              'fileName': e.value.fileName,
              'fileSize': e.value.fileSize,
              'mimeType': e.value.mimeType,
            }).toList(),
      };

      await api.patchClientDetail(clientId, body, restartApprovalOnEdit: true);

      Get.back();
      Get.snackbar('Success', 'Member details updated successfully');
    } catch (e) {
      Get.snackbar('Error', 'Failed to update member: $e');
    } finally {
      isLoading.value = false;
    }
  }

  @override
  void onClose() {
    mobileNumberCtrl.dispose();
    otherIdNoCtrl.dispose();
    clientNameCtrl.dispose();
    lastNameCtrl.dispose();
    pancardNoCtrl.dispose();
    votersIdNoCtrl.dispose();
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
    retypeBankAcNoCtrl.dispose();
    bankNameCtrl.dispose();
    bankBranchCtrl.dispose();
    motherNameCtrl.dispose();
    smartCardNoCtrl.dispose();
    nomineeNameCtrl.dispose();
    nomineePhoneNumberCtrl.dispose();
    nomineeDateOfBirthCtrl.dispose();
    nomineeAgeCtrl.dispose();
    caPancardNoCtrl.dispose();
    caVoterIdNoCtrl.dispose();
    caOtherIdNoCtrl.dispose();
    requestedLoanAmountCtrl.dispose();
    super.onClose();
  }
}
