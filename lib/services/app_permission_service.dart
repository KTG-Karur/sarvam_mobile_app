import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Asks for every runtime permission the app needs up front (right after
/// install / first launch) instead of waiting for the first punch, so Live
/// Tracking and face punch never fail silently on a missing permission.
///
/// Safe to call on every launch: permissions that are already granted (or
/// permanently denied) show no dialog. Never throws — a denied permission must
/// not block login.
class AppPermissionService {
  AppPermissionService._();

  static const _channel = MethodChannel('com.ktg.sarvam/tracking_permissions');
  static const _batteryPromptedKey = 'battery_exemption_prompted_v1';

  static Future<void> requestStartupPermissions() async {
    try {
      await _requestLocation();
      if (defaultTargetPlatform == TargetPlatform.android) {
        await _channel.invokeMethod<bool>('requestNotificationPermission');
        await _channel.invokeMethod<bool>('requestCameraPermission');
        await _requestBatteryExemptionOnce();
      }
    } catch (e) {
      if (kDebugMode) debugPrint('AppPermissionService error: $e');
    }
  }

  static Future<void> _requestLocation() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.always ||
        permission == LocationPermission.deniedForever) {
      return;
    }
    // Play's User Data policy requires an in-app prominent disclosure before
    // any runtime prompt for background location. Declining skips the OS
    // prompts entirely; features that need location ask again when used.
    if (!await _showLocationDisclosure()) return;

    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    // Background ("Allow all the time") is a separate second prompt on
    // Android 10+; Live Tracking needs it once the app is minimised.
    if (permission == LocationPermission.whileInUse) {
      await Geolocator.requestPermission();
    }
  }

  static Future<bool> _showLocationDisclosure() async {
    final accepted = await Get.dialog<bool>(
      PopScope(
        canPop: false,
        child: AlertDialog(
          title: const Text('Location access'),
          content: const SingleChildScrollView(
            child: Text(
              'Sarvam collects location data to enable attendance punch-in/out, '
              'live tracking of field visits, and geotagging of member '
              'verification, collection and disbursement entries, '
              'even when the app is closed or not in use.\n\n'
              'Background location is collected only while you are punched in, '
              'and stops automatically when you punch out. It is shared only '
              'with your authorised managers at Sarvam and is never used for '
              'advertising.\n\n'
              'On the next screen, choose "Allow all the time" to enable live '
              'tracking.',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Get.back(result: false),
              child: const Text('No thanks'),
            ),
            FilledButton(
              onPressed: () => Get.back(result: true),
              child: const Text('Continue'),
            ),
          ],
        ),
      ),
      barrierDismissible: false,
    );
    return accepted ?? false;
  }

  /// How long "Later" silences the location reminder.
  static const Duration _remindAfter = Duration(minutes: 30);
  static DateTime? _snoozedAt;

  /// What still stops Live Tracking from working properly, or null when the
  /// location setup is complete.
  @visibleForTesting
  static String? locationProblem({
    required bool serviceEnabled,
    required LocationPermission permission,
    required bool precise,
  }) {
    if (!serviceEnabled) {
      return 'Location is turned off on this phone. Turn it on.';
    }
    if (permission != LocationPermission.always) {
      return 'Open Permissions, then Location, and choose "Allow all the time".';
    }
    if (!precise) {
      return 'Open Permissions, then Location, and turn on "Use precise location".';
    }
    return null;
  }

  /// Called whenever Live Tracking starts (so only while punched in). Android
  /// does not let an app switch these on itself: this explains what is missing
  /// and opens the settings screen where the employee can set it.
  static Future<void> remindIfLocationIncomplete() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      final permission = await Geolocator.checkPermission();
      final granted =
          permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
      final precise =
          !granted ||
          await Geolocator.getLocationAccuracy() ==
              LocationAccuracyStatus.precise;
      final problem = locationProblem(
        serviceEnabled: serviceEnabled,
        permission: permission,
        precise: precise,
      );
      if (problem == null) {
        _snoozedAt = null;
        return;
      }
      final snoozed = _snoozedAt;
      if (snoozed != null && DateTime.now().difference(snoozed) < _remindAfter) {
        return;
      }
      // No await between this check and showing, so only one can be open.
      if (Get.context == null || Get.isDialogOpen == true) return;
      final open = await Get.dialog<bool>(
        AlertDialog(
          title: const Text('Location setup needed'),
          content: Text(
            'While you are punched in, Sarvam records your location for live '
            'tracking of field visits, even when the app is closed or not in '
            'use.\n\n$problem',
          ),
          actions: [
            TextButton(
              onPressed: () => Get.back(result: false),
              child: const Text('Later'),
            ),
            FilledButton(
              onPressed: () => Get.back(result: true),
              child: const Text('Open settings'),
            ),
          ],
        ),
        barrierDismissible: false,
      );
      if (open != true) {
        _snoozedAt = DateTime.now();
      } else if (!serviceEnabled) {
        await Geolocator.openLocationSettings();
      } else {
        await Geolocator.openAppSettings();
      }
    } catch (e) {
      if (kDebugMode) debugPrint('Location reminder error: $e');
    }
  }

  /// The battery-optimisation screen is a full settings dialog, so show it only
  /// once per install rather than on every launch.
  static Future<void> _requestBatteryExemptionOnce() async {
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool(_batteryPromptedKey) ?? false) return;
    await prefs.setBool(_batteryPromptedKey, true);
    await _channel.invokeMethod<bool>('requestBatteryOptimizationExemption');
  }
}
