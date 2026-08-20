import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/controller/auth_controller.dart';

class ApiClient extends GetConnect {
  ApiClient() {
    onInit();
  }

  @override
  void onInit() {
    httpClient.timeout = const Duration(seconds: 45);
    httpClient.maxAuthRetries = 1;
    allowAutoSignedCert = true;

    // Attach Access Token automatically to outgoing requests if not manually defined
    httpClient.addRequestModifier<dynamic>((request) async {
      final hasAuthHeader = request.headers.keys.any(
        (key) => key.toLowerCase() == 'authorization',
      );
      if (!hasAuthHeader) {
        final prefs = await SharedPreferences.getInstance();
        final accessToken = prefs.getString('accessToken') ?? '';
        if (accessToken.isNotEmpty) {
          request.headers['Authorization'] = 'Bearer $accessToken';
        }
      }
      // Headers set earlier in the pipeline (e.g. the multipart boundary
      // GetConnect sets for FormData bodies) use a lowercase key, so this
      // check must be case-insensitive or it'll add a second, conflicting
      // 'Content-Type: application/json' header that wins on the wire.
      final hasContentType = request.headers.keys.any(
        (key) => key.toLowerCase() == 'content-type',
      );
      if (!hasContentType) {
        request.headers['Content-Type'] = 'application/json';
      }
      return request;
    });

    // Handle 401 Unauthorized by attempting token refresh or logging out
    httpClient.addAuthenticator<dynamic>((request) async {
      final prefs = await SharedPreferences.getInstance();
      final refreshToken = prefs.getString('refreshToken') ?? '';

      if (refreshToken.isEmpty) {
        await _handleLogout();
        return request;
      }

      try {
        final refreshConnect = GetConnect(timeout: const Duration(seconds: 15));
        final refreshUrl = "${Api.baseUrl}/api/auth/refresh";

        final response = await refreshConnect.post(
          refreshUrl,
          {
            "refreshToken": refreshToken,
          },
          headers: {
            'Cookie': 'refreshToken=$refreshToken',
          },
        );

        if (response.statusCode == 200 || response.statusCode == 201) {
          final body = response.body;
          if (body != null && body['success'] == true) {
            final data = body['data'];
            final newAccessToken = data['accessToken'] ?? '';
            final newRefreshToken = data['refreshToken'] ?? '';

            await prefs.setString('accessToken', newAccessToken);
            if (newRefreshToken.isNotEmpty) {
              await prefs.setString('refreshToken', newRefreshToken);
            }

            request.headers['Authorization'] = 'Bearer $newAccessToken';
            return request;
          }
        }

        // Only log out if the backend explicitly invalidates/rejects the refresh token (400/401/403).
        // Transient network glitches or server errors (50x/timeouts) should NOT wipe user session.
        if (response.statusCode == 400 ||
            response.statusCode == 401 ||
            response.statusCode == 403) {
          debugPrint("Refresh token invalid or expired (status ${response.statusCode}). Logging out.");
          await _handleLogout();
        } else {
          debugPrint("Token refresh encounter status ${response.statusCode}. Retaining session for offline resilience.");
        }
      } catch (e) {
        debugPrint("Token refresh failed with network exception: $e. Retaining session.");
      }

      return request;
    });
  }

  Future<void> _handleLogout() async {
    final authController = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : Get.put(AuthController());
    await authController.logout();
    
    Get.snackbar(
      'Session Expired',
      'Your session has expired. Please login again.',
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.redAccent,
      colorText: Colors.white,
    );
  }
}
