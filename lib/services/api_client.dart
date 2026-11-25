import 'dart:async';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/secure_session_service.dart';

/// One refresh at a time across every ApiClient instance.
Completer<void>? _refreshInFlight;

class ApiClient extends GetConnect {
  ApiClient() {
    onInit();
  }

  @override
  void onInit() {
    httpClient.timeout = const Duration(seconds: 45);
    httpClient.maxAuthRetries = 1;
    allowAutoSignedCert = false;

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
      final hasContentType = request.headers.keys.any(
        (key) => key.toLowerCase() == 'content-type',
      );
      if (!hasContentType) {
        request.headers['Content-Type'] = 'application/json';
      }
      return request;
    });

    // Handle 401 by attempting a single shared token refresh.
    httpClient.addAuthenticator<dynamic>((request) async {
      // Extract the token this request was sent with.
      final sentToken = (request.headers['Authorization'] ?? '')
          .toString()
          .replaceFirst('Bearer ', '');

      final prefs = await SharedPreferences.getInstance();

      // If the stored token already differs from what was sent, another refresh
      // already completed — just retry with the current token, no refresh needed.
      final storedToken = prefs.getString('accessToken') ?? '';
      if (storedToken.isNotEmpty && storedToken != sentToken) {
        request.headers['Authorization'] = 'Bearer $storedToken';
        return request;
      }

      // Only one refresh at a time. Others wait for the in-flight one.
      if (_refreshInFlight != null) {
        await _refreshInFlight!.future;
        final latestToken = prefs.getString('accessToken') ?? '';
        if (latestToken.isNotEmpty) {
          request.headers['Authorization'] = 'Bearer $latestToken';
        }
        return request;
      }

      final completer = Completer<void>();
      _refreshInFlight = completer;
      try {
        final refreshToken = prefs.getString('refreshToken') ?? '';
        if (refreshToken.isEmpty) {
          _showSignInPrompt();
          return request;
        }

        final refreshConnect = GetConnect(
          timeout: const Duration(seconds: 15),
        );
        final response = await refreshConnect.post(
          '${Api.baseUrl}/api/auth/refresh',
          {'refreshToken': refreshToken},
          headers: {'Cookie': 'refreshToken=$refreshToken'},
        );

        if (response.statusCode == 200 || response.statusCode == 201) {
          final body = response.body;
          if (body != null && body['success'] == true) {
            final data = body['data'];
            final newAccessToken = (data['accessToken'] ?? '') as String;
            final newRefreshToken = (data['refreshToken'] ?? '') as String;
            await SecureSessionService.saveTokens(
              accessToken: newAccessToken,
              refreshToken: newRefreshToken.isNotEmpty ? newRefreshToken : null,
            );
            request.headers['Authorization'] = 'Bearer $newAccessToken';
            return request;
          }
        }

        // 403 with account inactive/exited → real logout.
        if (response.statusCode == 403) {
          final msg = (response.body is Map
                  ? response.body['message']
                  : null)
              ?.toString()
              .toLowerCase() ??
              '';
          if (msg.contains('inactive') || msg.contains('has exited')) {
            await _forceLogout();
            return request;
          }
        }

        // 400, 401, any other 403, or missing refresh token → show sign-in
        // prompt but keep tokens and queue intact. Do NOT log out.
        if (response.statusCode == 400 ||
            response.statusCode == 401 ||
            response.statusCode == 403) {
          _showSignInPrompt();
          return request;
        }

        // 5xx, timeout, no network → keep everything, retry later.
        debugPrint(
          'ApiClient: token refresh got ${response.statusCode}, '
          'retaining session for retry.',
        );
      } catch (e) {
        debugPrint('ApiClient: token refresh network error: $e');
      } finally {
        completer.complete();
        _refreshInFlight = null;
      }

      return request;
    });
  }

  /// Only called when the account is deactivated (the only automatic logout).
  static Future<void> _forceLogout() async {
    try {
      // Avoid import cycle: auth_controller imports api_client indirectly,
      // so look it up via Get rather than importing directly.
      final dynamic auth = Get.isRegistered(tag: 'AuthController')
          ? Get.find(tag: 'AuthController')
          : null;
      if (auth != null) {
        await (auth as dynamic).logout();
      }
    } catch (_) {}
  }

  /// Shown when a refresh fails with a non-fatal error. Does NOT clear the
  /// session — the employee stays punched in and tracking continues.
  static bool _signInPromptShown = false;
  static void _showSignInPrompt() {
    if (_signInPromptShown) return;
    _signInPromptShown = true;
    // Show once; the employee tapping "Sign in" will dismiss it.
    Get.dialog(
      AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Session Expired'),
        content: const Text(
          'Please sign in again to continue. '
          'Your tracking and queued data are safe.',
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0D6842),
              foregroundColor: Colors.white,
            ),
            onPressed: () {
              _signInPromptShown = false;
              Get.back();
              // Navigate to login without clearing the session.
              Get.toNamed('/login');
            },
            child: const Text('Sign in'),
          ),
        ],
      ),
      barrierDismissible: false,
    );
  }
}
