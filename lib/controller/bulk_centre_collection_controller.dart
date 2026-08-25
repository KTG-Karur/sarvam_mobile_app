import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/offline_collection_service.dart';
import 'package:sarvam/utils/center_formatter.dart';

class BulkCentreCollectionController extends GetxController {
  final ApiClient _connect = ApiClient();
  final OfflineCollectionService _offlineService =
      Get.put(OfflineCollectionService());

  final RxBool isLoading = false.obs;
  final RxList<dynamic> centersList = <dynamic>[].obs;
  final RxList<dynamic> demandSheet = <dynamic>[].obs;

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
              // Must match the dropdown items' own formatCenterDisplay
              // output, not a raw concat — see single_collection_controller
              // for why a mismatch here breaks the initial selection.
              selectedCenterName.value = formatCenterDisplay(
                firstCenter['name'],
                firstCenter['code'],
                parenthetical: true,
              );
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

  Future<List<dynamic>?> getBulkCollection({
    required String centerId,
    required String date,
  }) async {
    try {
      isLoading.value = true;
      demandSheet.clear();

      final url =
          "${Api.bulkCollectionUrl}?centerId=$centerId&collectionDate=$date";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['demandSheet'] is List) {
            final sheet = data['demandSheet'] as List;
            demandSheet.assignAll(sheet);
            return demandSheet;
          }
        }
      }

      final errorMsg =
          response.body?['error'] ?? response.body?['message'] ?? 'Failed to load bulk collection demand sheet.';
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

  /// `POST /api/collections/bulk-collection` (multipart) — mirrors the
  /// web's `handleFinalSubmit` in `BulkCollectionClient.tsx` exactly. The
  /// backend requires a multipart request with a mandatory `photo` field
  /// and parses `collections` as a JSON-encoded form field (`{clientId,
  /// loanId, amount, loanAdvance, isSelected}` per entry, filtered
  /// server-side to `isSelected && amount > 0`) — the previous plain-JSON
  /// `demandSheet` body could never succeed against this endpoint.
  Future<bool> submitBulkCollection({
    required String centerId,
    required String collectionDate,
    required String collectionType,
    required List<Map<String, dynamic>> collections,
    required Map<String, dynamic> denomination,
    required Uint8List photoBytes,
    double? latitude,
    double? longitude,
  }) async {
    try {
      isLoading.value = true;

      final payload = {
        'centerId': centerId,
        'collectionDate': collectionDate,
        'collectionType': collectionType,
        'collections': collections,
        'denomination': denomination,
      };

      final formData = FormData({
        'centerId': centerId,
        'collectionDate': collectionDate,
        'collectionType': collectionType,
        'collections': jsonEncode(collections),
        'denomination': jsonEncode(denomination),
        'photo': MultipartFile(
          photoBytes,
          filename: 'meeting_$collectionDate.jpg',
          contentType: 'image/jpeg',
        ),
        if (latitude != null) 'latitude': latitude.toString(),
        if (longitude != null) 'longitude': longitude.toString(),
      });

      debugPrint("Request POST URL: ${Api.bulkCollectionUrl}");
      debugPrint("Request Fields: $payload");

      _connect.timeout = const Duration(seconds: 60);

      final response = await _connect.post(
        Api.bulkCollectionUrl,
        formData,
      );

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      // Check for network error / no connection
      if (response.statusCode == null || response.hasError) {
        final statusText = (response.statusText ?? '').toLowerCase();
        if (response.statusCode == null ||
            statusText.contains('network') ||
            statusText.contains('connection') ||
            statusText.contains('socket') ||
            statusText.contains('timeout')) {
          debugPrint("No internet detected. Saving bulk collection offline.");
          final saved = await _offlineService.saveOfflineCollection(
            type: 'BULK',
            payload: payload,
            title: 'Bulk Collection ($selectedCenterName)',
          );
          if (saved) return true;
        }
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          Get.snackbar(
            'Success',
            resBody['message'] ?? 'Collections submitted for Review.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
          );
          return true;
        }
      }

      final errorMsg =
          response.body?['error'] ?? response.body?['message'] ?? 'Failed to submit bulk collection.';
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e. Attempting offline fallback.");
      final saved = await _offlineService.saveOfflineCollection(
        type: 'BULK',
        payload: {
          'centerId': centerId,
          'collectionDate': collectionDate,
          'collectionType': collectionType,
          'collections': collections,
          'denomination': denomination,
        },
        title: 'Bulk Collection ($selectedCenterName)',
      );
      if (saved) return true;
      return false;
    } finally {
      isLoading.value = false;
    }
  }
}