import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class ForeclosureApprovalController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isActionLoading = false.obs;
  final RxList<dynamic> pendingItems = <dynamic>[].obs;
  final RxList<dynamic> centers = <dynamic>[].obs;
  final RxString selectedCenterId = 'all'.obs;
  final RxString selectedBranchId = ''.obs;

  Future<void> fetchCenters(String branchId) async {
    if (branchId.isEmpty) return;
    try {
      selectedBranchId.value = branchId;
      final url = "${Api.centersUrl}?branchId=$branchId&includeInactive=false&status=APPROVED";
      final response = await _connect.get(url);
      if (response.statusCode == 200 && response.body?['success'] == true) {
        final data = response.body['data'];
        if (data is List) {
          centers.assignAll(data);
        }
      }
    } catch (e) {
      debugPrint("Error fetching centers: $e");
    }
  }

  Future<void> fetchPendingForeclosures({String? branchId, String? centerId}) async {
    try {
      isLoading.value = true;
      pendingItems.clear();

      final bId = branchId ?? selectedBranchId.value;
      final cId = centerId ?? selectedCenterId.value;

      String url = "${Api.foreclosurePendingUrl}?limit=50";
      if (bId.isNotEmpty) url += "&branchId=$bId";
      if (cId.isNotEmpty && cId != 'all') url += "&centerId=$cId";

      debugPrint("GET Foreclosure Pending URL: $url");
      final response = await _connect.get(url);

      if (response.statusCode == 200 && response.body?['success'] == true) {
        final data = response.body['data'];
        if (data is Map && data['items'] is List) {
          pendingItems.assignAll(data['items']);
          return;
        }
      }

      final msg = response.body?['message'] ?? 'Failed to load pending foreclosures.';
      Get.snackbar(
        'Foreclosure Queue',
        msg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.amber.shade800,
        colorText: Colors.white,
      );
    } catch (e) {
      debugPrint("Error loading pending foreclosures: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> approveForeclosure(String requestId) async {
    try {
      isActionLoading.value = true;
      final url = "${Api.foreclosureBaseUrl}/$requestId/approve";
      final response = await _connect.post(url, {});

      if (response.statusCode == 200 && response.body?['success'] == true) {
        Get.snackbar(
          'Approved',
          response.body?['message'] ?? 'Foreclosure approved successfully',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: const Color(0xFF0D6842),
          colorText: Colors.white,
        );
        await fetchPendingForeclosures();
        return true;
      }

      final errorMsg = response.body?['message'] ?? response.body?['error'] ?? 'Approval failed';
      Get.snackbar(
        'Action Failed',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Error approving foreclosure: $e");
      return false;
    } finally {
      isActionLoading.value = false;
    }
  }

  Future<bool> rejectForeclosure(String requestId, String rejectionReason) async {
    if (rejectionReason.trim().isEmpty) {
      Get.snackbar(
        'Validation Error',
        'Please provide a rejection reason.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.amber.shade800,
        colorText: Colors.white,
      );
      return false;
    }

    try {
      isActionLoading.value = true;
      final url = "${Api.foreclosureBaseUrl}/$requestId/reject";
      final response = await _connect.post(url, {
        "rejectionReason": rejectionReason.trim(),
      });

      if (response.statusCode == 200 && response.body?['success'] == true) {
        Get.snackbar(
          'Rejected',
          response.body?['message'] ?? 'Foreclosure request rejected',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.orange.shade800,
          colorText: Colors.white,
        );
        await fetchPendingForeclosures();
        return true;
      }

      final errorMsg = response.body?['message'] ?? response.body?['error'] ?? 'Rejection failed';
      Get.snackbar(
        'Action Failed',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Error rejecting foreclosure: $e");
      return false;
    } finally {
      isActionLoading.value = false;
    }
  }
}
