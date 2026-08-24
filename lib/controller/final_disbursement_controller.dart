import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/disbursement_api_service.dart';

/// Powers the BM "Final Disbursement" screen — mirrors the core flow of the
/// web app's `components/loan-module/FinalDisbursementClient.tsx`: select a
/// funder, pick an AM-approved index, verify Member-Individual statuses, set
/// attendance & admission fees per loan, capture gold details if applicable,
/// and disburse.
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
  final isLoadingDetails = false.obs;
  final isRefreshingMemberIndividual = false.obs;
  final isSubmitting = false.obs;

  final Rxn<Map<String, dynamic>> branch = Rxn<Map<String, dynamic>>();
  final funders = <dynamic>[].obs;
  final Rxn<String> funderId = Rxn<String>();

  final approvedIndexes = <dynamic>[].obs;
  final stats = <String, dynamic>{'totalLoans': 0, 'totalAmount': 0}.obs;

  final Rxn<Map<String, dynamic>> selectedIndex = Rxn<Map<String, dynamic>>();
  final attendanceMap = <String, String>{}.obs;
  final admissionFeeMap = <String, double>{}.obs;
  final newClientsMap = <String, bool>{}.obs;
  final memberFunderMap = <String, String>{}.obs;
  final funderOverrides = <String>{}.obs;

  // Member Individual verification status per loanId
  final memberIndividualMap = <String, bool>{}.obs;

  // Gold loan state
  final goldMap = <String, Map<String, dynamic>>{}.obs;
  final goldPhotosMap = <String, List<dynamic>>{}.obs;
  final uploadingGoldPhotoFor = Rxn<String>();

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
    admissionFeeMap.clear();
    newClientsMap.clear();
    memberFunderMap.clear();
    funderOverrides.clear();
    memberIndividualMap.clear();
    goldMap.clear();
    goldPhotosMap.clear();
  }

  void setBulkFunder(String? newFunderId) {
    funderId.value = newFunderId;
    if (newFunderId != null && newFunderId.isNotEmpty) {
      for (final loanId in memberFunderMap.keys.toList()) {
        if (!funderOverrides.contains(loanId)) {
          memberFunderMap[loanId] = newFunderId;
        }
      }
    }
  }

  Future<void> selectIndex(Map<String, dynamic> idx) async {
    if (funderId.value == null || funderId.value!.isEmpty) {
      Get.snackbar(
        'Funder Required',
        'Select a funder before selecting an index.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }
    clearSelection();
    selectedIndex.value = idx;

    final loans = idx['loans'];
    if (loans is! List) return;

    final newAttendance = <String, String>{};
    final newFunder = <String, String>{};
    final bulkFunder = funderId.value ?? '';

    for (final l in loans) {
      if (l is Map && l['id'] != null) {
        final loanId = l['id'].toString();
        newAttendance[loanId] = 'PRESENT';
        final fId = l['funderId']?.toString() ?? bulkFunder;
        newFunder[loanId] = fId.isNotEmpty ? fId : bulkFunder;
      }
    }
    attendanceMap.assignAll(newAttendance);
    memberFunderMap.assignAll(newFunder);

    isLoadingDetails.value = true;
    try {
      await refreshMemberIndividualStatuses();
      await refreshGoldPhotos();

      // Check admission fee & isNewClient status for each client
      final newFees = <String, double>{};
      final newClients = <String, bool>{};
      for (final l in loans) {
        if (l is Map && l['id'] != null && l['clientId'] != null) {
          final loanId = l['id'].toString();
          final clientId = l['clientId'].toString();
          try {
            final res = await api.getClientIsNew(clientId);
            final isNew = res['isNew'] == true;
            newClients[loanId] = isNew;
            if (isNew) {
              final feeVal = double.tryParse(res['admissionFees']?.toString() ?? '') ?? 50.0;
              newFees[loanId] = feeVal;
            } else {
              newFees[loanId] = 0.0;
            }
          } catch (_) {
            newClients[loanId] = false;
            newFees[loanId] = 0.0;
          }
        }
      }
      admissionFeeMap.assignAll(newFees);
      newClientsMap.assignAll(newClients);
    } finally {
      isLoadingDetails.value = false;
    }
  }

  Future<void> refreshMemberIndividualStatuses() async {
    final loans = selectedLoans;
    if (loans.isEmpty) return;

    isRefreshingMemberIndividual.value = true;
    try {
      final resultMap = <String, bool>{};
      for (final l in loans) {
        if (l is Map && l['id'] != null) {
          final loanId = l['id'].toString();
          try {
            final statusRes = await api.getMemberIndividualStatus(loanId);
            resultMap[loanId] = statusRes['isComplete'] == true;
          } catch (_) {
            resultMap[loanId] = false;
          }
        }
      }
      memberIndividualMap.assignAll(resultMap);
    } finally {
      isRefreshingMemberIndividual.value = false;
    }
  }

  Future<void> refreshGoldPhotos() async {
    final goldLoans = selectedLoans.where((l) => l is Map && l['isGoldLoan'] == true).toList();
    if (goldLoans.isEmpty) return;

    for (final l in goldLoans) {
      if (l is Map && l['id'] != null) {
        final loanId = l['id'].toString();
        try {
          final photos = await api.getGoldPhotos(loanId);
          goldPhotosMap[loanId] = photos;
        } catch (_) {
          goldPhotosMap[loanId] = [];
        }
      }
    }
  }

  void updateGoldDetail(String loanId, String field, dynamic value, [double? loanAmount]) {
    final current = Map<String, dynamic>.from(goldMap[loanId] ?? {});
    current[field] = value;

    if (loanAmount != null && loanAmount > 0) {
      if (field == 'goldTakenValue') {
        final val = double.tryParse(value.toString()) ?? 0.0;
        final capped = val > loanAmount ? loanAmount : val;
        current['goldTakenValue'] = capped;
        current['cashGiven'] = double.parse((loanAmount - capped).toStringAsFixed(2));
      } else if (field == 'cashGiven') {
        final val = double.tryParse(value.toString()) ?? 0.0;
        final capped = val > loanAmount ? loanAmount : val;
        current['cashGiven'] = capped;
        current['goldTakenValue'] = double.parse((loanAmount - capped).toStringAsFixed(2));
      }
    }
    goldMap[loanId] = current;
  }

  Future<void> uploadGoldPhoto(String loanId, List<int> bytes, String filename) async {
    uploadingGoldPhotoFor.value = loanId;
    try {
      final res = await api.uploadGoldPhoto(loanId, bytes, filename);
      final list = List<dynamic>.from(goldPhotosMap[loanId] ?? []);
      list.add(res);
      goldPhotosMap[loanId] = list;
      Get.snackbar(
        'Photo Uploaded',
        'Gold photo attached successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        'Upload Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      uploadingGoldPhotoFor.value = null;
    }
  }

  Future<void> deleteGoldPhoto(String loanId, String photoId) async {
    try {
      await api.deleteGoldPhoto(loanId, photoId);
      final list = List<dynamic>.from(goldPhotosMap[loanId] ?? []);
      list.removeWhere((p) => p is Map && p['id']?.toString() == photoId);
      goldPhotosMap[loanId] = list;
      Get.snackbar(
        'Photo Removed',
        'Gold photo deleted.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar(
        'Delete Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }

  void setAttendance(String loanId, String status) {
    attendanceMap[loanId] = status;
  }

  void setAdmissionFee(String loanId, double fee) {
    admissionFeeMap[loanId] = fee;
  }

  void setMemberFunder(String loanId, String selectedFunderId) {
    memberFunderMap[loanId] = selectedFunderId;
    funderOverrides.add(loanId);
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

  double get totalLoanAmount {
    double sum = 0.0;
    for (final l in selectedLoans) {
      if (l is Map && l['amount'] is num) {
        sum += (l['amount'] as num).toDouble();
      }
    }
    return sum;
  }

  double get totalAdmissionFee {
    double sum = 0.0;
    for (final l in selectedLoans) {
      if (l is Map && l['id'] != null) {
        final loanId = l['id'].toString();
        if (newClientsMap[loanId] == true) {
          final fee = admissionFeeMap[loanId] ?? 0.0;
          if (!fee.isNaN && fee > 0) sum += fee;
        }
      }
    }
    return sum;
  }

  double get netDisbursementAmount {
    final net = totalLoanAmount - totalAdmissionFee;
    return net < 0 ? 0.0 : net;
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

  List<dynamic> get notCompletedMemberIndividualLoans => selectedLoans
      .where((l) => l is Map && memberIndividualMap[l['id'].toString()] != true)
      .toList();

  bool get allMemberIndividualsCompleted =>
      selectedLoans.isNotEmpty &&
      !isLoadingDetails.value &&
      notCompletedMemberIndividualLoans.isEmpty;

  bool get allGoldFilled => selectedLoans
      .where((l) => l is Map && l['isGoldLoan'] == true)
      .every((l) {
        final loanId = (l as Map)['id'].toString();
        final gd = goldMap[loanId];
        final photos = goldPhotosMap[loanId] ?? [];
        if (gd == null) return false;
        final karat = gd['karatType'];
        final gram = double.tryParse(gd['gramCount']?.toString() ?? '') ?? 0;
        final val = double.tryParse(gd['goldTakenValue']?.toString() ?? '') ?? 0;
        final cash = double.tryParse(gd['cashGiven']?.toString() ?? '') ?? -1;
        return karat != null &&
            gram > 0 &&
            val > 0 &&
            cash >= 0 &&
            photos.isNotEmpty;
      });

  bool get canConfirmDisburse =>
      !isSubmitting.value &&
      selectedIndex.value != null &&
      funderId.value != null &&
      funderId.value!.isNotEmpty &&
      firstDueDateValid &&
      allAttendanceSet &&
      allMemberIndividualsCompleted &&
      allGoldFilled;

  Future<bool> disburse() async {
    final idx = selectedIndex.value;
    final fId = funderId.value;
    if (idx == null || fId == null || fId.isEmpty || !canConfirmDisburse) return false;

    final centerId = idx['centerId']?.toString() ?? '';
    final indexId = idx['id']?.toString() ?? '';

    if (centerId.isEmpty || indexId.isEmpty) {
      Get.snackbar(
        'Validation Error',
        'Missing Center ID or Index ID on selected batch.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    }

    final disbursements = selectedLoans.map((loan) {
      final loanMap = loan as Map;
      final loanId = loanMap['id'].toString();
      final fee = admissionFeeMap[loanId] ?? 0.0;
      final sanitizedFee = (fee.isNaN || fee < 0) ? 0.0 : fee;
      final mFunder = memberFunderMap[loanId]?.trim() ?? '';
      final isNew = newClientsMap[loanId] == true || sanitizedFee > 0;

      final item = <String, dynamic>{
        'loanId': loanId,
        'attendanceStatus': attendanceMap[loanId] == 'ABSENT' ? 'ABSENT' : 'PRESENT',
        'admissionFee': sanitizedFee,
        'isNewClient': isNew,
        'funderId': mFunder.isNotEmpty ? mFunder : fId,
      };

      if (loanMap['isGoldLoan'] == true && goldMap[loanId] != null) {
        item['goldLoanDetails'] = goldMap[loanId];
      }

      return item;
    }).toList();

    isSubmitting.value = true;
    try {
      await api.bmDisburse(
        centerId: centerId,
        indexId: indexId,
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
