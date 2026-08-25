import 'dart:io' as io;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:device_info_plus/device_info_plus.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/view/auth/login_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';
import 'package:sarvam/view/auth/face_training_screen.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/services/secure_session_service.dart';

class AuthController extends GetxController {
  final GetConnect _connect = GetConnect();
  final RxBool isLoading = false.obs;

  bool _validMpin(String value) => RegExp(r'^\d{4}$').hasMatch(value);

  /// Requests a one-time login/reset challenge. The server owns expiry and
  /// single-use validation; the app stores only the opaque challenge id.
  Future<bool> sendOtp({required String destination, required String purpose}) async {
    if (destination.trim().isEmpty) return false;
    try {
      isLoading.value = true;
      _connect.timeout = const Duration(seconds: 15);
      final response = await _connect.post(Api.otpSendUrl, {
        'destination': destination.trim(),
        'purpose': purpose,
        'deviceId': await getOrCreateDeviceId(),
      });
      final body = response.body is Map ? response.body as Map : const {};
      if ((response.statusCode == 200 || response.statusCode == 201) && body['success'] != false) {
        final id = (body['data'] is Map ? body['data']['challengeId'] : body['challengeId'])?.toString();
        if (id != null && id.isNotEmpty) await SecureSessionService.savePendingToken(id);
        return true;
      }
      _showAuthError('OTP', body['message']?.toString() ?? 'Unable to send OTP. Please try again.');
      return false;
    } catch (_) {
      _showAuthError('OTP', 'Unable to send OTP. Check your network connection and try again.');
      return false;
    } finally { isLoading.value = false; }
  }

  Future<bool> verifyOtp({required String otp, required String purpose}) async {
    final normalizedOtp = otp.trim();
    if (!RegExp(r'^\d{4,6}$').hasMatch(normalizedOtp)) {
      _showAuthError('Invalid OTP', 'Enter the OTP sent to your registered mobile number.');
      return false;
    }
    if (isLoading.value) return false;

    try {
      isLoading.value = true;
      _connect.timeout = const Duration(seconds: 15);
      final challengeId = await SecureSessionService.readPendingToken();
      if (challengeId == null || challengeId.isEmpty) {
        _showAuthError('OTP verification', 'This OTP request has expired. Please request a new OTP.');
        return false;
      }
      final response = await _connect.post(Api.otpVerifyUrl, {
        'otp': normalizedOtp,
        'purpose': purpose,
        'challengeId': challengeId,
        'deviceId': await getOrCreateDeviceId(),
      });
      final body = response.body is Map ? response.body as Map : const {};
      if ((response.statusCode == 200 || response.statusCode == 201) && body['success'] != false) {
        await SecureSessionService.clearPendingToken();
        return true;
      }
      _showAuthError('OTP verification', body['message']?.toString() ?? 'This OTP is invalid, expired, or has already been used.');
      return false;
    } catch (_) {
      _showAuthError('OTP verification', 'Unable to verify OTP. Check your network connection and try again.');
      return false;
    } finally { isLoading.value = false; }
  }

  void _showAuthError(String title, String message) => Get.snackbar(title, message,
      snackPosition: SnackPosition.BOTTOM, backgroundColor: Colors.redAccent, colorText: Colors.white);

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
          final data = body['data'] is Map ? body['data'] : body;
          final accessToken = data['accessToken'];
          final refreshToken = data['refreshToken'];
          final user = data['user'];
          final branch = data['branch'];
          final bool isMpinSet = data['isMpinSet'] ?? (user != null && user['isMpinSet'] == true);
          final bool requiresMpinSetup = data['requiresMpinSetup'] ?? (!isMpinSet);

          final prefs = await SharedPreferences.getInstance();
          await SecureSessionService.saveTokens(
            accessToken: accessToken?.toString(), refreshToken: refreshToken?.toString());
          
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

          if (requiresMpinSetup || !isMpinSet) {
            await prefs.setBool('isMpinSet', false);
            return true;
          }

          return true;
        }
      }

      String errorMsg = 'Login failed. Invalid credentials.';
      if (response.status.connectionError) {
        errorMsg = 'Network error. Please check internet connection.';
      } else if (response.body != null && response.body is Map) {
        final body = response.body;
        final data = body['data'] is Map ? body['data'] : body;
        final setupToken = data['mpinSetupToken'] ?? body['mpinSetupToken'];
        final loginToken = data['mpinLoginToken'] ?? body['mpinLoginToken'];
        final accessToken = setupToken ?? loginToken ?? data['accessToken'] ?? body['accessToken'];
        final user = data['user'] ?? body['user'];
        final String code = body['code']?.toString() ?? '';

        final prefs = await SharedPreferences.getInstance();
        if (accessToken != null && accessToken.toString().isNotEmpty) {
          await SecureSessionService.savePendingToken(accessToken.toString());
        }

        if (user != null && user is Map) {
          if (user['id'] != null) await prefs.setString('userId', user['id'].toString());
          if (user['employeeId'] != null) await prefs.setString('employeeId', user['employeeId'].toString());
          if (user['firstName'] != null) await prefs.setString('firstName', user['firstName'].toString());
          if (user['lastName'] != null) await prefs.setString('lastName', user['lastName'].toString());
          if (user['role'] != null) await prefs.setString('role', user['role'].toString());
        }

        if (body['error'] != null && body['error'].toString().isNotEmpty) {
          errorMsg = body['error'].toString();
        } else if (body['message'] != null && body['message'].toString().isNotEmpty) {
          errorMsg = body['message'].toString();
        } else if (response.statusText != null && response.statusText!.isNotEmpty) {
          errorMsg = response.statusText!;
        }

        final String lowerError = errorMsg.toLowerCase();

        // 1. Check if MPIN setup is required (MPIN not created yet)
        if (code == 'MPIN_NOT_SET' ||
            data['requiresMpinSetup'] == true ||
            lowerError.contains('mpin is not set') ||
            lowerError.contains('create a new') ||
            lowerError.contains('setup mpin')) {
          await prefs.setBool('isMpinSet', false);
          Get.snackbar(
            'MPIN Required',
            'MPIN is not set. Redirecting to set a 4-digit MPIN...',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
            duration: const Duration(seconds: 2),
          );
          return true;
        }

        // 2. Check if MPIN verification is required (MPIN already created)
        if (code == 'MPIN_REQUIRED' ||
            data['mpinRequired'] == true ||
            lowerError.contains('please enter your mpin') ||
            lowerError.contains('enter your mpin') ||
            lowerError.contains('mpin_required')) {
          await prefs.setBool('isMpinSet', true);
          Get.snackbar(
            'Credentials Verified',
            'Please enter your 4-digit MPIN to complete login.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF008A3D),
            colorText: Colors.white,
            duration: const Duration(seconds: 2),
          );
          return true;
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
    if (!_validMpin(mpin) || mpin != confirmMpin) {
      _showAuthError('MPIN setup', 'MPIN must be four digits and both entries must match.');
      return false;
    }
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = await SecureSessionService.readPendingToken() ?? await SecureSessionService.readAccessToken();

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
            await SecureSessionService.saveTokens(accessToken: data['accessToken'].toString());
          }
          if (data != null && data['refreshToken'] != null) {
            await SecureSessionService.saveTokens(refreshToken: data['refreshToken'].toString());
          }
          await prefs.setBool('isMpinSet', true);
          await SecureSessionService.clearPendingToken();
          return true;
        }
      }

      String errorMsg = 'Failed to set MPIN.';
      if (response.body != null && response.body is Map) {
        final body = response.body;
        if (body['error'] != null && body['error'].toString().isNotEmpty) {
          errorMsg = body['error'].toString();
        } else if (body['message'] != null && body['message'].toString().isNotEmpty) {
          errorMsg = body['message'].toString();
        } else if (response.statusText != null && response.statusText!.isNotEmpty) {
          errorMsg = response.statusText!;
        }
      } else if (response.statusText != null && response.statusText!.isNotEmpty) {
        errorMsg = response.statusText!;
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
    if (!_validMpin(mpin)) {
      _showAuthError('Invalid MPIN', 'MPIN must be exactly four digits.');
      return false;
    }
    try {
      isLoading.value = true;
      final prefs = await SharedPreferences.getInstance();
      final token = await SecureSessionService.readPendingToken() ?? await SecureSessionService.readAccessToken();

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
            await SecureSessionService.saveTokens(accessToken: data['accessToken'].toString());
          }
          if (data != null && data['refreshToken'] != null) {
            await SecureSessionService.saveTokens(refreshToken: data['refreshToken'].toString());
          }
          // On the login-completion call (fresh credential login, not a same-
          // day app-resume unlock) the backend's issueMobileSession() also
          // returns the full user + branch objects — previously only the
          // tokens were read here, so branchId/userId/role etc. were never
          // persisted. Every screen that reads prefs.getString('branchId')
          // (e.g. center creation, branch-location lookups) silently got an
          // empty string as a result.
          if (data != null) {
            final user = data['user'];
            if (user is Map) {
              if (user['id'] != null) await prefs.setString('userId', user['id'].toString());
              if (user['employeeId'] != null) await prefs.setString('employeeId', user['employeeId'].toString());
              if (user['mobileNumber'] != null) await prefs.setString('mobileNumber', user['mobileNumber'].toString());
              if (user['email'] != null) await prefs.setString('email', user['email'].toString());
              if (user['firstName'] != null) await prefs.setString('firstName', user['firstName'].toString());
              if (user['lastName'] != null) await prefs.setString('lastName', user['lastName'].toString());
              if (user['role'] != null) await prefs.setString('role', user['role'].toString());
              if (user['rbacRoleName'] != null) await prefs.setString('rbacRoleName', user['rbacRoleName'].toString());

              final assignedBranchIds = user['assignedBranchIds'];
              if (assignedBranchIds is List && assignedBranchIds.isNotEmpty) {
                await prefs.setStringList(
                  'assignedBranchIds',
                  assignedBranchIds.map((e) => e.toString()).toList(),
                );
              }
            }
            final branch = data['branch'];
            if (branch is Map) {
              if (branch['id'] != null) await prefs.setString('branchId', branch['id'].toString());
              if (branch['name'] != null) await prefs.setString('branchName', branch['name'].toString());
              if (branch['code'] != null) await prefs.setString('branchCode', branch['code'].toString());
            }
          }
          await SecureSessionService.clearPendingToken();
          return true;
        }
      }

      String errorMsg = 'Incorrect MPIN. Please try again.';
      if (response.body != null && response.body is Map) {
        final map = response.body as Map;
        if (map['message'] != null && map['message'].toString().isNotEmpty) {
          errorMsg = map['message'].toString();
        } else if (map['error'] != null && map['error'].toString().isNotEmpty) {
          errorMsg = map['error'].toString();
        }
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
      final token = await SecureSessionService.readPendingToken() ?? await SecureSessionService.readAccessToken();
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
            await SecureSessionService.saveTokens(accessToken: data['accessToken'].toString());
          }
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
      final token = await SecureSessionService.readPendingToken() ?? await SecureSessionService.readAccessToken();

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
            await SecureSessionService.saveTokens(accessToken: data['accessToken'].toString());
          }
          if (data != null && data['refreshToken'] != null) {
            await SecureSessionService.saveTokens(refreshToken: data['refreshToken'].toString());
          }
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

  /// Displays a confirmation modal before logging out.
  void confirmLogout(BuildContext context) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.logout_rounded, color: Colors.redAccent),
            SizedBox(width: 8),
            Text(
              'Confirm Logout',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
            ),
          ],
        ),
        content: const Text(
          'Are you sure you want to logout?',
          style: TextStyle(fontSize: 13, color: Color(0xFF475569)),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B))),
          ),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.redAccent,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text('Logout'),
            onPressed: () {
              Navigator.pop(ctx);
              logout();
            },
          ),
        ],
      ),
    );
  }

  Future<void> logout() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await SecureSessionService.clearSession();
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
      await prefs.remove('lastPunchInDate');

      final bool isMpinSet = prefs.getBool('isMpinSet') ?? false;

      final enrolled = await FaceBiometricService.getEnrolledFeatures();
      final bool isFaceEnrolled = enrolled.isNotEmpty ||
          (prefs.getBool('faceEnrollmentCompleted') ?? false);

      if (isMpinSet && !isFaceEnrolled) {
        Get.offAll(() => const FaceTrainingScreen(autoStart: true));
      } else if (isMpinSet && isFaceEnrolled) {
        Get.offAll(() => const MpinLoginScreen());
      } else {
        Get.offAll(() => const LoginScreen());
      }
    } catch (e) {
      Get.snackbar(
        'Logout Error',
        'Failed to log out correctly: $e',
        snackPosition: SnackPosition.BOTTOM,
      );
    }
  }
}
