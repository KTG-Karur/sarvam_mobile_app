import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/offline_collection_service.dart';

class CollectionController extends GetxController {
  final ApiClient _connect = ApiClient();
  final OfflineCollectionService _offlineService =
      Get.put(OfflineCollectionService());

  final RxBool isLoading = false.obs;
  final RxList<dynamic> demandCollections = <dynamic>[].obs;
  final RxMap<String, dynamic> summary = <String, dynamic>{}.obs;

  static const _summaryTotalFields = [
    'totalClients',
    'totalDemand',
    'loanOutstanding',
    'openingArrears',
    'totalArrearPrincipal',
    'totalArrearInterest',
    'totalCurrentDemandPrincipal',
    'totalCurrentDemandInterest',
  ];

  Future<List<dynamic>?> getDemandCollection({
    required String centerId,
    required String date,
  }) async {
    try {
      isLoading.value = true;
      demandCollections.clear();
      summary.clear();

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Authorization Bearer: $accessToken");
      debugPrint("centerId: $centerId");
      debugPrint("date: $date");

      _connect.timeout = const Duration(seconds: 15);

      final url =
          "${Api.demandCollectionUrl}?centerId=$centerId&date=$date&collectionDate=$date";
      debugPrint("Request GET URL: $url");

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
          if (data is List) {
            demandCollections.assignAll(
              data.map((item) => item is Map ? Map<String, dynamic>.from(item) : item).toList(),
            );
          } else if (data != null && data['collections'] is List) {
            demandCollections.assignAll(
              (data['collections'] as List)
                  .map((item) => item is Map ? Map<String, dynamic>.from(item) : item)
                  .toList(),
            );
            if (data['summary'] is Map) {
              summary.assignAll(Map<String, dynamic>.from(data['summary']));
            }
          }
          return demandCollections;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          'Failed to load demand collections.';
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

  Future<List<dynamic>?> getDemandCollectionForAllCenters({
    required List<dynamic> centers,
    required String date,
  }) async {
    try {
      isLoading.value = true;
      demandCollections.clear();
      summary.clear();

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      _connect.timeout = const Duration(seconds: 15);

      final List<dynamic> merged = [];
      final Map<String, num> aggregatedSummary = {};

      for (final center in centers) {
        final centerId = center is Map ? "${center['id'] ?? ''}" : '';
        final centerName = center is Map ? "${center['name'] ?? ''}" : '';
        if (centerId.isEmpty) continue;

        final url =
            "${Api.demandCollectionUrl}?centerId=$centerId&date=$date&collectionDate=$date";
        debugPrint("Request GET URL: $url");

        final response = await _connect.get(
          url,
          headers: {
            'Authorization': 'Bearer $accessToken',
            'Content-Type': 'application/json',
          },
        );

        debugPrint("Response Status Code: ${response.statusCode}");

        if (response.statusCode == 200) {
          final body = response.body;
          if (body != null && body['success'] == true) {
            final data = body['data'];
            final List<dynamic> items = data is List
                ? data
                : (data != null && data['collections'] is List
                      ? data['collections']
                      : const []);
            if (data is Map && data['summary'] is Map) {
              final centerSummary = Map<String, dynamic>.from(data['summary']);
              for (final field in _summaryTotalFields) {
                final value = centerSummary[field];
                if (value is num) {
                  aggregatedSummary[field] =
                      (aggregatedSummary[field] ?? 0) + value;
                }
              }
            }
            for (final item in items) {
              if (item is Map) {
                final withCenter = Map<String, dynamic>.from(item);
                withCenter['centerName'] =
                    withCenter['centerName'] ?? centerName;
                withCenter['centerId'] = withCenter['centerId'] ?? centerId;
                merged.add(withCenter);
              } else {
                merged.add(item);
              }
            }
          }
        }
      }

      demandCollections.assignAll(merged);
      summary.assignAll(aggregatedSummary);
      return demandCollections;
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

  /// Stages the selected clients' collections (plus attendance, cash
  /// denomination and meeting photo) for BM approval.
  ///
  /// The backend rejects this endpoint unless the request is
  /// multipart/form-data (it needs to accept the meeting photo file), so
  /// nested fields are JSON-encoded into individual form fields.
  ///
  /// NOTE: the field names below are inferred from what the app already has
  /// available (list/detail responses) since the backend team has not yet
  /// confirmed the exact contract for this endpoint — verify against a real
  /// submission and adjust field names if the API rejects it.
  Future<Map<String, dynamic>?> submitDemandCollection({
    required String centerId,
    required String collectionDate,
    required List<Map<String, dynamic>> collections,
    required List<Map<String, dynamic>> attendance,
    required Map<String, dynamic> denomination,
    required num totalCollected,
    Uint8List? meetingPhotoBytes,
  }) async {
    if (meetingPhotoBytes == null || meetingPhotoBytes.isEmpty) {
      Get.snackbar(
        'Meeting Photo Required',
        'Please capture or select a center meeting photo before submitting collections.',
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return null;
    }

    try {
      isLoading.value = true;

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      // The API requires the file under the `photo` multipart field.
      MultipartFile photoFile() => MultipartFile(
        meetingPhotoBytes,
        filename: 'meeting_$collectionDate.jpg',
        contentType: 'image/jpeg',
      );

      final payload = {
        'centerId': centerId,
        'collectionDate': collectionDate,
        'collections': collections,
        'attendance': attendance,
        'denomination': denomination,
        'totalCollected': totalCollected,
      };

      final formData = FormData({
        'centerId': centerId,
        'collectionDate': collectionDate,
        'collections': jsonEncode(collections),
        'attendance': jsonEncode(attendance),
        'denomination': jsonEncode(denomination),
        if (meetingPhotoBytes != null) 'photo': photoFile(),
      });

      debugPrint("Request POST URL: ${Api.demandCollectionUrl}");
      debugPrint(
        "Request Fields: centerId=$centerId, collectionDate=$collectionDate, "
        "collections=${jsonEncode(collections)}, attendance=${jsonEncode(attendance)}, "
        "denomination=${jsonEncode(denomination)}, totalCollected=$totalCollected, "
        "hasPhoto=${meetingPhotoBytes != null}",
      );

      // This request re-sends the same meeting photo under 5 different field
      // names (see the FormData below), which multiplies the upload size —
      // give it more headroom than a plain JSON request on a slow connection.
      _connect.timeout = const Duration(seconds: 60);

      final response = await _connect.post(
        Api.demandCollectionUrl,
        formData,
        headers: {'Authorization': 'Bearer $accessToken'},
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
          debugPrint("No internet detected. Saving demand collection offline.");
          final saved = await _offlineService.saveOfflineCollection(
            type: 'DEMAND',
            payload: payload,
            title: 'Demand Collection ($centerId)',
          );
          if (saved) {
            return {'offline': true, 'message': 'Demand collection saved offline.'};
          }
        }
      }

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          final data = resBody['data'];
          return data is Map
              ? Map<String, dynamic>.from(data)
              : <String, dynamic>{};
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to submit collections.');
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    } catch (e) {
      debugPrint("Request Error: $e. Attempting offline fallback.");
      final saved = await _offlineService.saveOfflineCollection(
        type: 'DEMAND',
        payload: {
          'centerId': centerId,
          'collectionDate': collectionDate,
          'collections': collections,
          'attendance': attendance,
          'denomination': denomination,
          'totalCollected': totalCollected,
        },
        title: 'Demand Collection ($centerId)',
      );
      if (saved) {
        return {'offline': true, 'message': 'Demand collection saved offline.'};
      }
      return null;
    } finally {
      isLoading.value = false;
    }
  }
}
