import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/loan_api_service.dart';

/// Powers the BM "Loan Index Approval" screen — mirrors the core flow of
/// the web app's `components/loan-module/LoanIndexationClient.tsx`: BM
/// picks a center, reviews verified-but-unindexed loans, approves/rejects
/// each, sets a First Due Date, and submits — which creates the loan index
/// and forwards approved loans straight to the Area Manager (PENDING_LEVEL2)
/// in one call.x1
class LoanIndexApprovalController extends GetxController {
  LoanIndexApprovalController({LoanApiService? api})
    : api =
          api ??
          LoanApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          );

  final LoanApiService api;

  final isLoadingCenters = true.obs;
  final isLoadingLoans = false.obs;
  final isLoadingIndexes = false.obs;
  final isSaving = false.obs;

  final centers = <dynamic>[].obs;
  final unindexedLoans = <dynamic>[].obs;
  final loanIndexes = <dynamic>[].obs;

  final Rxn<String> centerId = Rxn<String>();
  final RxString indexDate = ''.obs;
  final RxString firstDueDate = ''.obs;
  final RxString nextIndexNo = ''.obs;

  final selectedLoanIds = <String>{}.obs;
  final rejectedLoanIds = <String>{}.obs;

  late final String todayStr;
  String? _branchId;

  Map<String, dynamic>? get selectedCenter {
    final cid = centerId.value;
    if (cid == null || cid.isEmpty) return null;
    for (final c in centers) {
      if (c is Map && c['id']?.toString() == cid) {
        return Map<String, dynamic>.from(c);
      }
    }
    return null;
  }

  @override
  void onInit() {
    super.onInit();
    todayStr = _formatDate(DateTime.now());
    indexDate.value = todayStr;
    _bootstrap();
  }

  String _formatDate(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  Future<void> _bootstrap() async {
    isLoadingCenters.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      _branchId = prefs.getString('branchId');
      final result = await api.getApprovedCenters();
      centers.assignAll(result);
      if (centers.length == 1) {
        final only = centers.first;
        if (only is Map && only['id'] != null) {
          await onCenterChanged(only['id'].toString());
          return;
        }
      }
      await fetchLoanIndexes();
    } catch (e) {
      debugPrint('Failed to load loan index lookups: $e');
      Get.snackbar(
        'Error',
        'Failed to load centers. Pull to refresh and try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingCenters.value = false;
    }
  }

  Future<void> onCenterChanged(String? value) async {
    centerId.value = value;
    unindexedLoans.clear();
    selectedLoanIds.clear();
    rejectedLoanIds.clear();
    firstDueDate.value = '';
    nextIndexNo.value = '';

    if (value == null || value.isEmpty) {
      await fetchLoanIndexes();
      return;
    }

    isLoadingLoans.value = true;
    try {
      unindexedLoans.assignAll(await api.getUnindexedLoansForIndexation(value));
      final branch = _branchId;
      if (branch != null && branch.isNotEmpty) {
        final nextId = await api.getNextIndexNo(branch, value);
        if (nextId['nextId'] != null) {
          nextIndexNo.value = nextId['nextId'].toString();
        }
      }
    } catch (e) {
      debugPrint('Failed to load unindexed loans: $e');
      Get.snackbar(
        'Error',
        'Failed to load loans for this center. Please try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingLoans.value = false;
    }

    await fetchLoanIndexes();
  }

  Future<void> fetchLoanIndexes() async {
    isLoadingIndexes.value = true;
    try {
      loanIndexes.assignAll(
        await api.getLoanIndexes(
          fromDate: indexDate.value,
          toDate: indexDate.value,
          centerId: centerId.value,
        ),
      );
    } catch (e) {
      debugPrint('Failed to load loan index records: $e');
      loanIndexes.clear();
    } finally {
      isLoadingIndexes.value = false;
    }
  }

  void toggleSelect(String loanId) {
    if (selectedLoanIds.contains(loanId)) {
      selectedLoanIds.remove(loanId);
    } else {
      selectedLoanIds.add(loanId);
      rejectedLoanIds.remove(loanId);
    }
  }

  void toggleReject(String loanId) {
    if (rejectedLoanIds.contains(loanId)) {
      rejectedLoanIds.remove(loanId);
    } else {
      rejectedLoanIds.add(loanId);
      selectedLoanIds.remove(loanId);
    }
  }

  void selectAll(bool checked) {
    if (checked) {
      selectedLoanIds.assignAll(unindexedLoans.map((l) => l['id'].toString()));
      rejectedLoanIds.clear();
    } else {
      selectedLoanIds.clear();
    }
  }

  void rejectAll(bool checked) {
    if (checked) {
      rejectedLoanIds.assignAll(unindexedLoans.map((l) => l['id'].toString()));
      selectedLoanIds.clear();
    } else {
      rejectedLoanIds.clear();
    }
  }

  void resetSelections() {
    selectedLoanIds.clear();
    rejectedLoanIds.clear();
    firstDueDate.value = '';
  }

  static const Map<String, int> _meetingDayMap = {
    'SUNDAY': 0,
    'MONDAY': 1,
    'TUESDAY': 2,
    'WEDNESDAY': 3,
    'THURSDAY': 4,
    'FRIDAY': 5,
    'SATURDAY': 6,
    'SUN': 0,
    'MON': 1,
    'TUE': 2,
    'WED': 3,
    'THU': 4,
    'FRI': 5,
    'SAT': 6,
  };

  String? get meetingDayMismatch {
    final due = firstDueDate.value;
    final center = selectedCenter;
    if (due.isEmpty || center == null) return null;

    final mDayStr = center['meetingDay']?.toString().trim().toUpperCase();
    if (mDayStr == null || mDayStr.isEmpty) return null;

    final expectedDay = _meetingDayMap[mDayStr];
    if (expectedDay == null) return null;

    final parts = due.split('-');
    if (parts.length != 3) return null;

    final dt = DateTime(int.parse(parts[0]), int.parse(parts[1]), int.parse(parts[2]));
    final actualDay = dt.weekday % 7;

    if (actualDay == expectedDay) return null;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return "First due date must fall on center's meeting day ($mDayStr). Selected date is ${dayNames[actualDay]}.";
  }

  bool get firstDueDateValid =>
      firstDueDate.value.isEmpty || firstDueDate.value.compareTo(todayStr) >= 0;

  bool get canSubmit =>
      !isSaving.value &&
      centerId.value != null &&
      selectedLoanIds.isNotEmpty &&
      firstDueDate.value.isNotEmpty &&
      firstDueDateValid &&
      meetingDayMismatch == null;

  /// Why the Save button is currently disabled, or null if it isn't.
  /// Previously the UI only ever explained the "due date is in the past"
  /// case — tapping "Approve" on a loan only *selects* it locally (same as
  /// the web app's per-row toggle); Save is the only action that actually
  /// submits, and if it's silently disabled for any of the other reasons
  /// below (most commonly: no First Due Date set yet), nothing visibly
  /// happens when tapped, which reads as "approving doesn't work."
  String? get submitBlockedReason {
    if (isSaving.value) return null;
    if (centerId.value == null) return 'Select a center first.';
    if (selectedLoanIds.isEmpty) {
      return 'Tap "Approve" on at least one loan below before saving.';
    }
    if (firstDueDate.value.isEmpty) {
      return 'Set the First Due Date above to enable Save.';
    }
    if (!firstDueDateValid) {
      return 'First due date must be today or later.';
    }
    return meetingDayMismatch;
  }

  final RxSet<String> deletingIndexIds = <String>{}.obs;

  /// Releases a batch stuck without AM forwarding (e.g. the "approve" half
  /// of [submit] failed after the index was already created) back into
  /// "unindexed loans" so it can be redone — mirrors the web app's
  /// "Delete Index" action in `LoanIndexationClient.tsx`. Returns true on
  /// success.
  Future<bool> deleteLoanIndexRecord(String indexId) async {
    deletingIndexIds.add(indexId);
    try {
      await api.deleteLoanIndex(indexId);
      Get.snackbar(
        'Index Deleted',
        'Loan index released. Its loan(s) are available under Unindexed Loans again.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      final currentCenter = centerId.value;
      if (currentCenter != null) {
        await onCenterChanged(currentCenter);
      } else {
        await fetchLoanIndexes();
      }
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to delete loan index: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      deletingIndexIds.remove(indexId);
    }
  }

  Future<Map<String, dynamic>?> fetchPassbook(String loanId) async {
    try {
      final res = await api.getPassbookData(
        loanId,
        firstDueDate: firstDueDate.value,
      );
      if (res['data'] is Map) {
        return Map<String, dynamic>.from(res['data'] as Map);
      }
      return res;
    } catch (e) {
      debugPrint('Failed to fetch passbook: $e');
      Get.snackbar(
        'Passbook Error',
        'Failed to load passbook details for this loan.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    }
  }

  Set<String> get _currentUnindexedLoanIds {
    return unindexedLoans
        .whereType<Map<String, dynamic>>()
        .map((l) => l['id']?.toString() ?? '')
        .where((id) => id.isNotEmpty)
        .toSet();
  }

  Future<bool> _validateSelectedLoansBeforeSubmit() async {
    final center = centerId.value;
    if (center == null || center.isEmpty) {
      return false;
    }

    try {
      final freshLoans = await api.getUnindexedLoansForIndexation(center);
      unindexedLoans.assignAll(freshLoans);
    } catch (e) {
      debugPrint('Failed to refresh unindexed loans before submit: $e');
      // Fall through to allow the existing list to be used if refresh fails.
    }

    final validIds = _currentUnindexedLoanIds;
    final staleLoanIds = selectedLoanIds
        .where((id) => !validIds.contains(id))
        .toList();
    if (staleLoanIds.isEmpty) return true;

    selectedLoanIds.removeAll(staleLoanIds);
    rejectedLoanIds.removeAll(staleLoanIds);
    Get.snackbar(
      'Loan list changed',
      '${staleLoanIds.length} selected loan(s) are no longer available for indexing. Your selection was updated.',
      backgroundColor: Colors.orange,
      colorText: Colors.white,
      duration: const Duration(seconds: 5),
    );
    return false;
  }

  /// Returns true on success. Errors are surfaced via snackbar.
  Future<bool> submit() async {
    if (!canSubmit) return false;

    isSaving.value = true;
    try {
      if (!await _validateSelectedLoansBeforeSubmit()) {
        return false;
      }

      final createResult = await api.createLoanIndex({
        'indexDate': indexDate.value,
        'centerId': centerId.value,
        'selectedLoanIds': selectedLoanIds.toList(),
      });

      final newIndexId = createResult['id']?.toString();
      if (newIndexId == null || newIndexId.isEmpty) {
        throw Exception('Loan index was not created');
      }

      await api.approveLoanIndex(newIndexId, {
        'selectedLoanIds': selectedLoanIds.toList(),
        'rejectedLoanIds': rejectedLoanIds.toList(),
        'firstDueDate': firstDueDate.value,
      });

      Get.snackbar(
        'Sent to Area Manager',
        'Loan index created and ${selectedLoanIds.length} loan(s) forwarded to Area Manager for approval.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );

      final currentCenter = centerId.value;
      await onCenterChanged(currentCenter);
      return true;
    } catch (e) {
      if (e is LoanApiException &&
          e.message.toLowerCase().contains('already indexed')) {
        await onCenterChanged(centerId.value);
        Get.snackbar(
          'Loan list updated',
          'Some selected loans were already indexed. The list has been refreshed; please try again.',
          backgroundColor: Colors.orange,
          colorText: Colors.white,
        );
        return false;
      }

      Get.snackbar(
        'Error',
        'Failed to submit loan index: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isSaving.value = false;
    }
  }
}
