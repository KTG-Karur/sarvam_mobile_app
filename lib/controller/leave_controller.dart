import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class LeaveController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxList<dynamic> leaveBalances = <dynamic>[].obs;
  final RxList<dynamic> leaveTypes = <dynamic>[].obs;
  final RxList<dynamic> leaveApplications = <dynamic>[].obs;

  @override
  void onInit() {
    super.onInit();
    fetchLeaveData();
    fetchLeaveApplications();
  }

  Future<void> fetchLeaveApplications() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.getLeaveApplicationsUrl);
      debugPrint("Leave Applications Response: ${response.body}");
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          leaveApplications.assignAll(body['data']);
        }
      } else {
        debugPrint("Leave applications fetch failed: ${response.statusCode}");
      }
    } catch (e) {
      debugPrint("Error fetching leave applications: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> fetchLeaveData() async {
    try {
      isLoading.value = true;

      final prefs = await SharedPreferences.getInstance();
      final employeeId = prefs.getString('employeeId') ?? '';

      if (employeeId.isEmpty) {
        debugPrint("LeaveController: employeeId is empty");
      }

      // Fetch Leave Balance
      final balanceResponse = await _connect.get(Api.leaveBalanceUrl(employeeId));
      debugPrint("Leave Balance Response: ${balanceResponse.body}");
      if (balanceResponse.statusCode == 200) {
        final body = balanceResponse.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          leaveBalances.assignAll(body['data']);
        }
      } else {
        debugPrint("Leave balance fetch failed: ${balanceResponse.statusCode}");
      }

      // Fetch Leave Types
      final typesResponse = await _connect.get(Api.leaveTypesUrl);
      debugPrint("Leave Types Response: ${typesResponse.body}");
      if (typesResponse.statusCode == 200) {
        final body = typesResponse.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          leaveTypes.assignAll(body['data']);
        }
      } else {
        debugPrint("Leave types fetch failed: ${typesResponse.statusCode}");
      }
    } catch (e) {
      debugPrint("Error fetching leave data: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> applyLeave({
    required String leaveTypeId,
    required String fromDate,
    required String toDate,
    required String reason,
    bool isHalfDay = false,
    String? halfDaySession,
    Uint8List? attachmentBytes,
    String? attachmentName,
  }) async {
    try {
      isLoading.value = true;

      Response response;
      if (attachmentBytes != null) {
        final formData = FormData({
          "leaveTypeId": leaveTypeId,
          "fromDate": fromDate,
          "toDate": toDate,
          "reason": reason,
          "isHalfDay": isHalfDay.toString(),
          if (halfDaySession != null) "halfDaySession": halfDaySession,
          "attachment": MultipartFile(
            attachmentBytes,
            filename: attachmentName ?? 'attachment.pdf',
          ),
        });
        response = await _connect.post(Api.applyLeaveUrl, formData);
      } else {
        final Map<String, dynamic> payload = {
          "leaveTypeId": leaveTypeId,
          "fromDate": fromDate,
          "toDate": toDate,
          "reason": reason,
        };

        if (isHalfDay) {
          payload["isHalfDay"] = true;
          if (halfDaySession != null) {
            payload["halfDaySession"] = halfDaySession;
          }
        }
        response = await _connect.post(Api.applyLeaveUrl, payload);
      }

      debugPrint("Apply Leave Response: ${response.body}");

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          // Refresh balances and applications since they have changed
          await fetchLeaveData();
          await fetchLeaveApplications();
          return true;
        } else if (body != null && body['message'] != null) {
          Get.snackbar(
            'Action Failed',
            body['message'].toString(),
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.redAccent,
            colorText: Colors.white,
          );
        } else if (body != null && body['error'] != null) {
          Get.snackbar(
            'Action Failed',
            body['error'].toString(),
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.redAccent,
            colorText: Colors.white,
          );
        }
      } else {
        final body = response.body;
        String errorMsg = 'Failed to submit leave request. Please try again.';
        if (body != null && (body['message'] != null || body['error'] != null)) {
          errorMsg = (body['message'] ?? body['error']).toString();
        }
        Get.snackbar(
          'Error',
          errorMsg,
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
        );
      }
      return false;
    } catch (e) {
      debugPrint("Error applying leave: $e");
      return false;
    } finally {
      isLoading.value = false;
    }
  }
}
