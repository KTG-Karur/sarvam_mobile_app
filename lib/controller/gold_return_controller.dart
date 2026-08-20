import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class GoldReturnController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isActionLoading = false.obs;
  final RxList<dynamic> activeGoldLoans = <dynamic>[].obs;
  final RxList<dynamic> pendingReturns = <dynamic>[].obs;
  final RxList<dynamic> completedReturns = <dynamic>[].obs;

  Future<void> fetchGoldTransactions() async {
    try {
      isLoading.value = true;
      activeGoldLoans.clear();
      pendingReturns.clear();
      completedReturns.clear();

      final results = await Future.wait([
        _connect.get("${Api.goldTransactionsUrl}?activeOnly=true"),
        _connect.get("${Api.goldTransactionsUrl}?type=GIVE&status=PENDING"),
        _connect.get("${Api.goldTransactionsUrl}?type=GIVE&status=APPROVED"),
      ]);

      final activeRes = results[0];
      final pendingRes = results[1];
      final completedRes = results[2];

      if (activeRes.statusCode == 200 && activeRes.body?['success'] == true) {
        final data = activeRes.body['data'];
        if (data is List) activeGoldLoans.assignAll(data);
      }

      if (pendingRes.statusCode == 200 && pendingRes.body?['success'] == true) {
        final data = pendingRes.body['data'];
        if (data is List) pendingReturns.assignAll(data);
      }

      if (completedRes.statusCode == 200 && completedRes.body?['success'] == true) {
        final data = completedRes.body['data'];
        if (data is List) completedReturns.assignAll(data);
      }
    } catch (e) {
      debugPrint("Error fetching gold transactions: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> approveReturn(String transactionId) async {
    try {
      isActionLoading.value = true;
      final url = "${Api.goldTransactionsUrl}/$transactionId/approve";
      final response = await _connect.post(url, {});

      if (response.statusCode == 200 && response.body?['success'] == true) {
        Get.snackbar(
          'Approved',
          response.body?['message'] ?? 'Gold return approved successfully',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: const Color(0xFF0D6842),
          colorText: Colors.white,
        );
        await fetchGoldTransactions();
        return true;
      }

      final msg = response.body?['message'] ?? response.body?['error'] ?? 'Approval failed';
      Get.snackbar(
        'Error',
        msg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Error approving gold return: $e");
      return false;
    } finally {
      isActionLoading.value = false;
    }
  }

  Future<bool> rejectReturn(String transactionId, String reason) async {
    if (reason.trim().isEmpty) {
      Get.snackbar(
        'Validation Error',
        'Please enter a rejection reason.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.amber.shade800,
        colorText: Colors.white,
      );
      return false;
    }

    try {
      isActionLoading.value = true;
      final url = "${Api.goldTransactionsUrl}/$transactionId/reject";
      final response = await _connect.post(url, {
        "rejectionReason": reason.trim(),
      });

      if (response.statusCode == 200 && response.body?['success'] == true) {
        Get.snackbar(
          'Rejected',
          response.body?['message'] ?? 'Gold return rejected',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.orange.shade800,
          colorText: Colors.white,
        );
        await fetchGoldTransactions();
        return true;
      }

      final msg = response.body?['message'] ?? response.body?['error'] ?? 'Rejection failed';
      Get.snackbar(
        'Error',
        msg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Error rejecting gold return: $e");
      return false;
    } finally {
      isActionLoading.value = false;
    }
  }
}
