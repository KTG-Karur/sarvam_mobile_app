import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
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
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    // Background ("Allow all the time") is a separate second prompt on
    // Android 10+; Live Tracking needs it once the app is minimised.
    if (permission == LocationPermission.whileInUse) {
      await Geolocator.requestPermission();
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
