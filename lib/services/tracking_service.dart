import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';

/// Live Tracking — POSTs one GPS + battery ping to `/api/hr/tracking/ping`
/// every [_pingInterval] while an employee is punched in, continuing in the
/// background (Android foreground service; best-effort on iOS). Started/
/// stopped from [reconcilePunchPrefs] so it always mirrors the server's
/// punched-in/out truth rather than a single screen's lifecycle.
///
/// Fire-and-forget by design (matches the web/mobile contract): a failed
/// ping is dropped, never surfaced to the user, and never blocks a punch.
class TrackingService {
  TrackingService._();

  static const _pingInterval = Duration(minutes: 3);
  static const _notificationChannelId = 'sarvam_live_tracking';
  static const _notificationId = 8420;

  /// Meters of movement between two pings below which the activity is
  /// reported as IDLE_PING instead of EN_ROUTE.
  static const _idleThresholdMeters = 30.0;

  static bool _configured = false;

  /// Registers the background service definition. Cheap and idempotent —
  /// call once from `main()` before any [start]/[stop] call. Does not start
  /// the service or request any permission by itself.
  static Future<void> init() async {
    if (_configured) return;
    final service = FlutterBackgroundService();
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: _notificationChannelId,
        initialNotificationTitle: 'Sarvam',
        initialNotificationContent: 'Tracking your location while on duty',
        foregroundServiceNotificationId: _notificationId,
        foregroundServiceTypes: [AndroidForegroundType.location],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: _onStart,
        // iOS suspends this quickly once backgrounded; there is no reliable
        // continuous background GPS loop without a location-triggered
        // background mode, which this app does not request. Best-effort only.
        onBackground: null,
      ),
    );
    _configured = true;
  }

  /// Starts (or no-ops if already running) the punched-in tracking loop.
  /// Requests "always" location permission on-device; if that is denied the
  /// service still starts and simply degrades to foreground-only pings
  /// (never blocks or fails the punch flow that called it).
  static Future<void> start() async {
    try {
      await init();
      final service = FlutterBackgroundService();
      final running = await service.isRunning();
      if (running) return;

      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      if (permission == LocationPermission.whileInUse) {
        // Best-effort ask for background access; ignored if the platform/user
        // declines — foreground pings still work.
        await Geolocator.requestPermission();
      }

      await service.startService();
    } catch (e) {
      if (kDebugMode) print('TrackingService.start error: $e');
    }
  }

  /// Stops the tracking loop. Safe to call even if it never started.
  static Future<void> stop() async {
    try {
      final service = FlutterBackgroundService();
      if (await service.isRunning()) {
        service.invoke('stopService');
      }
    } catch (e) {
      if (kDebugMode) print('TrackingService.stop error: $e');
    }
  }

  @pragma('vm:entry-point')
  static void _onStart(ServiceInstance service) async {
    DartPluginRegistrant.ensureInitialized();

    if (service is AndroidServiceInstance) {
      service.setAsForegroundService();
    }

    Position? lastPosition;

    service.on('stopService').listen((event) {
      service.stopSelf();
    });

    Future<void> sendPing() async {
      try {
        final prefs = await SharedPreferences.getInstance();
        final token = prefs.getString('accessToken') ?? '';
        if (token.isEmpty) return;

        final position = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
          ),
        );

        double? batteryPercent;
        try {
          batteryPercent = (await Battery().batteryLevel).toDouble();
        } catch (_) {}

        String activityType = 'EN_ROUTE';
        if (lastPosition != null) {
          final movedMeters = Geolocator.distanceBetween(
            lastPosition!.latitude,
            lastPosition!.longitude,
            position.latitude,
            position.longitude,
          );
          if (movedMeters < _idleThresholdMeters) {
            activityType = 'IDLE_PING';
          }
        }
        lastPosition = position;

        final response = await http
            .post(
              Uri.parse(Api.trackingPingUrl),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
              body: jsonEncode({
                'latitude': position.latitude,
                'longitude': position.longitude,
                'accuracyMeters': position.accuracy,
                if (batteryPercent != null) 'batteryPercent': batteryPercent,
                'activityType': activityType,
              }),
            )
            .timeout(const Duration(seconds: 15));

        if (kDebugMode) {
          debugPrint(
            'Tracking ping: ${response.statusCode} | '
            '${position.latitude}, ${position.longitude} | $activityType',
          );
          if (response.statusCode < 200 || response.statusCode >= 300) {
            debugPrint('Tracking API response: ${response.body}');
          }
        }
      } catch (e) {
        // Fire-and-forget: never surface, never retry-block the next tick.
        if (kDebugMode) print('TrackingService ping error: $e');
      }
    }

    await sendPing();
    Timer.periodic(_pingInterval, (timer) => sendPing());
  }
}
