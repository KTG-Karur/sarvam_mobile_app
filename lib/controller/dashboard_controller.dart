import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Branch-wide dashboard stats + current-week collection totals for the
/// logged-in FDO's branch (backend scopes `/api/dashboard/v2` to the
/// caller's own branchId for the FDO role).
class DashboardController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxMap<String, dynamic> stats = <String, dynamic>{}.obs;
  final RxList<dynamic> demandCollection = <dynamic>[].obs;
  final RxMap<String, dynamic> taskDetails = <String, dynamic>{}.obs;
  final RxBool isTaskDetailsLoading = false.obs;

  num _weeklyTotal(String key) => demandCollection.fold<num>(
    0,
    (sum, day) => sum + ((day as Map)[key] as num? ?? 0),
  );

  num get weeklyDemandTotal => _weeklyTotal('demandTotal');
  num get weeklyCollectionTotal => _weeklyTotal('collectionTotal');

  /// Percentage of this week's due amount collected so far; null when there's
  /// no demand yet to divide by (avoids a misleading 0%).
  double? get weeklyCollectionPercent {
    final demand = weeklyDemandTotal;
    if (demand <= 0) return null;
    return (weeklyCollectionTotal / demand) * 100;
  }

  Future<void> getDashboardStats() async {
    try {
      isLoading.value = true;

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Request GET URL: ${Api.dashboardStatsUrl}");

      _connect.timeout = const Duration(seconds: 20);

      final response = await _connect.get(
        Api.dashboardStatsUrl,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Content-Type': 'application/json',
        },
      );

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is Map) {
          final data = Map<String, dynamic>.from(body['data']);
          stats.assignAll(
            data['stats'] is Map
                ? Map<String, dynamic>.from(data['stats'])
                : {},
          );
          demandCollection.assignAll(
            data['demandCollection'] is List ? data['demandCollection'] : [],
          );
          return;
        }
      }

      final errorMsg =
          response.body?['message'] ?? 'Failed to load dashboard stats.';
      _showSnackbar('Error ${response.statusCode}', errorMsg);
    } catch (e) {
      debugPrint("Request Error: $e");
      _showSnackbar('Request Error', e.toString());
    } finally {
      isLoading.value = false;
    }
  }

  /// The same role-scoped KPI payload used by the web dashboard. For an Area
  /// Manager, the backend aggregates all branches assigned to that AM.
  Future<void> getTaskDetails() async {
    try {
      isTaskDetailsLoading.value = true;
      final response = await _connect.get(Api.taskDetailsUrl);
      if (response.statusCode == 200 &&
          response.body?['success'] == true &&
          response.body?['data'] is Map) {
        taskDetails.assignAll(Map<String, dynamic>.from(response.body['data']));
        return;
      }

      _showSnackbar(
        'Dashboard Error',
        response.body?['message'] ?? 'Failed to load Area Manager dashboard.',
      );
    } catch (e) {
      debugPrint('Task details request error: $e');
      _showSnackbar(
        'Dashboard Error',
        'Unable to load the Area Manager dashboard.',
      );
    } finally {
      isTaskDetailsLoading.value = false;
    }
  }

  void _showSnackbar(String title, String message) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (Get.isSnackbarOpen) return;
      Get.snackbar(
        title,
        message,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    });
  }
}
