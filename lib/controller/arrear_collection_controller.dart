import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/offline_collection_service.dart';

class ArrearCollectionController extends GetxController {
  final ApiClient _connect = ApiClient();
  final OfflineCollectionService _offlineService =
      Get.put(OfflineCollectionService());

  final RxBool isLoading = false.obs;
  final RxList<dynamic> centersList = <dynamic>[].obs;
  final RxList<dynamic> arrearCollections = <dynamic>[].obs;

  final RxString branchId = ''.obs;
  final RxString branchName = ''.obs;
  final RxString selectedCenterId = ''.obs;
  final RxString selectedCenterName = ''.obs;

  @override
  void onInit() {
    super.onInit();
    loadBranchInfo();
  }

  Future<void> loadBranchInfo() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      branchId.value = prefs.getString('branchId') ?? '';
      branchName.value = prefs.getString('branchName') ?? 'Theni';
      if (branchId.isNotEmpty) {
        await getCenters(branchId.value);
      }
    } catch (e) {
      debugPrint("Error loading branch info: $e");
    }
  }

  Future<List<dynamic>?> getCenters(String bId) async {
    try {
      isLoading.value = true;
      centersList.clear();

      final url =
          "${Api.centersUrl}?branchId=$bId&includeInactive=false&status=APPROVED";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data is List) {
            centersList.assignAll(data);
            if (centersList.isNotEmpty) {
              final firstCenter = centersList.first;
              selectedCenterId.value = firstCenter['id'] ?? '';
              selectedCenterName.value =
                  "${firstCenter['name']} (${firstCenter['code']})";
            }
            return centersList;
          }
        }
      }

      final errorMsg = response.body?['message'] ?? 'Failed to load centers.';
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

  Future<List<dynamic>?> getArrearCollection({
    required String centerId,
    required String date,
  }) async {
    try {
      isLoading.value = true;
      arrearCollections.clear();

      final url =
          "${Api.arrearCollectionUrl}?centerId=$centerId&collectionDate=$date";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data is List) {
            arrearCollections.assignAll(data);
          } else if (data != null && data['collections'] is List) {
            arrearCollections.assignAll(data['collections']);
          }
          return arrearCollections;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          'Failed to load arrear collections.';
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

  Future<bool> submitArrearCollection({
    required String centerId,
    required String date,
    required List<dynamic> arrearData,
  }) async {
    try {
      isLoading.value = true;

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      final url = Api.arrearCollectionUrl;
      debugPrint("Request POST URL: $url");

      final body = {
        "centerId": centerId,
        "collectionDate": date,
        "arrearCollections": arrearData,
      };
      debugPrint("Request Body: $body");

      _connect.timeout = const Duration(seconds: 30);

      final response = await _connect.post(
        url,
        body,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Content-Type': 'application/json',
        },
      );

      // Check for network error / no connection
      if (response.statusCode == null || response.hasError) {
        final statusText = (response.statusText ?? '').toLowerCase();
        if (response.statusCode == null ||
            statusText.contains('network') ||
            statusText.contains('connection') ||
            statusText.contains('socket') ||
            statusText.contains('timeout')) {
          debugPrint("No internet detected. Saving arrear collection offline.");
          final saved = await _offlineService.saveOfflineCollection(
            type: 'ARREAR',
            payload: body,
            title: 'Arrear Collection ($selectedCenterName)',
          );
          if (saved) return true;
        }
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          Get.snackbar(
            'Success',
            resBody['message'] ?? 'Arrear collection submitted successfully.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
          );
          return true;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          'Failed to submit arrear collection.';
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e. Saving offline.");
      final saved = await _offlineService.saveOfflineCollection(
        type: 'ARREAR',
        payload: {
          "centerId": centerId,
          "collectionDate": date,
          "arrearCollections": arrearData,
        },
        title: 'Arrear Collection ($selectedCenterName)',
      );
      if (saved) return true;
      return false;
    } finally {
      isLoading.value = false;
    }
  }
}
