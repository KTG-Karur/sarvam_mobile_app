import 'dart:async';
import 'dart:convert';
import 'dart:ui';

import 'package:battery_plus/battery_plus.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';

/// Background-service entry point. Must be a top-level function so the
/// plugin can resolve it from a callback handle inside the service isolate;
/// a private static method there is silently never invoked.
@pragma('vm:entry-point')
void trackingServiceEntryPoint(ServiceInstance service) =>
    TrackingService._onStart(service);

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

  static const _notificationId = 8420;
  static const _offlineQueueKey = 'pending_live_tracking_pings_v1';
  static const _maxOfflineQueueSize = 1000;
  static const _permissionChannel = MethodChannel(
    'com.ktg.sarvam/tracking_permissions',
  );

  /// A new route point is uploaded only after this much real-world movement.
  /// This prevents a stationary employee's current GPS coordinate from being
  /// repeatedly added to the route. The initial punch-in location is still
  /// always recorded.
  static const int _minimumMovementMeters = 50;

  static bool _configured = false;
  static bool _debugRestartDone = false;

  /// Lifecycle logging that also shows in profile/release builds (view with
  /// `adb logcat -s flutter`). The background service runs in its own isolate,
  /// so its output is easy to miss unless every step reports in.
  // ignore: avoid_print
  static void _log(String message) => print('Tracking: $message');

  /// Uploads every stored point in capture order. A failed request deliberately
  /// leaves that row (and all newer rows) in the queue, preventing a Wi-Fi ↔
  /// mobile-data handoff from reordering the route on the server.
  static Future<void> _syncOfflineQueue(
    SharedPreferences prefs,
    String token,
  ) async {
    final raw = prefs.getString(_offlineQueueKey);
    if (raw == null || raw.isEmpty) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return;
      final queue = decoded.whereType<Map>().map((entry) {
        return Map<String, dynamic>.from(entry);
      }).toList();
      var synced = 0;
      for (final payload in queue) {
        final response = await http
            .post(
              Uri.parse(Api.trackingPingUrl),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
              body: jsonEncode(payload),
            )
            .timeout(const Duration(seconds: 15));
        if (response.statusCode < 200 || response.statusCode >= 300) break;
        synced++;
      }
      if (synced > 0) {
        queue.removeRange(0, synced);
        await prefs.setString(_offlineQueueKey, jsonEncode(queue));
      }
    } catch (_) {
      // Stay queued. The next periodic tick retries after any network switch.
    }
  }

  static Future<void> _queueOfflinePing(
    SharedPreferences prefs,
    Map<String, dynamic> payload,
  ) async {
    try {
      final raw = prefs.getString(_offlineQueueKey);
      final decoded = raw == null ? null : jsonDecode(raw);
      final queue = decoded is List
          ? decoded.whereType<Map>().map(Map<String, dynamic>.from).toList()
          : <Map<String, dynamic>>[];
      queue.add(payload);
      if (queue.length > _maxOfflineQueueSize) {
        queue.removeRange(0, queue.length - _maxOfflineQueueSize);
      }
      await prefs.setString(_offlineQueueKey, jsonEncode(queue));
    } catch (_) {
      // Storage errors must never stop GPS collection or the foreground service.
    }
  }

  /// Registers the background service definition. Cheap and idempotent —
  /// call once from `main()` before any [start]/[stop] call. Does not start
  /// the service or request any permission by itself.
  static Future<void> init() async {
    if (_configured) return;
    final service = FlutterBackgroundService();
    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: trackingServiceEntryPoint,
        autoStart: false,
        isForegroundMode: true,
        // Do not supply a custom channel ID here. The Android plugin creates
        // its own FOREGROUND_DEFAULT channel synchronously before calling
        // startForeground; a missing custom channel caused release APKs to
        // crash after MPIN with CannotPostForegroundServiceNotificationException.
        initialNotificationTitle: 'Sarvam',
        initialNotificationContent: 'Tracking your location while on duty',
        foregroundServiceNotificationId: _notificationId,
        foregroundServiceTypes: [AndroidForegroundType.location],
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: trackingServiceEntryPoint,
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
      _log('start() requested');
      await init();
      final service = FlutterBackgroundService();
      var running = await service.isRunning();
      // Nothing left over from an earlier launch, so no recycle is needed.
      if (!running) _debugRestartDone = true;
      if (running && kDebugMode && !_debugRestartDone) {
        // The service isolate keeps the code it was launched with, so a hot
        // reload/restart leaves a stale one behind. Recycle it once per app
        // launch so debug runs always use the current code.
        _debugRestartDone = true;
        _log('restarting leftover service to pick up current code');
        service.invoke('stopService');
        for (var i = 0; i < 20 && running; i++) {
          await Future<void>.delayed(const Duration(milliseconds: 250));
          running = await service.isRunning();
        }
      }
      if (running) {
        _log('service is already running');
        return;
      }

      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        _log('location service is disabled');
        await Geolocator.openLocationSettings();
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _log('location permission denied ($permission)');
        return;
      }
      if (defaultTargetPlatform == TargetPlatform.android) {
        // Oppo/Android battery management can terminate even foreground GPS
        // work after the task is swiped away. Ask once for the OS-approved
        // exemption; a user can decline without blocking punch-in.
        await _permissionChannel.invokeMethod<bool>(
          'requestBatteryOptimizationExemption',
        );
      }

      if (defaultTargetPlatform == TargetPlatform.android) {
        // A denied notification permission does not prevent Android from
        // running a foreground service. Keep capturing the route; Android
        // exposes the service notice in Task Manager in that case.
        await _permissionChannel.invokeMethod<bool>(
          'requestNotificationPermission',
        );
      }

      await service.startService();
      _log('background service started');
    } catch (e) {
      _log('start error: $e');
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
      _log('stop error: $e');
    }
  }

  @pragma('vm:entry-point')
  static void _onStart(ServiceInstance service) async {
    DartPluginRegistrant.ensureInitialized();
    _log('service isolate started');

    if (service is AndroidServiceInstance) {
      service.setAsForegroundService();
    }

    Position? lastUploadedPosition;
    StreamSubscription<List<ConnectivityResult>>? connectivitySubscription;
    StreamSubscription<Position>? positionSubscription;

    service.on('stopService').listen((event) {
      connectivitySubscription?.cancel();
      positionSubscription?.cancel();
      service.stopSelf();
    });

    Future<void> sendPing(Position position, {required bool isInitialPoint}) async {
      SharedPreferences? prefs;
      Map<String, dynamic>? payload;
      try {
        prefs = await SharedPreferences.getInstance();
        final token = prefs.getString('accessToken') ?? '';
        if (token.isEmpty) {
          _log('ping skipped (no access token)');
          return;
        }

        // Upload captures made with no network before adding the newest one;
        // this preserves the real movement order after Wi-Fi/mobile switches.
        await _syncOfflineQueue(prefs, token);

        if (!isInitialPoint && lastUploadedPosition != null) {
          final movedMeters = Geolocator.distanceBetween(
            lastUploadedPosition!.latitude,
            lastUploadedPosition!.longitude,
            position.latitude,
            position.longitude,
          );
          if (movedMeters < _minimumMovementMeters) {
            _log(
              'point skipped (${movedMeters.toStringAsFixed(0)}m < '
              '${_minimumMovementMeters.toStringAsFixed(0)}m)',
            );
            return;
          }
        }

        double? batteryPercent;
        try {
          batteryPercent = (await Battery().batteryLevel).toDouble();
        } catch (_) {}

        // Mark this fix before the request. If connectivity is unavailable it
        // is queued below, so subsequent stream events cannot add the same
        // current location a second time.
        lastUploadedPosition = position;

        payload = <String, dynamic>{
          'latitude': position.latitude,
          'longitude': position.longitude,
          'accuracyMeters': position.accuracy,
          if (batteryPercent != null) 'batteryPercent': batteryPercent,
          'activityType': 'EN_ROUTE',
          'capturedAt': DateTime.now().toUtc().toIso8601String(),
        };
        if (kDebugMode) {
          debugPrint(
            'Tracking: GPS ${position.latitude.toStringAsFixed(6)}, '
            '${position.longitude.toStringAsFixed(6)} '
            '(accuracy ${position.accuracy.toStringAsFixed(0)}m, '
            'EN_ROUTE)',
          );
        }

        final response = await http
            .post(
              Uri.parse(Api.trackingPingUrl),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
              body: jsonEncode(payload),
            )
            .timeout(const Duration(seconds: 15));

        if (kDebugMode) {
          debugPrint(
            'Tracking ping: ${response.statusCode} | '
            '${position.latitude}, ${position.longitude} | EN_ROUTE',
          );
          if (response.statusCode < 200 || response.statusCode >= 300) {
            debugPrint('Tracking API response: ${response.body}');
          }
        }
        // Network/server failures are saved locally. Do not queue client-side
        // validation errors (4xx), which will never succeed on retry.
        if (response.statusCode >= 500) {
          await _queueOfflinePing(prefs, payload);
        }
      } catch (e) {
        // No connection (or a Wi-Fi/mobile handoff): the GPS fix is retained
        // locally and retried in capture order once a later tick has internet.
        try {
          final localPrefs = prefs ?? await SharedPreferences.getInstance();
          // GPS errors have no payload; HTTP/network errors keep this capture.
          if (payload != null) {
            await _queueOfflinePing(localPrefs, payload);
          }
        } catch (_) {}
        _log('ping error: $e');
      }
    }

    // Record the punch-in position once. Subsequent points come from the
    // platform GPS stream only after at least 50m of movement.
    try {
      final initialPosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 30),
        ),
      );
      await sendPing(initialPosition, isInitialPoint: true);
    } on TimeoutException {
      final fallback = await Geolocator.getLastKnownPosition();
      if (fallback != null) {
        await sendPing(fallback, isInitialPoint: true);
      } else {
        _log('initial point skipped (GPS fix timed out)');
      }
    } catch (error) {
      _log('initial point error: $error');
    }

    positionSubscription = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: _minimumMovementMeters,
      ),
    ).listen(
      (position) => unawaited(sendPing(position, isInitialPoint: false)),
      onError: (Object error) => _log('GPS stream error: $error'),
    );
    // A Wi-Fi ↔ mobile-data change triggers an immediate ordered queue sync;
    // tracking itself never stops while the device is offline.
    connectivitySubscription = Connectivity().onConnectivityChanged.listen((
      results,
    ) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        final sync = () async {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('accessToken') ?? '';
          if (token.isNotEmpty) await _syncOfflineQueue(prefs, token);
        }();
        unawaited(sync);
      }
    });
  }
}
