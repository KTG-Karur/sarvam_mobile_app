import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class AdminEodController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isExecuting = false.obs;
  final RxString dayStatus = 'OPEN'.obs;
  final RxInt pendingCollectionsCount = 0.obs;
  final RxInt pendingDisbursementsCount = 0.obs;
  final RxList<Map<String, dynamic>> eodLogs = <Map<String, dynamic>>[].obs;

  @override
  void onInit() {
    super.onInit();
    checkEodStatus();
  }

  Future<void> checkEodStatus() async {
    try {
      isLoading.value = true;
      final response = await _connect.get("${Api.baseUrl}/api/eod/status");

      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        dayStatus.value = data['status'] ?? 'OPEN';
        pendingCollectionsCount.value = data['pendingCollections'] ?? 0;
        pendingDisbursementsCount.value = data['pendingDisbursements'] ?? 0;

        if (data['logs'] is List) {
          eodLogs.assignAll(List<Map<String, dynamic>>.from(data['logs']));
        }
      }
    } catch (e) {
      debugPrint("Error checking EOD status: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<String?> executeEodBatch() async {
    try {
      isExecuting.value = true;
      final response = await _connect.post("${Api.baseUrl}/api/eod/execute", {});

      if (response.statusCode == 200 || response.statusCode == 201) {
        await checkEodStatus();
        return null;
      }
      return response.body?['message'] ?? 'Failed to execute EOD batch run.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isExecuting.value = false;
    }
  }
}
