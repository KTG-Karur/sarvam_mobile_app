import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/loan_api_service.dart';

/// Powers the Renewal Loan Application screen (FDO) — mirrors the field
/// cascade, eligibility gating, and submit payload of the web app's
/// `components/loan-module/ApplicationForm.tsx`.
class RenewalLoanController extends GetxController {
  RenewalLoanController({LoanApiService? api})
    : api =
          api ??
          LoanApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          );

  final LoanApiService api;

  // Document charges are 1% of the loan amount — matches LOAN_FEES on web
  // (app/lib/config.ts). Insurance fee comes straight from the product.
  static const double _documentChargesPercent = 1;

  final isLoadingData = true.obs;
  final isSubmitting = false.obs;
  final isLoadingClients = false.obs;
  final isLoadingProducts = false.obs;
  final isLoadingLoans = false.obs;
  final isLoadingCoApplicants = false.obs;
  final isDeletingLoanId = Rxn<String>();

  final centers = <dynamic>[].obs;
  final eligibleClients = <dynamic>[].obs;
  final unindexedLoans = <dynamic>[].obs;
  final loanProductTypes = <dynamic>[].obs;
  final productsForBranch = <dynamic>[].obs;
  final purposeTypes = <dynamic>[].obs;
  final purposesForType = <dynamic>[].obs;
  final eligibleCoApplicants = <dynamic>[].obs;
  final ongoingLoans = <dynamic>[].obs;

  final Rxn<String> centerId = Rxn<String>();
  final Rxn<String> clientId = Rxn<String>();
  final Rxn<String> coApplicantId = Rxn<String>();
  final Rxn<String> productTypeId = Rxn<String>();
  final Rxn<String> productId = Rxn<String>();
  final RxString frequency = 'weekly'.obs;
  final Rxn<String> purposeTypeId = Rxn<String>();
  final Rxn<String> purposeId = Rxn<String>();
  final Rxn<Map<String, dynamic>> selectedProduct = Rxn<Map<String, dynamic>>();
  final ongoingLoanAcknowledged = false.obs;
  final showOngoingLoanModal = false.obs;

  /// Which wizard step (0-indexed) is showing. Steps: Center & Member,
  /// Loan Product, Purpose & Charges, Review & Submit.
  final currentStep = 0.obs;

  final amountCtrl = TextEditingController();
  final interestRateCtrl = TextEditingController();
  final tenureCtrl = TextEditingController();
  final documentChargesCtrl = TextEditingController();
  final insuranceFeeCtrl = TextEditingController();

  @override
  void onInit() {
    super.onInit();
    amountCtrl.addListener(_recalculateDocumentCharges);
    _loadStaticLookups();
  }

  @override
  void onClose() {
    amountCtrl.removeListener(_recalculateDocumentCharges);
    amountCtrl.dispose();
    interestRateCtrl.dispose();
    tenureCtrl.dispose();
    documentChargesCtrl.dispose();
    insuranceFeeCtrl.dispose();
    super.onClose();
  }

  Future<void> _loadStaticLookups() async {
    isLoadingData.value = true;
    try {
      final results = await Future.wait([
        api.getApprovedCenters(),
        api.getLoanProductTypes(),
        api.getLoanPurposeTypes(),
      ]);
      centers.assignAll(results[0]);
      loanProductTypes.assignAll(results[1]);
      purposeTypes.assignAll(results[2]);
      if (centers.length == 1) {
        final only = centers.first;
        if (only is Map && only['id'] != null) {
          await onCenterChanged(only['id'].toString());
        }
      }
    } catch (e) {
      debugPrint('Failed to load renewal loan lookups: $e');
      Get.snackbar(
        'Error',
        'Failed to load form data. Pull to refresh and try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingData.value = false;
    }
  }

  void _recalculateDocumentCharges() {
    final amount = double.tryParse(amountCtrl.text);
    documentChargesCtrl.text = (amount == null || amount <= 0)
        ? '0'
        : ((amount * _documentChargesPercent) / 100).toStringAsFixed(2);
  }

  String? get branchId {
    final center = centers.firstWhere(
      (c) => c is Map && '${c['id']}' == centerId.value,
      orElse: () => null,
    );
    return center is Map ? center['branchId']?.toString() : null;
  }

  Future<void> onCenterChanged(String? value) async {
    centerId.value = value;
    clientId.value = null;
    coApplicantId.value = null;
    productTypeId.value = null;
    productId.value = null;
    purposeTypeId.value = null;
    purposeId.value = null;
    selectedProduct.value = null;
    eligibleClients.clear();
    unindexedLoans.clear();
    productsForBranch.clear();
    purposesForType.clear();
    eligibleCoApplicants.clear();
    ongoingLoans.clear();
    ongoingLoanAcknowledged.value = false;
    showOngoingLoanModal.value = false;
    _clearProductFields();
    if (value == null || value.isEmpty) return;

    isLoadingClients.value = true;
    isLoadingLoans.value = true;
    try {
      final results = await Future.wait([
        api.getEligibleClientsForRenewal(value),
        api.getUnindexedLoans(value),
      ]);
      eligibleClients.assignAll(results[0]);
      unindexedLoans.assignAll(results[1]);
    } catch (e) {
      debugPrint('Failed to load center data: $e');
    } finally {
      isLoadingClients.value = false;
      isLoadingLoans.value = false;
    }
  }

  Future<void> onClientChanged(String? value) async {
    clientId.value = value;
    coApplicantId.value = null;
    eligibleCoApplicants.clear();
    ongoingLoans.clear();
    ongoingLoanAcknowledged.value = false;
    showOngoingLoanModal.value = false;
    if (value == null || value.isEmpty) return;

    isLoadingCoApplicants.value = true;
    try {
      final results = await Future.wait([
        api.getOngoingLoans(value),
        api.getEligibleCoApplicants(value),
      ]);
      ongoingLoans.assignAll(results[0]);
      eligibleCoApplicants.assignAll(results[1]);
      if (ongoingLoans.isNotEmpty) {
        showOngoingLoanModal.value = true;
      }
    } catch (e) {
      debugPrint('Failed to load client data: $e');
    } finally {
      isLoadingCoApplicants.value = false;
    }
  }

  void acknowledgeOngoingLoans() {
    showOngoingLoanModal.value = false;
    ongoingLoanAcknowledged.value = true;
  }

  Future<void> onProductTypeChanged(String? value) async {
    productTypeId.value = value;
    productId.value = null;
    selectedProduct.value = null;
    _clearProductFields();
    await _loadProductsForBranchIfNeeded();
  }

  Future<void> onFrequencyChanged(String? value) async {
    frequency.value = value ?? 'weekly';
    productId.value = null;
    selectedProduct.value = null;
    _clearProductFields();
    await _loadProductsForBranchIfNeeded();
  }

  Future<void> _loadProductsForBranchIfNeeded() async {
    final branch = branchId;
    if (branch == null || branch.isEmpty || productTypeId.value == null) {
      productsForBranch.clear();
      return;
    }
    isLoadingProducts.value = true;
    try {
      productsForBranch.assignAll(await api.getProducts(branch));
    } catch (e) {
      debugPrint('Failed to load products: $e');
      productsForBranch.clear();
    } finally {
      isLoadingProducts.value = false;
    }
  }

  /// Products filtered client-side by the chosen product type + frequency —
  /// mirrors the web app's `filteredLoanProducts`.
  List<dynamic> get filteredProducts => productsForBranch.where((p) {
    if (p is! Map) return false;
    final typeId = p['loanProductTypeId'];
    final matchesType =
        productTypeId.value == null || typeId == productTypeId.value;
    final matchesFrequency =
        (p['frequency']?.toString().toLowerCase()) ==
        frequency.value.toLowerCase();
    return matchesType && matchesFrequency;
  }).toList();

  void onProductSelected(String? value) {
    productId.value = value;
    if (value == null) {
      selectedProduct.value = null;
      _clearProductFields();
      return;
    }
    final product = filteredProducts.firstWhere(
      (p) => p is Map && '${p['id']}' == value,
      orElse: () => null,
    );
    if (product is! Map) return;
    selectedProduct.value = Map<String, dynamic>.from(product);

    final loanAmount = product['loanAmount'];
    final interestRate = product['interestRate'];
    final totalDues = (product['totalDues'] is num)
        ? (product['totalDues'] as num).toDouble()
        : 0.0;
    final insuranceFees = product['insuranceFees'];

    amountCtrl.text = loanAmount != null ? '$loanAmount' : '';
    interestRateCtrl.text = interestRate != null ? '$interestRate' : '';

    // Mirrors handleProductChange's tenure conversion in ApplicationForm.tsx.
    int tenureMonths = totalDues.round();
    final freq = frequency.value.toLowerCase();
    if (freq == 'weekly') {
      tenureMonths = (totalDues / 4.33).ceil();
    } else if (freq == 'biweekly') {
      tenureMonths = (totalDues / 2.17).ceil();
    } else if (freq == 'daily') {
      tenureMonths = (totalDues / 30).ceil();
    }
    tenureCtrl.text = '$tenureMonths';

    final insFee = (insuranceFees is num && insuranceFees > 0)
        ? insuranceFees.toDouble()
        : 0.0;
    insuranceFeeCtrl.text = insFee.toStringAsFixed(2);

    _recalculateDocumentCharges();
  }

  void _clearProductFields() {
    amountCtrl.text = '';
    interestRateCtrl.text = '';
    tenureCtrl.text = '';
    documentChargesCtrl.text = '';
    insuranceFeeCtrl.text = '';
  }

  Future<void> onPurposeTypeChanged(String? value) async {
    purposeTypeId.value = value;
    purposeId.value = null;
    purposesForType.clear();
    if (value == null || value.isEmpty) return;
    try {
      purposesForType.assignAll(await api.getLoanPurposes(value));
    } catch (e) {
      debugPrint('Failed to load loan purposes: $e');
    }
  }

  // -------------------------------------------------------------------
  // Wizard step validity — gates the "Next"/"Submit" button per step.
  // -------------------------------------------------------------------

  bool get step0Valid =>
      centerId.value != null &&
      clientId.value != null &&
      (ongoingLoans.isEmpty || ongoingLoanAcknowledged.value);

  bool get step1Valid => productTypeId.value != null && productId.value != null;

  bool get step2Valid => purposeTypeId.value != null && purposeId.value != null;

  bool canProceedFromStep(int step) {
    switch (step) {
      case 0:
        return step0Valid;
      case 1:
        return step1Valid;
      case 2:
        return step2Valid;
      default:
        return canSubmit;
    }
  }

  bool get canSubmit =>
      !isSubmitting.value &&
      centerId.value != null &&
      clientId.value != null &&
      productId.value != null &&
      productTypeId.value != null &&
      purposeTypeId.value != null &&
      purposeId.value != null &&
      (ongoingLoans.isEmpty || ongoingLoanAcknowledged.value);

  /// Returns true on success. Errors are surfaced via snackbar; caller just
  /// needs to know whether to keep the form open.
  Future<bool> submit() async {
    final client = eligibleClients.firstWhere(
      (c) =>
          c is Map &&
          ('${c['id']}' == clientId.value || '${c['clientId']}' == clientId.value),
      orElse: () => null,
    );
    if (client is Map && client['hasGroup'] == false) {
      Get.snackbar(
        'Group Not Assigned',
        'This member/client must be assigned to a Group before applying for a loan.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return false;
    }

    isSubmitting.value = true;
    try {
      final result = await api.createLoan({
        'clientId': clientId.value,
        'centerId': centerId.value,
        'loanProductId': productId.value,
        'amount': amountCtrl.text,
        'interestRate': interestRateCtrl.text,
        'tenureMonths': int.tryParse(tenureCtrl.text) ?? 0,
        'frequency': frequency.value,
        'loanPurposeId': purposeId.value,
        if (coApplicantId.value != null && coApplicantId.value!.isNotEmpty)
          'coApplicantId': coApplicantId.value,
      });

      final loanNumber = result['loanNumber']?.toString();
      Get.snackbar(
        'Success',
        'Renewal loan application created successfully.'
            '${loanNumber != null ? ' Loan Number: $loanNumber' : ''}',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );

      // Reload the center's roster (client keeps re-picking) — mirrors the
      // web app's form.reset() that keeps centerId but clears everything else.
      await onCenterChanged(centerId.value);
      currentStep.value = 0;
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to create renewal loan application: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isSubmitting.value = false;
    }
  }

  Future<void> deleteUnindexedLoan(String loanId) async {
    isDeletingLoanId.value = loanId;
    try {
      await api.deleteLoan(loanId);
      Get.snackbar(
        'Success',
        'Loan deleted successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await onCenterChanged(centerId.value);
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to delete loan: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isDeletingLoanId.value = null;
    }
  }

  void resetForm() {
    final keptCenterId = centerId.value;
    onCenterChanged(keptCenterId);
    currentStep.value = 0;
  }
}
