import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:sarvam/constant/api.dart';

class AppVersionService {
  AppVersionService._();

  /// Calls the server, compares versions, and shows a blocking dialog when the
  /// installed version is older than what the server reports. Returns `true`
  /// when the app may continue (version is fine or the update is optional and
  /// the user chose "Later"), `false` when the dialog is blocking.
  static Future<bool> checkAndPrompt() async {
    try {
      final response = await http
          .get(Uri.parse(Api.appVersionUrl))
          .timeout(const Duration(seconds: 10));

      if (response.statusCode != 200) return true;

      final body = jsonDecode(response.body);
      if (body['success'] != true) return true;

      final data = body['data'];
      final String serverVersion = data['currentVersion'] ?? '';
      final bool isMandatory = data['isMandatory'] ?? false;
      final String? storeUrl = data['storeUrl'];

      if (serverVersion.isEmpty) return true;

      final packageInfo = await PackageInfo.fromPlatform();
      final String appVersion = packageInfo.version;

      if (_compareVersions(appVersion, serverVersion) >= 0) return true;

      // App is outdated — show the update dialog.
      await _showUpdateDialog(
        isMandatory: isMandatory,
        storeUrl: storeUrl,
      );

      // If mandatory the dialog can't be dismissed, so we return false
      // (the caller should not proceed). If optional, the user tapped
      // "Later" which pops the dialog and we return true.
      return !isMandatory;
    } catch (e) {
      debugPrint('App version check failed: $e');
      return true;
    }
  }

  /// Returns negative if [a] < [b], zero if equal, positive if [a] > [b].
  static int _compareVersions(String a, String b) {
    final aParts = a.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final bParts = b.split('.').map((s) => int.tryParse(s) ?? 0).toList();
    final len = aParts.length > bParts.length ? aParts.length : bParts.length;
    for (int i = 0; i < len; i++) {
      final av = i < aParts.length ? aParts[i] : 0;
      final bv = i < bParts.length ? bParts[i] : 0;
      if (av != bv) return av.compareTo(bv);
    }
    return 0;
  }

  static Future<void> _showUpdateDialog({
    required bool isMandatory,
    required String? storeUrl,
  }) async {
    await Get.dialog(
      PopScope(
        canPop: !isMandatory,
        child: AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          title: const Row(
            children: [
              Icon(Icons.system_update, color: Color(0xFF0D6842)),
              SizedBox(width: 8),
              Text('Update Required'),
            ],
          ),
          content: const Text(
            'This version of the app has expired. Please download the latest version to continue using the app.',
          ),
          actions: [
            if (!isMandatory)
              TextButton(
                onPressed: () => Get.back(),
                child: const Text('Later'),
              ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0D6842),
                foregroundColor: Colors.white,
              ),
              onPressed: () => _openUpdateUrl(storeUrl),
              child: const Text('Update'),
            ),
          ],
        ),
      ),
      barrierDismissible: !isMandatory,
    );
  }

  static Future<void> _openUpdateUrl(String? storeUrl) async {
    final String url =
        (storeUrl != null && storeUrl.isNotEmpty) ? storeUrl : 'https://sarvam.nidhimfi.com/';
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }
}
