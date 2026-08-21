import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/disbursement_api_service.dart';

/// Powers the BM "Final Disbursement" screen — mirrors the core flow of the
/// web app's `components/loan-module/FinalDisbursementClient.tsx`: select a
/// funder, pick an AM-approved index, set attendance per loan, and disburse.
/// Gold-loan detail capture, admission-fee editing and the Member-Individual
/// refresh-status button stay web-only for now (regular loans only; the
/// server still enforces the Member Individual + GRT gate on submit).
class FinalDisbursementController extends GetxController {
  FinalDisbursementController({DisbursementApiService? api})
    : api =
          api ??
          DisbursementApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          );

  final DisbursementApiService api;

  final isLoading = true.obs;
  final isLoadingIndexes = false.obs;
  final isSubmitting = false.obs;

  final Rxn<Map<String, dynamic>> branch = Rxn<Map<String, dynamic>>();
  final funders = <dynamic>[].obs;
  final Rxn<String> funderId = Rxn<String>();

  final approvedIndexes = <dynamic>[].obs;
  final stats = <String, dynamic>{'totalLoans': 0, 'totalAmount': 0}.obs;

  final Rxn<Map<String, dynamic>> selectedIndex = Rxn<Map<String, dynamic>>();
  final attendanceMap = <String, String>{}.obs;

  String? _branchId;

  @override
  void onInit() {
    super.onInit();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    isLoading.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      _branchId = prefs.getString('branchId');

      final results = await Future.wait([api.getBranches(), api.getFunders()]);
      final branches = results[0];
      funders.assignAll(results[1]);

      if (_branchId != null) {
        final match = branches.firstWhere(
          (b) => b is Map && b['id']?.toString() == _branchId,
          orElse: () => null,
        );
        if (match is Map) branch.value = Map<String, dynamic>.from(match);
        await fetchApprovedIndexes();
      }
    } catch (e) {
      debugPrint('Failed to load Final Disbursement lookups: $e');
      Get.snackbar(
        'Error',
        'Failed to load branch/funder data. Pull to refresh and try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> fetchApprovedIndexes() async {
    final branchId = _branchId;
    if (branchId == null || branchId.isEmpty) return;

    isLoadingIndexes.value = true;
    try {
      final result = await api.getApprovedLevel2(branchId: branchId);
      final indexes = result['indexes'];
      approvedIndexes.assignAll(indexes is List ? indexes : <dynamic>[]);
      final resultStats = result['stats'];
      stats.value = resultStats is Map
          ? Map<String, dynamic>.from(resultStats)
          : {'totalLoans': 0, 'totalAmount': 0};
      clearSelection();
    } catch (e) {
      debugPrint('Failed to load approved-Level-2 loans: $e');
      Get.snackbar(
        'Error',
        'Failed to load approved loans for this branch: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      approvedIndexes.clear();
      stats.value = {'totalLoans': 0, 'totalAmount': 0};
    } finally {
      isLoadingIndexes.value = false;
    }
  }

  void clearSelection() {
    selectedIndex.value = null;
    attendanceMap.clear();
  }

  void selectIndex(Map<String, dynamic> idx) {
    if (funderId.value == null || funderId.value!.isEmpty) {
      Get.snackbar(
        'Funder Required',
        'Select a funder before selecting an index.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }
    selectedIndex.value = idx;
    final loans = idx['loans'];
    final newMap = <String, String>{};
    if (loans is List) {
      for (final l in loans) {
        if (l is Map && l['id'] != null) newMap[l['id'].toString()] = 'PRESENT';
      }
    }
    attendanceMap.assignAll(newMap);
  }

  void setAttendance(String loanId, String status) {
    attendanceMap[loanId] = status;
  }

  void setAttendanceForAll(String status) {
    final loans = selectedLoans;
    final newMap = <String, String>{};
    for (final l in loans) {
      if (l is Map && l['id'] != null) newMap[l['id'].toString()] = status;
    }
    attendanceMap.assignAll(newMap);
  }

  List<dynamic> get selectedLoans {
    final loans = selectedIndex.value?['loans'];
    return loans is List ? loans : const [];
  }

  List<dynamic> get missingFirstDueDateLoans =>
      selectedLoans.where((l) => l is Map && l['firstDueDate'] == null).toList();

  bool get firstDueDateValid =>
      selectedLoans.isNotEmpty && missingFirstDueDateLoans.isEmpty;

  String? get commonFirstDueDate {
    final loans = selectedLoans;
    if (loans.isEmpty) return null;
    final first = loans.first;
    return first is Map ? first['firstDueDate']?.toString() : null;
  }

  bool get allAttendanceSet =>
      selectedLoans.isNotEmpty &&
      selectedLoans.every(
        (l) => l is Map && attendanceMap.containsKey(l['id'].toString()),
      );

  bool get canConfirmDisburse =>
      !isSubmitting.value &&
      selectedIndex.value != null &&
      funderId.value != null &&
      funderId.value!.isNotEmpty &&
      firstDueDateValid &&
      allAttendanceSet;

  Future<bool> disburse() async {
    final idx = selectedIndex.value;
    final fId = funderId.value;
    if (idx == null || fId == null || !canConfirmDisburse) return false;

    final disbursements = selectedLoans.map((loan) {
      final loanMap = loan as Map;
      return {
        'loanId': loanMap['id'].toString(),
        'attendanceStatus': attendanceMap[loanMap['id'].toString()],
        'admissionFee': 0,
        'isNewClient': false,
      };
    }).toList();

    isSubmitting.value = true;
    try {
      await api.bmDisburse(
        centerId: idx['centerId'].toString(),
        indexId: idx['id'].toString(),
        funderId: fId,
        disbursements: disbursements,
      );

      final funder = funders.firstWhere(
        (f) => f is Map && f['id']?.toString() == fId,
        orElse: () => null,
      );
      final funderName = funder is Map ? (funder['funderName']?.toString() ?? '') : '';

      Get.snackbar(
        'Disbursed Successfully',
        '${selectedLoans.length} loan(s) disbursed'
            '${funderName.isNotEmpty ? ' via $funderName' : ''} with first due date '
            '${commonFirstDueDate ?? ''}.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );

      approvedIndexes.removeWhere((i) => i['id'] == idx['id']);
      clearSelection();
      return true;
    } catch (e) {
      Get.snackbar(
        'Disbursement Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isSubmitting.value = false;
    }
  }
}
