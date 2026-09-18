import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/offline_collection_service.dart';
import 'package:sarvam/utils/center_formatter.dart';

class SingleCollectionController extends GetxController {
  final ApiClient _connect = ApiClient();
  final OfflineCollectionService _offlineService =
      Get.put(OfflineCollectionService());

  final RxBool isLoading = false.obs;
  final RxList<dynamic> centersList = <dynamic>[].obs;
  final RxList<dynamic> clientsList = <dynamic>[].obs;
  final RxMap<String, dynamic> singleCollectionData = <String, dynamic>{}.obs;

  final RxString branchId = ''.obs;
  final RxString branchName = ''.obs;
  final RxString selectedCenterId = ''.obs;
  final RxString selectedCenterName = ''.obs;
  final RxString selectedClientId = ''.obs;
  final RxString selectedClientName = ''.obs;

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
              // output, not a raw concat — the formatter can reformat the
              // code (e.g. pad "6" to "06"), and a mismatch here breaks the
              // initial dropdown selection.
              selectedCenterName.value = formatCenterDisplay(
                firstCenter['name'],
                firstCenter['code'],
                parenthetical: true,
              );
              // Trigger client list loading for the first center
              await getClients(selectedCenterId.value);
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

  Future<List<dynamic>?> getClients(String centerId) async {
    try {
      isLoading.value = true;
      clientsList.clear();
      singleCollectionData.clear();
      selectedClientId.value = '';
      selectedClientName.value = '';

      final url =
          "${Api.clientsUrl}?centerId=$centerId&includeInactive=false&includeLoanInfo=true&pageSize=1000";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['clients'] is List) {
            final clients = data['clients'] as List;
            clientsList.assignAll(clients);
            if (clientsList.isNotEmpty) {
              final firstClient = clientsList.first;
              selectedClientId.value = firstClient['id'] ?? '';
              selectedClientName.value =
                  "${firstClient['firstName']} ${firstClient['lastName']} (${firstClient['clientId']})";
              await getSingleCollection(selectedClientId.value);
            }
            return clientsList;
          }
        }
      }

      final errorMsg = response.body?['message'] ?? 'Failed to load clients.';
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

  /// [clientSummary] is the already-loaded client row from [clientsList] (has
  /// loanNumber/loanAmount/loanOutstanding/funderName). Used to populate a
  /// partial view when the detailed loan-info endpoint fails server-side,
  /// instead of silently showing a client with zero dues.
  Future<Map<String, dynamic>?> getSingleCollection(
    String clientId, {
    Map<String, dynamic>? clientSummary,
  }) async {
    try {
      isLoading.value = true;
      singleCollectionData.clear();

      final url = "${Api.singleCollectionUrl}?clientId=$clientId";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data is Map<String, dynamic>) {
            singleCollectionData.assignAll(data);
            return singleCollectionData;
          } else if (data is Map) {
            singleCollectionData.assignAll(Map<String, dynamic>.from(data));
            return singleCollectionData;
          }
        }
      } else if (response.statusCode == 404) {
        debugPrint("No active loan found for client: $clientId");
        singleCollectionData.clear();
        return singleCollectionData;
      }

      final errorMsg =
          response.body?['error'] ?? response.body?['message'] ?? 'Failed to load single collection details.';

      if (clientSummary != null) {
        singleCollectionData.assignAll({
          'loanNumber': clientSummary['loanNumber'],
          'loanAmount': clientSummary['loanAmount'],
          'loanOutstanding': clientSummary['loanOutstanding'],
          'productName': clientSummary['funderName'],
          'loadFailed': true,
        });
      }

      Get.snackbar(
        'Error ${response.statusCode}',
        clientSummary != null
            ? '$errorMsg Showing limited details from the client record — verify amounts manually.'
            : errorMsg,
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

  /// `POST /api/collections/single-collection` (multipart) — mirrors the
  /// web's `handleFinalSubmit` in `SingleCollectionClient.tsx` exactly. The
  /// backend requires a multipart request with a mandatory `photo` field —
  /// a plain JSON POST (the previous implementation here) can never
  /// succeed against this endpoint, and neither can the wrong field names
  /// it used (`collectedAmount`/`advanceAmount` instead of `amount`/
  /// `loanAdvance`, no `loanId`, no `denomination`).
  Future<bool> submitSingleCollection({
    required String clientId,
    required String loanId,
    required String collectionDate,
    required double amount,
    required double loanAdvance,
    required String collectionType,
    required Map<String, dynamic> denomination,
    required Uint8List photoBytes,
    double? latitude,
    double? longitude,
  }) async {
    try {
      isLoading.value = true;

      final payload = {
        'clientId': clientId,
        'loanId': loanId,
        'collectionDate': collectionDate,
        'amount': amount,
        'loanAdvance': loanAdvance,
        'collectionType': collectionType,
        'denomination': denomination,
      };

      final formData = FormData({
        'clientId': clientId,
        'loanId': loanId,
        'collectionType': collectionType,
        'amount': amount.toString(),
        'loanAdvance': loanAdvance.toString(),
        'paymentMode': 'CASH',
        'collectionDate': collectionDate,
        'remarks': 'Single collection - $collectionType',
        'denomination': jsonEncode(denomination),
        'photo': MultipartFile(
          photoBytes,
          filename: 'meeting_$collectionDate.jpg',
          contentType: 'image/jpeg',
        ),
        if (latitude != null) 'latitude': latitude.toString(),
        if (longitude != null) 'longitude': longitude.toString(),
      });

      debugPrint("Request POST URL: ${Api.singleCollectionUrl}");
      debugPrint("Request Fields: $payload");

      _connect.timeout = const Duration(seconds: 60);

      final response = await _connect.post(
        Api.singleCollectionUrl,
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
          debugPrint("No internet detected. Saving single collection offline.");
          final saved = await _offlineService.saveOfflineCollection(
            type: 'SINGLE',
            payload: payload,
            title: 'Single Collection ($clientId)',
          );
          if (saved) {
            singleCollectionData['status'] = 'COLLECTED (OFFLINE)';
            return true;
          }
        }
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          Get.snackbar(
            'Success',
            resBody['message'] ?? 'Collection submitted for Review.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
          );
          singleCollectionData['status'] = 'COLLECTED';
          return true;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          'Failed to submit collection.';
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
        type: 'SINGLE',
        payload: {
          'clientId': clientId,
          'loanId': loanId,
          'collectionDate': collectionDate,
          'amount': amount,
          'loanAdvance': loanAdvance,
          'collectionType': collectionType,
          'denomination': denomination,
        },
        title: 'Single Collection ($clientId)',
      );
      if (saved) {
        singleCollectionData['status'] = 'COLLECTED (OFFLINE)';
        return true;
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }
}