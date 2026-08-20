import 'dart:io' as io;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/view/auth/login_screen.dart';

class AuthController extends GetxController {
  final GetConnect _connect = GetConnect();
  final RxBool isLoading = false.obs;

  /// Retrieves the device's actual native identifier using device_info_plus.
  /// Stores it in SharedPreferences so the same ID is reused consistently on every launch/login.
  Future<String> getOrCreateDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    String? storedDeviceId = prefs.getString('deviceId');
    if (storedDeviceId != null && storedDeviceId.isNotEmpty) {
      return storedDeviceId;
    }

    String? nativeDeviceId;
    final DeviceInfoPlugin deviceInfo = DeviceInfoPlugin();

    try {
      if (kIsWeb) {
        final webInfo = await deviceInfo.webBrowserInfo;
        nativeDeviceId = webInfo.vendor != null && webInfo.vendor!.isNotEmpty
            ? "${webInfo.vendor}_${webInfo.userAgent}"
            : webInfo.userAgent;
      } else if (io.Platform.isAndroid) {
        final androidInfo = await deviceInfo.androidInfo;
        nativeDeviceId = androidInfo.id;
      } else if (io.Platform.isIOS) {
        final iosInfo = await deviceInfo.iosInfo;
        nativeDeviceId = iosInfo.identifierForVendor;
      } else if (io.Platform.isWindows) {
        final windowsInfo = await deviceInfo.windowsInfo;
        nativeDeviceId = windowsInfo.deviceId;
      } else if (io.Platform.isMacOS) {
        final macInfo = await deviceInfo.macOsInfo;
        nativeDeviceId = macInfo.systemGUID;
      } else if (io.Platform.isLinux) {
        final linuxInfo = await deviceInfo.linuxInfo;
        nativeDeviceId = linuxInfo.machineId;
      }
    } catch (e) {
      debugPrint('Error retrieving native device identifier: $e');
    }

    final String finalDeviceId = (nativeDeviceId != null && nativeDeviceId.isNotEmpty)
        ? nativeDeviceId
        : 'unknown_device';

    await prefs.setString('deviceId', finalDeviceId);
    return finalDeviceId;
  }

  Future<bool> login({
    required String employeeId,
    required String password,
    String? deviceId,
  }) async {
    try {
      isLoading.value = true;

      // Adjust timeout if needed
      _connect.timeout = const Duration(seconds: 15);

      final String effectiveDeviceId = (deviceId != null && deviceId.isNotEmpty)
          ? deviceId
          : await getOrCreateDeviceId();

      final Map<String, dynamic> payload = {
        "employeeId": employeeId,
        "password": password,
        "deviceId": effectiveDeviceId,
      };

      final response = await _connect.post(
        Api.mobileLoginUrl,
        payload,
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

          final returnedDeviceId = data['deviceId'] ?? (data['user'] is Map ? data['user']['deviceId'] : null) ?? effectiveDeviceId;
          if (returnedDeviceId != null && returnedDeviceId.toString().isNotEmpty) {
            await prefs.setString('deviceId', returnedDeviceId.toString());
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

  /// Mobile login function accepting employeeId, password, and deviceId
  Future<bool> mobileLogin({
    required String employeeId,
    required String password,
    required String deviceId,
  }) async {
    return login(
      employeeId: employeeId,
      password: password,
      deviceId: deviceId,
    );
  }

  /// Setup MPIN for authenticated user (POST /api/mobile/mpin/setup)
  Future<bool> setupMpin({
    required String mpin,
    required String confirmMpin,
  }) async {
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');

      final response = await _connect.post(
        Api.mpinSetupUrl,
        {
          "mpin": mpin,
          "confirmMpin": confirmMpin,
        },
        headers: {
          'Content-Type': 'application/json',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['accessToken'] != null) {
            await prefs.setString('accessToken', data['accessToken']);
          }
          if (data != null && data['refreshToken'] != null) {
            await prefs.setString('refreshToken', data['refreshToken']);
          }
          await prefs.setString('mpin', mpin);
          await prefs.setBool('isMpinSet', true);
          return true;
        }
      }

      String errorMsg = 'Failed to set MPIN.';
      if (response.body != null && response.body is Map && response.body['error'] != null) {
        errorMsg = response.body['error'].toString();
      }
      Get.snackbar(
        'MPIN Setup Failed',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      Get.snackbar('Error', 'An error occurred: $e', snackPosition: SnackPosition.BOTTOM);
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Verify MPIN for authenticated user (POST /api/mobile/mpin/verify)
  Future<bool> verifyMpin({
    required String mpin,
  }) async {
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');

      final response = await _connect.post(
        Api.mpinVerifyUrl,
        {
          "mpin": mpin,
        },
        headers: {
          'Content-Type': 'application/json',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['accessToken'] != null) {
            await prefs.setString('accessToken', data['accessToken']);
          }
          if (data != null && data['refreshToken'] != null) {
            await prefs.setString('refreshToken', data['refreshToken']);
          }
          await prefs.setString('mpin', mpin);
          return true;
        }
      }

      String errorMsg = 'Incorrect MPIN. Please try again.';
      if (response.body != null && response.body is Map && response.body['error'] != null) {
        errorMsg = response.body['error'].toString();
      }
      Get.snackbar(
        'Verification Failed',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      Get.snackbar('Error', 'An error occurred: $e', snackPosition: SnackPosition.BOTTOM);
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Forgot MPIN request (POST /api/mobile/mpin/forgot)
  Future<bool> forgotMpin({
    String? deviceId,
  }) async {
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');
      final effectiveDeviceId = deviceId ?? prefs.getString('deviceId') ?? await getOrCreateDeviceId();

      final response = await _connect.post(
        Api.mpinForgotUrl,
        {
          "deviceId": effectiveDeviceId,
        },
        headers: {
          'Content-Type': 'application/json',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['accessToken'] != null) {
            await prefs.setString('accessToken', data['accessToken']);
          }
          await prefs.remove('mpin');
          await prefs.setBool('isMpinSet', false);
          return true;
        }
      }

      String errorMsg = 'Failed to reset MPIN.';
      if (response.body != null && response.body is Map && response.body['error'] != null) {
        errorMsg = response.body['error'].toString();
      }
      Get.snackbar('Reset Failed', errorMsg, snackPosition: SnackPosition.BOTTOM);
      return false;
    } catch (e) {
      Get.snackbar('Error', 'An error occurred: $e', snackPosition: SnackPosition.BOTTOM);
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Change MPIN for authenticated user (POST /api/mobile/mpin/change)
  Future<bool> changeMpin({
    required String mpin,
    required String confirmMpin,
    String? oldMpin,
  }) async {
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken');

      final Map<String, dynamic> payload = {
        "mpin": mpin,
        "confirmMpin": confirmMpin,
      };
      if (oldMpin != null && oldMpin.isNotEmpty) {
        payload["oldMpin"] = oldMpin;
      }

      final response = await _connect.post(
        Api.mpinChangeUrl,
        payload,
        headers: {
          'Content-Type': 'application/json',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['accessToken'] != null) {
            await prefs.setString('accessToken', data['accessToken']);
          }
          if (data != null && data['refreshToken'] != null) {
            await prefs.setString('refreshToken', data['refreshToken']);
          }
          await prefs.setString('mpin', mpin);
          await prefs.setBool('isMpinSet', true);
          return true;
        }
      }

      String errorMsg = 'Failed to change MPIN.';
      if (response.body != null && response.body is Map && response.body['error'] != null) {
        errorMsg = response.body['error'].toString();
      }
      Get.snackbar('Change Failed', errorMsg, snackPosition: SnackPosition.BOTTOM);
      return false;
    } catch (e) {
      Get.snackbar('Error', 'An error occurred: $e', snackPosition: SnackPosition.BOTTOM);
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
