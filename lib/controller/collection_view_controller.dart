import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Backs the read-only Collections hub (`CollectionViewHub`) for AM/BM.
/// BM has exactly one branch (from prefs, no API call needed); AM manages
/// several, so this fetches `/api/branches` (unscoped by role) and filters
/// it down to the branches assigned to the signed-in AM.
class CollectionViewController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxList<dynamic> branches = <dynamic>[].obs;
  final RxString selectedBranchId = ''.obs;
  final RxString selectedBranchName = ''.obs;

  Future<void> loadBranches({required bool isBranchManager}) async {
    try {
      isLoading.value = true;
      branches.clear();

      final prefs = await SharedPreferences.getInstance();

      if (isBranchManager) {
        selectedBranchId.value = prefs.getString('branchId') ?? '';
        selectedBranchName.value = prefs.getString('branchName') ?? '';
        return;
      }

      final assignedBranchIds = List<String>.from(
        prefs.getStringList('assignedBranchIds') ?? [],
      );
      final primaryBranchId = prefs.getString('branchId') ?? '';
      final primaryBranchName = prefs.getString('branchName') ?? '';
      if (primaryBranchId.isNotEmpty && !assignedBranchIds.contains(primaryBranchId)) {
        assignedBranchIds.add(primaryBranchId);
      }

      if (assignedBranchIds.isEmpty) {
        selectedBranchId.value = primaryBranchId;
        selectedBranchName.value = primaryBranchName;
        if (selectedBranchId.value.isNotEmpty) {
          branches.add({
            'id': selectedBranchId.value,
            'name': selectedBranchName.value,
          });
        }
        return;
      }

      final response = await _connect.get(Api.branchesUrl);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          final all = body['data'] as List;
          final assigned = all.where(
            (b) => assignedBranchIds.contains('${b['id'] ?? ''}'),
          );
          branches.assignAll(assigned);
          if (branches.isNotEmpty) {
            final first = branches.first;
            selectedBranchId.value = '${first['id'] ?? ''}';
            selectedBranchName.value = '${first['name'] ?? ''}';
          }
          return;
        }
      }

      final errorMsg = response.body?['message'] ?? 'Failed to load branches.';
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoading.value = false;
    }
  }

  void selectBranch(String id, String name) {
    selectedBranchId.value = id;
    selectedBranchName.value = name;
  }
}
