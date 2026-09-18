import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class LiveCollectionController extends GetxController {
  final ApiClient _connect = ApiClient();
  final RxBool isLoading = false.obs;
  final RxList<dynamic> eligibleCenters = <dynamic>[].obs;
  final RxString collectionDate = ''.obs;

  Future<DateTime?> fetchEodWorkingDate([String? branchId]) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final bId = branchId ?? prefs.getString('branchId') ?? '';
      if (bId.isEmpty) return null;

      final token = prefs.getString('accessToken') ?? '';
      final url = "${Api.baseUrl}/api/utilities/eod-process?branchId=$bId";
      final response = await _connect.get(
        url,
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        final ymd = data['workingDateYmd']?.toString();
        if (ymd != null && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(ymd)) {
          collectionDate.value = ymd;
          return DateTime.parse(ymd);
        }
      }
    } catch (e) {
      debugPrint("Failed to fetch EOD working date: $e");
    }
    return null;
  }

  Future<List<dynamic>?> getEligibleCenters(String branchId) async {
    try {
      isLoading.value = true;
      eligibleCenters.clear();

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Authorization Bearer: $accessToken");
      final url = "${Api.demandCentersUrl}?branchId=$branchId";
      debugPrint("Request GET URL: $url");

      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.get(
        url,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Content-Type': 'application/json',
        },
      );

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null) {
            if (data['collectionDate'] != null &&
                data['collectionDate'].toString().isNotEmpty) {
              collectionDate.value = data['collectionDate'].toString();
            } else {
              await fetchEodWorkingDate(branchId);
            }
            final centers = data['centers'];
            if (centers is List) {
              eligibleCenters.assignAll(centers);
              return eligibleCenters;
            }
          }
        }
      }

      final errorMsg =
          response.body?['message'] ??
          response.body?['error'] ??
          'Failed to load eligible centers.';
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    } finally {
      isLoading.value = false;
    }
  }
}
