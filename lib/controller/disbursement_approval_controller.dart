import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/disbursement_api_service.dart';

/// Powers the AM "Disbursement Approval" (Level 2) screen — mirrors the
/// core flow of the web app's `components/loan-module/DisbursementClient.tsx`:
/// pick a branch (+ optional date range), review index batches of
/// PENDING_LEVEL2 loans, select batches, and Approve (→ APPROVED_LEVEL2,
/// ready for the BM's final disbursement) or Reject. Product-edit,
/// Highmark and the ongoing-loans review dialog stay web-only for now.
class DisbursementApprovalController extends GetxController {
  DisbursementApprovalController({DisbursementApiService? api})
    : api =
          api ??
          DisbursementApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          );

  final DisbursementApiService api;

  final isLoadingBranches = true.obs;
  final isFetchingPending = false.obs;
  final isSubmitting = false.obs;

  final branches = <dynamic>[].obs;
  final pendingIndexes = <dynamic>[].obs;
  final stats = <String, dynamic>{'totalClients': 0, 'totalAmount': 0}.obs;

  final Rxn<String> branchId = Rxn<String>();
  final RxString fromDate = ''.obs;
  final RxString toDate = ''.obs;

  final Rxn<String> expandedIndexId = Rxn<String>();
  final selectedIndexIds = <String>{}.obs;

  @override
  void onInit() {
    super.onInit();
    _loadBranches();
  }

  Future<void> _loadBranches() async {
    isLoadingBranches.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedBranchId = prefs.getString('branchId');
      final result = await api.getBranches();

      // GET /branches isn't role-scoped server-side — an Area Manager sees
      // every branch in the system there. The web app (DisbursementClient's
      // fetchBranches) filters that list down to the AM's own
      // `assignedBranchIds` before ever picking a default, otherwise the
      // screen can default to (or only offer) a branch the AM isn't even
      // assigned to — one with no PENDING_LEVEL2 loans — which reads as
      // "approved on mobile but never reached AM approval" when the loan is
      // sitting, correctly, under a branch this screen never queried.
      final role = prefs.getString('role') ?? '';
      final rbacRoleName = prefs.getString('rbacRoleName') ?? '';
      if (RoleScope.isAreaManager(role) || RoleScope.isAreaManager(rbacRoleName)) {
        final assignedBranchIds = List<String>.from(
          prefs.getStringList('assignedBranchIds') ?? [],
        );
        if (savedBranchId != null &&
            savedBranchId.isNotEmpty &&
            !assignedBranchIds.contains(savedBranchId)) {
          assignedBranchIds.add(savedBranchId);
        }
        if (assignedBranchIds.isNotEmpty) {
          branches.assignAll(
            result.where(
              (b) => b is Map && assignedBranchIds.contains(b['id']?.toString()),
            ),
          );
        } else {
          branches.assignAll(result);
        }
      } else {
        branches.assignAll(result);
      }

      if (savedBranchId != null && savedBranchId.isNotEmpty) {
        final hasSaved = branches.any((b) => b is Map && b['id']?.toString() == savedBranchId);
        if (hasSaved) {
          branchId.value = savedBranchId;
        }
      }
      if (branchId.value == null && branches.isNotEmpty && branches.first is Map && branches.first['id'] != null) {
        branchId.value = branches.first['id'].toString();
      }
      await fetchPending();
    } catch (e) {
      debugPrint('Failed to load branches: $e');
      Get.snackbar(
        'Error',
        'Failed to load branches. Pull to refresh and try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingBranches.value = false;
    }
  }

  Future<void> onBranchChanged(String? value) async {
    branchId.value = value;
    await fetchPending();
  }

  Future<void> onFromDateChanged(String value) async {
    fromDate.value = value;
    await fetchPending();
  }

  Future<void> onToDateChanged(String value) async {
    toDate.value = value;
    await fetchPending();
  }

  Future<void> fetchPending() async {
    final branch = branchId.value ?? '';
    isFetchingPending.value = true;
    try {
      final result = await api.getPendingLevel2Details(
        branchId: branch,
        fromDate: fromDate.value,
        toDate: toDate.value,
      );
      final indexes = result['indexes'];
      pendingIndexes.assignAll(indexes is List ? indexes : <dynamic>[]);
      final resultStats = result['stats'];
      stats.value = resultStats is Map
          ? Map<String, dynamic>.from(resultStats)
          : {'totalClients': 0, 'totalAmount': 0};
      selectedIndexIds.clear();
      expandedIndexId.value = null;
    } catch (e) {
      debugPrint('Failed to load pending Level 2 details: $e');
      Get.snackbar(
        'Error',
        'Failed to load pending loans: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      pendingIndexes.clear();
      stats.value = {'totalClients': 0, 'totalAmount': 0};
    } finally {
      isFetchingPending.value = false;
    }
  }

  void toggleExpand(String indexId) {
    expandedIndexId.value = expandedIndexId.value == indexId ? null : indexId;
  }

  void toggleSelectIndex(String indexId) {
    if (selectedIndexIds.contains(indexId)) {
      selectedIndexIds.remove(indexId);
    } else {
      selectedIndexIds.add(indexId);
    }
  }

  void toggleSelectAll(bool checked) {
    if (checked) {
      selectedIndexIds.assignAll(
        pendingIndexes.map((idx) => idx['id'].toString()),
      );
    } else {
      selectedIndexIds.clear();
    }
  }

  bool get isAllSelected =>
      pendingIndexes.isNotEmpty &&
      pendingIndexes.every((idx) => selectedIndexIds.contains(idx['id'].toString()));

  /// Client names with an incomplete Member Individual / GRT among the
  /// currently-selected batches — mirrors the pre-check in web's
  /// `openAMActionDialog` so the AM sees this before hitting Approve instead
  /// of after (the server enforces the same gate regardless).
  List<String> get unverifiedClientNamesInSelection {
    final names = <String>[];
    for (final idx in pendingIndexes) {
      if (!selectedIndexIds.contains(idx['id'].toString())) continue;
      final loans = idx['loans'];
      if (loans is! List) continue;
      for (final loan in loans) {
        if (loan is Map && loan['isVerified'] != true) {
          names.add(loan['clientName']?.toString() ?? 'Unknown');
        }
      }
    }
    return names;
  }

  /// Approves or rejects every selected index batch, grouped by centerId
  /// (the backend's level2-action endpoint takes one center at a time).
  /// Returns the total loan count processed, or null on failure.
  Future<int?> submitAction(String action) async {
    if (selectedIndexIds.isEmpty) return null;

    final centerIndexMap = <String, List<String>>{};
    for (final idx in pendingIndexes) {
      final id = idx['id'].toString();
      if (!selectedIndexIds.contains(id)) continue;
      final centerId = idx['centerId']?.toString();
      if (centerId == null) continue;
      centerIndexMap.putIfAbsent(centerId, () => []).add(id);
    }

    isSubmitting.value = true;
    var totalCount = 0;
    try {
      for (final entry in centerIndexMap.entries) {
        final result = await api.level2Action(
          centerId: entry.key,
          action: action,
          indexIds: entry.value,
        );
        totalCount += (result['count'] is num) ? (result['count'] as num).toInt() : 0;
      }

      Get.snackbar(
        'Success',
        action == 'APPROVE'
            ? '$totalCount loan(s) approved for disbursement. Branch Manager will perform the final disbursal.'
            : '$totalCount loan(s) rejected successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await fetchPending();
      return totalCount;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to process action: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    } finally {
      isSubmitting.value = false;
    }
  }
}
