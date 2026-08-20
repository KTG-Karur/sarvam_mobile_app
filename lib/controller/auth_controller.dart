import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/view/auth/login_screen.dart';

class AuthController extends GetxController {
  final GetConnect _connect = GetConnect();
  final RxBool isLoading = false.obs;

  Future<bool> login({
    required String employeeId,
    required String password,
  }) async {
    try {
      isLoading.value = true;

      // Adjust timeout if needed
      _connect.timeout = const Duration(seconds: 15);

      final response = await _connect.post(
        Api.loginUrl,
        {
          "employeeId": employeeId,
          "password": password,
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          final accessToken = data['accessToken'];
          final refreshToken = data['refreshToken'];
          final user = data['user'];
          final branch = data['branch'];

          final prefs = await SharedPreferences.getInstance();
          await prefs.setString('accessToken', accessToken ?? '');
          await prefs.setString('refreshToken', refreshToken ?? '');
          
          debugPrint("Bearer $accessToken");
          
          if (user != null) {
            await prefs.setString('userId', user['id'] ?? '');
            await prefs.setString('employeeId', user['employeeId'] ?? '');
            await prefs.setString('mobileNumber', user['mobileNumber'] ?? '');
            await prefs.setString('email', user['email'] ?? '');
            await prefs.setString('firstName', user['firstName'] ?? '');
            await prefs.setString('lastName', user['lastName'] ?? '');
            await prefs.setString('role', user['role'] ?? '');
            await prefs.setString('rbacRoleName', user['rbacRoleName'] ?? '');

            final assignedBranchIds = user['assignedBranchIds'];
            if (assignedBranchIds is List && assignedBranchIds.isNotEmpty) {
              await prefs.setStringList(
                'assignedBranchIds',
                assignedBranchIds.map((e) => e.toString()).toList(),
              );
            } else {
              await prefs.remove('assignedBranchIds');
            }
          }

          if (branch != null) {
            await prefs.setString('branchId', branch['id'] ?? '');
            await prefs.setString('branchName', branch['name'] ?? '');
            await prefs.setString('branchCode', branch['code'] ?? '');
          }

          return true;
        }
      }

      String errorMsg = 'Login failed. Invalid credentials.';
      if (response.status.connectionError) {
        errorMsg = 'Network error. Please check internet connection.';
      } else if (response.body != null && response.body is Map) {
        if (response.body['error'] != null && response.body['error'].toString().isNotEmpty) {
          errorMsg = response.body['error'].toString();
        } else if (response.body['message'] != null && response.body['message'].toString().isNotEmpty) {
          errorMsg = response.body['message'].toString();
        } else if (response.statusText != null && response.statusText!.isNotEmpty) {
          errorMsg = response.statusText!;
        }
      } else if (response.statusText != null && response.statusText!.isNotEmpty) {
        errorMsg = response.statusText!;
      }

      Get.snackbar(
        'Login Failed',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent.withValues(alpha: 0.9),
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      Get.snackbar(
        'Error',
        'An error occurred: $e',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent.withValues(alpha: 0.9),
        colorText: Colors.white,
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> logout() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove('accessToken');
      await prefs.remove('refreshToken');
      await prefs.remove('userId');
      await prefs.remove('employeeId');
      await prefs.remove('mobileNumber');
      await prefs.remove('email');
      await prefs.remove('firstName');
      await prefs.remove('lastName');
      await prefs.remove('role');
      await prefs.remove('rbacRoleName');
      await prefs.remove('assignedBranchIds');
      await prefs.remove('branchId');
      await prefs.remove('branchName');
      await prefs.remove('branchCode');

      Get.offAll(() => const LoginScreen());
    } catch (e) {
      Get.snackbar(
        'Logout Error',
        'Failed to log out correctly: $e',
        snackPosition: SnackPosition.BOTTOM,
      );
    }
  }
}
