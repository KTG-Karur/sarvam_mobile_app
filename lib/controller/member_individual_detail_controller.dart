import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/member_individual_api_service.dart';

/// Powers one loan's Member Individual detail screen — mirrors
/// `components/loan-module/MemberIndividualDetailPage.tsx`'s Cash Flow, Loan
/// Appraisal and House Hold Visit tabs (GRT stays web-only).
///
/// Deliberately NOT registered with GetX's DI (no `Get.put`/`Get.find`) —
/// it's owned directly by the detail screen's State and scoped to one
/// `loanId`, so a shared singleton would leak state across different loans.
/// Callers must call [loadRecord] after construction and [disposeControllers]
/// from the widget's `dispose()`.
class MemberIndividualDetailController extends GetxController {
  MemberIndividualDetailController(this.loanId, {MemberIndividualApiService? api})
    : api =
          api ??
          MemberIndividualApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          ) {
    for (final c in _expenseControllers) {
      c.addListener(_recalculateTotal);
    }
  }

  final String loanId;
  final MemberIndividualApiService api;

  final isLoading = true.obs;
  final isSavingCashFlow = false.obs;
  final isCompletingAppraisal = false.obs;
  final isUploadingPhoto = false.obs;
  final isCompletingVisit = false.obs;
  final deletingPhotoId = Rxn<String>();

  final Rxn<Map<String, dynamic>> record = Rxn<Map<String, dynamic>>();

  final foodExpenseCtrl = TextEditingController();
  final medicalExpenseCtrl = TextEditingController();
  final cookingFuelExpenseCtrl = TextEditingController();
  final electricityExpenseCtrl = TextEditingController();
  final transportExpenseCtrl = TextEditingController();
  final waterExpenseCtrl = TextEditingController();
  final educationalExpenseCtrl = TextEditingController();
  final monthlyExpenseCtrl = TextEditingController();

  /// Live running total across all 8 fields — mirrors the web's `totalExpense`
  /// badge, recalculated on every keystroke.
  final totalExpense = 0.0.obs;

  List<TextEditingController> get _expenseControllers => [
    foodExpenseCtrl,
    medicalExpenseCtrl,
    cookingFuelExpenseCtrl,
    electricityExpenseCtrl,
    transportExpenseCtrl,
    waterExpenseCtrl,
    educationalExpenseCtrl,
    monthlyExpenseCtrl,
  ];

  void _recalculateTotal() {
    double sum = 0;
    for (final c in _expenseControllers) {
      sum += double.tryParse(c.text.trim()) ?? 0;
    }
    totalExpense.value = sum;
  }

  void disposeControllers() {
    for (final c in _expenseControllers) {
      c.removeListener(_recalculateTotal);
      c.dispose();
    }
  }

  Map<String, dynamic> get _map => record.value ?? const {};
  Map<String, dynamic> _sub(String key) {
    final v = _map[key];
    return v is Map ? Map<String, dynamic>.from(v) : const {};
  }

  Map<String, dynamic> get loan => _sub('loan');
  Map<String, dynamic> get center => _sub('center');
  Map<String, dynamic> get cashFlow => _sub('cashFlow');
  Map<String, dynamic> get loanAppraisal => _sub('loanAppraisal');
  Map<String, dynamic> get houseHoldVisit => _sub('houseHoldVisit');
  Map<String, dynamic> get grt => _sub('grt');

  bool get cashFlowComplete => cashFlow['completedAt'] != null;
  bool get loanAppraisalComplete => loanAppraisal['reviewedAt'] != null;
  bool get houseHoldVisitComplete => houseHoldVisit['completedAt'] != null;
  bool get grtComplete => grt['completedAt'] != null;

  /// Out of the 4 tabs (Cash Flow, Loan Appraisal, House Hold Visit, GRT).
  int get completedTabsCount =>
      [cashFlowComplete, loanAppraisalComplete, houseHoldVisitComplete, grtComplete]
          .where((v) => v)
          .length;

  /// Mirrors the API's top-level `isComplete` (all 3 tabs + a completed GRT
  /// session covering this loan).
  bool get isComplete => _map['isComplete'] == true;

  List<dynamic> get photos {
    final p = houseHoldVisit['photos'];
    return p is List ? p : const [];
  }

  bool get hasMandatoryPhoto => photos.any((p) => p is Map && p['isMandatory'] == true);

  String _fmt(dynamic v) => v == null ? '' : '$v';

  Future<void> loadRecord() async {
    isLoading.value = true;
    try {
      final result = await api.getMemberIndividual(loanId);
      record.value = result;
      final cf = result['cashFlow'];
      if (cf is Map) {
        foodExpenseCtrl.text = _fmt(cf['foodExpense']);
        medicalExpenseCtrl.text = _fmt(cf['medicalExpense']);
        cookingFuelExpenseCtrl.text = _fmt(cf['cookingFuelExpense']);
        electricityExpenseCtrl.text = _fmt(cf['electricityExpense']);
        transportExpenseCtrl.text = _fmt(cf['transportExpense']);
        waterExpenseCtrl.text = _fmt(cf['waterExpense']);
        educationalExpenseCtrl.text = _fmt(cf['educationalExpense']);
        monthlyExpenseCtrl.text = _fmt(cf['monthlyExpense']);
        _recalculateTotal();
      }
    } catch (e) {
      debugPrint('Failed to load Member Individual record: $e');
      Get.snackbar(
        'Error',
        'Failed to load this loan\'s Member Individual record: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> saveCashFlow() async {
    double parse(TextEditingController c) => double.tryParse(c.text.trim()) ?? 0;
    isSavingCashFlow.value = true;
    try {
      await api.saveCashFlow(loanId, {
        'foodExpense': parse(foodExpenseCtrl),
        'medicalExpense': parse(medicalExpenseCtrl),
        'cookingFuelExpense': parse(cookingFuelExpenseCtrl),
        'electricityExpense': parse(electricityExpenseCtrl),
        'transportExpense': parse(transportExpenseCtrl),
        'waterExpense': parse(waterExpenseCtrl),
        'educationalExpense': parse(educationalExpenseCtrl),
        'monthlyExpense': parse(monthlyExpenseCtrl),
      });
      Get.snackbar(
        'Saved',
        'Cash Flow saved successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to save Cash Flow: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isSavingCashFlow.value = false;
    }
  }

  Future<bool> markLoanAppraisalReviewed() async {
    isCompletingAppraisal.value = true;
    try {
      await api.completeLoanAppraisal(loanId);
      Get.snackbar(
        'Saved',
        'Loan Appraisal marked reviewed.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to mark Loan Appraisal reviewed: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isCompletingAppraisal.value = false;
    }
  }

  Map<String, dynamic> get branch => _sub('branch');

  final isLoadingProductData = false.obs;
  final isUpdatingProduct = false.obs;
  final productTypes = <dynamic>[].obs;
  final allProducts = <dynamic>[].obs;

  Future<void> fetchProductEditData() async {
    final branchId = _fmt(branch['id']).isNotEmpty
        ? _fmt(branch['id'])
        : (_fmt(center['branchId']).isNotEmpty
            ? _fmt(center['branchId'])
            : _fmt(loan['branchId']));

    if (branchId.isEmpty) return;

    isLoadingProductData.value = true;
    try {
      final types = await api.getLoanProductTypes();
      final prods = await api.getProductsForBranch(branchId);
      productTypes.assignAll(types);
      allProducts.assignAll(prods);
    } catch (e) {
      debugPrint('Failed to load product edit data: $e');
    } finally {
      isLoadingProductData.value = false;
    }
  }

  Future<bool> updateLoanProduct(String newProductId) async {
    isUpdatingProduct.value = true;
    try {
      final isIndexed =
          loan['indexId'] != null ||
          loan['disbursementStatus'] == 'PENDING_LEVEL2';
      await api.updateLoanProduct(
        loanId,
        loanProductId: newProductId,
        isIndexed: isIndexed,
        stage: 'MEMBER_INDIVIDUAL',
      );
      Get.snackbar(
        'Product Updated',
        'Loan product updated successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to update loan product: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isUpdatingProduct.value = false;
    }
  }

  /// Captures a photo (camera or gallery) with the device's current GPS
  /// location and uploads it. [isMandatory] must be true exactly once per
  /// loan — that's the photo the backend validates against the center
  /// (500m) and the client's enrolled location (100m) before allowing
  /// [markHouseholdVisitComplete].
  Future<void> captureAndUploadPhoto({
    required bool isMandatory,
    required bool useCamera,
  }) async {
    isUploadingPhoto.value = true;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        Get.snackbar(
          'Location Service Disabled',
          'Please enable GPS to capture the visit location.',
        );
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          Get.snackbar('Permission Denied', 'Location permission is required.');
          return;
        }
      }
      if (permission == LocationPermission.deniedForever) {
        Get.snackbar(
          'Permission Denied',
          'Location permission is permanently denied. Enable it from app settings.',
        );
        return;
      }

      final picked = await ImagePicker().pickImage(
        source: useCamera ? ImageSource.camera : ImageSource.gallery,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 80,
      );
      if (picked == null) return;

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      final bytes = await picked.readAsBytes();

      await api.uploadHouseholdVisitPhoto(
        loanId,
        bytes: bytes,
        filename: picked.name,
        contentType: 'image/jpeg',
        isMandatory: isMandatory,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracy: position.accuracy,
      );

      Get.snackbar(
        'Uploaded',
        'Photo uploaded successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to upload photo: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isUploadingPhoto.value = false;
    }
  }

  Future<void> deletePhoto(String photoId) async {
    deletingPhotoId.value = photoId;
    try {
      await api.deleteHouseholdVisitPhoto(loanId, photoId);
      Get.snackbar(
        'Removed',
        'Photo removed.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to remove photo: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      deletingPhotoId.value = null;
    }
  }

  Future<bool> markHouseholdVisitComplete() async {
    isCompletingVisit.value = true;
    try {
      await api.completeHouseholdVisit(loanId);
      Get.snackbar(
        'Saved',
        'House Hold Visit marked complete.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await loadRecord();
      return true;
    } catch (e) {
      Get.snackbar(
        'Cannot Complete',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isCompletingVisit.value = false;
    }
  }
}
