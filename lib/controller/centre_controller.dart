import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class CentreController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isCreating = false.obs;
  final RxList<dynamic> centersList = <dynamic>[].obs;

  /// Creates a center. [body] should omit `code`/`fdoId` — the backend
  /// auto-generates the Center ID per branch and force-assigns the FDO from
  /// the caller's own auth token, ignoring whatever is sent for those fields.
  Future<Map<String, dynamic>?> createCenter(Map<String, dynamic> body) async {
    try {
      isCreating.value = true;
      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Request POST URL: ${Api.centersUrl}");
      debugPrint("Request Body: $body");

      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.post(
        Api.centersUrl,
        body,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Content-Type': 'application/json',
        },
      );

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null &&
            resBody['success'] == true &&
            resBody['data'] is Map) {
          final center = Map<String, dynamic>.from(resBody['data']);
          centersList.insert(0, center);
          return center;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to create center.');
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
      isCreating.value = false;
    }
  }

  Future<List<dynamic>?> getCenters() async {
    try {
      isLoading.value = true;
      centersList.clear();

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Authorization Bearer: $accessToken");
      debugPrint("Request GET URL: ${Api.centersUrl}");

      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.get(
        Api.centersUrl,
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
            centersList.assignAll(data);
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

  final RxBool isDetailLoading = false.obs;
  final RxMap<String, dynamic> centerDetails = <String, dynamic>{}.obs;

  Future<Map<String, dynamic>?> getCenterDetails(String centerId) async {
    try {
      isDetailLoading.value = true;
      centerDetails.clear();

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      debugPrint("Authorization Bearer: $accessToken");
      debugPrint("Request GET URL: ${Api.centersUrl}/$centerId");

      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.get(
        "${Api.centersUrl}/$centerId",
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
          if (data is Map) {
            final Map<String, dynamic> mapData = Map<String, dynamic>.from(
              data,
            );
            centerDetails.assignAll(mapData);
            return centerDetails;
          }
        }
      }

      final errorMsg =
          response.body?['message'] ?? 'Failed to load center details.';
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
      isDetailLoading.value = false;
    }
  }

  final RxBool isUpdatingStatus = false.obs;

  /// Approves or rejects a center via `POST {centersUrl}/{id}/approve`.
  /// [action] must be `'APPROVE'` or `'REJECT'`; the backend requires
  /// [rejectionReason] to be non-empty when rejecting.
  Future<bool> approveCenter(
    String centerId,
    String action, {
    String? rejectionReason,
    String? comments,
  }) async {
    try {
      isUpdatingStatus.value = true;

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      final url = "${Api.centersUrl}/$centerId/approve";
      debugPrint("Request POST URL: $url");

      final body = {
        "action": action,
        if (rejectionReason != null && rejectionReason.isNotEmpty)
          "rejectionReason": rejectionReason,
        if (comments != null && comments.isNotEmpty) "comments": comments,
      };
      debugPrint("Request Body: $body");

      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.post(
        url,
        body,
        headers: {
          'Authorization': 'Bearer $accessToken',
          'Content-Type': 'application/json',
        },
      );

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          final newStatus = action == 'APPROVE' ? 'APPROVED' : 'REJECTED';
          final index = centersList.indexWhere(
            (c) => "${c['id'] ?? c['centerId']}" == centerId,
          );
          if (index != -1) {
            final updated = Map<String, dynamic>.from(centersList[index]);
            updated['status'] = newStatus;
            if (resBody['data'] is Map) {
              updated.addAll(Map<String, dynamic>.from(resBody['data']));
            }
            centersList[index] = updated;
          }
          Get.snackbar(
            'Success',
            resBody['message'] ?? 'Center status updated successfully.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
          );
          return true;
        }
      }

      final errorMsg =
          response.body?['message'] ??
          response.body?['error'] ??
          'Failed to update center status.';
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isUpdatingStatus.value = false;
    }
  }
}
