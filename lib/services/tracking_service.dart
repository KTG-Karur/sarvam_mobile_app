import 'dart:async';
import 'dart:convert';
import 'dart:math';
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
import 'package:sarvam/services/tracking_outbox.dart';
import 'package:sarvam/services/tracking_watchdog.dart';

/// Background-service entry point. Must be a top-level function so the
/// plugin can resolve it from a callback handle inside the service isolate;
/// a private static method there is silently never invoked.
@pragma('vm:entry-point')
void trackingServiceEntryPoint(ServiceInstance service) =>
    TrackingService._onStart(service);

enum _UploadOutcome { done, retryLater }

/// Live Tracking — records GPS + battery fixes while an employee is punched in,
/// continuing in the background (Android foreground service; best-effort on
/// iOS), and uploads them to `/api/hr/tracking/ping` in batches. Started/
/// stopped from [reconcilePunchPrefs] so it always mirrors the server's
/// punched-in/out truth rather than a single screen's lifecycle.
///
/// Every fix is written to the local SQLite [TrackingOutbox] first and removed
/// only after the server has answered for it, so a killed app, a dead network or
/// a restart loses nothing. A watchdog ([TrackingWatchdog]) restarts the service
/// if the phone's battery manager kills it while the employee is still on shift.
///
/// Fire-and-forget by design (matches the web/mobile contract): a failed
/// upload is retried later, never surfaced to the user, and never blocks a punch.
/// See docs/live_tracking_mobile_spec.md.
class TrackingService {
  TrackingService._();

  static const _notificationId = 8420;

  /// Pre-outbox queue (a JSON list in SharedPreferences). Imported once, then removed.
  static const _legacyQueueKey = 'pending_live_tracking_pings_v1';
  static const _permissionChannel = MethodChannel(
    'com.ktg.sarvam/tracking_permissions',
  );

  /// Written when tracking starts (today's date) and cleared when it stops. The
  /// watchdog only restarts the service while this says "tracking is meant to run today".
  static const _shouldRunKey = 'tracking_should_run_date';

  /// Last time the service isolate proved it is alive (a fix or a heartbeat tick).
  static const _lastAliveKey = 'tracking_last_alive_ms';

  /// The watchdog restarts the service when it has been silent for this long.
  /// The heartbeat fires every 90-180 s, so this is several missed heartbeats.
  static const Duration _watchdogSilence = Duration(minutes: 5);

  /// A new route point is uploaded only after this much real-world movement.
  /// This prevents a stationary employee's current GPS coordinate from being
  /// repeatedly added to the route. The initial punch-in location is still
  /// always recorded.
  static const int _minimumMovementMeters = 30;

  /// Route points from a fix with a worse reported accuracy than this are
  /// dropped (the punch-in point is exempt so a route always has a start).
  static const int _maxAccuracyMeters = 25;

  /// When nothing has been captured for this long (a phone sitting still sends
  /// nothing under the 30 m rule), one fresh fix is recorded as an `IDLE_PING`.
  /// It tells the server the app is alive and where the employee is, so a quiet
  /// stretch can be told apart from tracking that died.
  static const Duration _heartbeatInterval = Duration(seconds: 90);

  /// Fixes are uploaded together: at least this often while any are waiting...
  static const Duration _flushInterval = Duration(seconds: 30);

  /// ...immediately once this many are waiting...
  static const int _flushThreshold = 50;

  /// ...and never more than this many in one request (the server allows 500).
  static const int _batchSize = 100;

  static final Random _random = Random();

  /// Unique per fix and kept with it in the outbox, so a retried upload
  /// (lost response, replay) is recognised by the server and stored once.
  static String _newPingId() =>
      '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-'
      '${_random.nextInt(0x7fffffff).toRadixString(36)}';

  static bool _configured = false;
  static bool _debugRestartDone = false;

  /// Lifecycle logging that also shows in profile/release builds (view with
  /// `adb logcat -s flutter`). The background service runs in its own isolate,
  /// so its output is easy to miss unless every step reports in.
  // ignore: avoid_print
  static void _log(String message) => print('Tracking: $message');

  static String _todayKey() {
    final now = DateTime.now();
    final month = now.month.toString().padLeft(2, '0');
    final day = now.day.toString().padLeft(2, '0');
    return '${now.year}-$month-$day';
  }

  /// The moment the GPS fix was taken. Phones deliver buffered fixes in bursts,
  /// so stamping with "now" gave dozens of fixes hundreds of metres apart the
  /// same timestamp and the server threw them away as impossible jumps. A clock
  /// that is clearly wrong falls back to now.
  static DateTime _capturedAt(Position position) {
    final now = DateTime.now().toUtc();
    final fixTime = position.timestamp.toUtc();
    final skew = fixTime.difference(now).abs();
    return skew > const Duration(hours: 12) ? now : fixTime;
  }

  static Future<void> _markShouldRun(bool on) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (on) {
        await prefs.setString(_shouldRunKey, _todayKey());
      } else {
        await prefs.remove(_shouldRunKey);
      }
    } catch (_) {
      // Never let bookkeeping stop tracking.
    }
  }

  /// Moves fixes left in the old SharedPreferences queue into the outbox, once.
  static Future<void> _migrateLegacyQueue() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.reload();
      final raw = prefs.getString(_legacyQueueKey);
      if (raw == null || raw.isEmpty) return;
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        for (final entry in decoded.whereType<Map>()) {
          final payload = Map<String, dynamic>.from(entry);
          final id = (payload['clientPingId'] as String?) ?? _newPingId();
          payload['clientPingId'] = id;
          final captured = DateTime.tryParse(
            (payload['capturedAt'] as String?) ?? '',
          );
          await TrackingOutbox.add(
            clientPingId: id,
            capturedAtMs: (captured ?? DateTime.now().toUtc())
                .millisecondsSinceEpoch,
            payload: jsonEncode(payload),
          );
        }
      }
      await prefs.remove(_legacyQueueKey);
      _log('imported the old queue into the outbox');
    } catch (e) {
      _log('legacy queue import skipped: $e');
    }
  }

  /// Uploads [rows] (oldest first) as one batch and removes the rows the server
  /// has answered for. The server validates every item on its own and replies
  /// per item (`accepted`, `duplicate` or `invalid`); all three mean "stop
  /// sending this one", so they are all removed. Anything temporary (no network,
  /// 401 expired token, 408, 429, 5xx) keeps the rows for the next attempt.
  static Future<_UploadOutcome> _uploadBatch(
    List<TrackingOutboxRow> rows,
    String token,
  ) async {
    final ids = rows.map((r) => r.id).toList();
    try {
      final response = await http
          .post(
            Uri.parse(Api.trackingPingUrl),
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: '[${rows.map((r) => r.payload).join(',')}]',
          )
          .timeout(const Duration(seconds: 20));
      final code = response.statusCode;
      if (code >= 200 && code < 300) {
        _logBatchResult(response.body, rows.length);
        await TrackingOutbox.delete(ids);
        return _UploadOutcome.done;
      }
      if (code == 400 || code == 422) {
        // The server refused the request. If it lists per-item results, every
        // item was invalid and will never succeed; otherwise find the culprit
        // by sending the fixes one at a time.
        if (_bodyHasResults(response.body)) {
          _log('batch of ${rows.length} rejected as invalid ($code): dropped');
          await TrackingOutbox.delete(ids);
          return _UploadOutcome.done;
        }
        return await _uploadOneByOne(rows, token);
      }
      _log('upload will retry (status $code)');
      await TrackingOutbox.markAttempt(ids);
      return _UploadOutcome.retryLater;
    } catch (e) {
      _log('upload will retry ($e)');
      await TrackingOutbox.markAttempt(ids);
      return _UploadOutcome.retryLater;
    }
  }

  static Future<_UploadOutcome> _uploadOneByOne(
    List<TrackingOutboxRow> rows,
    String token,
  ) async {
    for (final row in rows) {
      try {
        final response = await http
            .post(
              Uri.parse(Api.trackingPingUrl),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer $token',
              },
              body: row.payload,
            )
            .timeout(const Duration(seconds: 15));
        final code = response.statusCode;
        if ((code >= 200 && code < 300) || code == 400 || code == 422) {
          if (code >= 400) _log('one fix dropped (rejected $code)');
          await TrackingOutbox.delete([row.id]);
          continue;
        }
        await TrackingOutbox.markAttempt([row.id]);
        return _UploadOutcome.retryLater;
      } catch (_) {
        await TrackingOutbox.markAttempt([row.id]);
        return _UploadOutcome.retryLater;
      }
    }
    return _UploadOutcome.done;
  }

  static bool _bodyHasResults(String body) {
    try {
      final decoded = jsonDecode(body);
      final data = decoded is Map ? decoded['data'] : null;
      return data is Map && data['results'] is List;
    } catch (_) {
      return false;
    }
  }

  static void _logBatchResult(String body, int sent) {
    try {
      final decoded = jsonDecode(body);
      final data = decoded is Map ? decoded['data'] : null;
      if (data is Map) {
        _log(
          'uploaded $sent (stored ${(data['pings'] ?? 0) + (data['events'] ?? 0)}, '
          'duplicate ${data['duplicates'] ?? 0}, invalid ${data['invalid'] ?? 0})',
        );
        return;
      }
    } catch (_) {}
    _log('uploaded $sent');
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
        await _markShouldRun(true);
        await TrackingWatchdog.schedule();
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
      await _markShouldRun(true);
      await TrackingWatchdog.schedule();
      _log('background service started');
    } catch (e) {
      _log('start error: $e');
    }
  }

  /// Stops the tracking loop. Safe to call even if it never started. The
  /// service uploads whatever is still waiting before it shuts down.
  static Future<void> stop() async {
    try {
      // Cleared first, so the watchdog can never bring the service back after
      // a punch-out.
      await _markShouldRun(false);
      await TrackingWatchdog.cancel();
      final service = FlutterBackgroundService();
      if (await service.isRunning()) {
        service.invoke('stopService');
      }
    } catch (e) {
      _log('stop error: $e');
    }
  }

  /// Called by the watchdog task (a separate, short-lived isolate): if tracking
  /// is meant to be running today but the service has gone silent and is no
  /// longer running, start it again. Needs no network and no UI.
  static Future<void> restartIfStopped() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.reload();
    if (prefs.getString(_shouldRunKey) != _todayKey()) return; // not tracking today
    if ((prefs.getString('accessToken') ?? '').isEmpty) return; // logged out
    final lastAlive = prefs.getInt(_lastAliveKey) ?? 0;
    final silentFor = DateTime.now().millisecondsSinceEpoch - lastAlive;
    if (silentFor < _watchdogSilence.inMilliseconds) return;

    await init();
    final service = FlutterBackgroundService();
    if (await service.isRunning()) return; // alive but quiet (e.g. GPS off): restarting would not help
    _log('watchdog: service was not running, starting it again');
    await service.startService();
  }

  @pragma('vm:entry-point')
  static void _onStart(ServiceInstance service) async {
    DartPluginRegistrant.ensureInitialized();
    _log('service isolate started');

    if (service is AndroidServiceInstance) {
      service.setAsForegroundService();
    }

    Position? lastUploadedPosition;
    DateTime? lastCaptureAt;
    var lastFlushAt = DateTime.fromMillisecondsSinceEpoch(0);
    var lastPruneAt = DateTime.fromMillisecondsSinceEpoch(0);
    var nextFlushAllowed = DateTime.fromMillisecondsSinceEpoch(0);
    var backoff = Duration.zero;
    var flushing = false;
    StreamSubscription<List<ConnectivityResult>>? connectivitySubscription;
    StreamSubscription<Position>? positionSubscription;
    Timer? flushTimer;
    Timer? heartbeatTimer;
    // Fixes are handled one at a time, in the order received: the position
    // stream can hand over a burst, and overlapping calls raced on the
    // last-uploaded position.
    Future<void> chain = Future<void>.value();

    Future<void> touchAlive() async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setInt(_lastAliveKey, DateTime.now().millisecondsSinceEpoch);
      } catch (_) {}
    }

    /// Sends everything waiting, oldest first, in batches. One run at a time.
    /// [force] ignores the retry back-off (used on reconnect and on shutdown).
    Future<void> flush({bool force = false}) async {
      if (flushing) return;
      if (!force && DateTime.now().isBefore(nextFlushAllowed)) return;
      flushing = true;
      try {
        final prefs = await SharedPreferences.getInstance();
        // The app (a different isolate) refreshes the access token; pick up its copy.
        await prefs.reload();
        final token = prefs.getString('accessToken') ?? '';
        if (token.isEmpty) return;
        if (DateTime.now().difference(lastPruneAt) > const Duration(hours: 1)) {
          lastPruneAt = DateTime.now();
          final removed = await TrackingOutbox.prune();
          if (removed > 0) _log('outbox: dropped $removed old fixes');
        }
        while (true) {
          final rows = await TrackingOutbox.oldest(_batchSize);
          if (rows.isEmpty) {
            backoff = Duration.zero;
            break;
          }
          final outcome = await _uploadBatch(rows, token);
          if (outcome == _UploadOutcome.retryLater) {
            backoff = backoff == Duration.zero
                ? const Duration(seconds: 15)
                : Duration(seconds: min(backoff.inSeconds * 2, 300));
            nextFlushAllowed = DateTime.now().add(backoff);
            break;
          }
          backoff = Duration.zero;
          nextFlushAllowed = DateTime.fromMillisecondsSinceEpoch(0);
          if (rows.length < _batchSize) break;
        }
        lastFlushAt = DateTime.now();
      } catch (e) {
        _log('flush error: $e');
      } finally {
        flushing = false;
      }
    }

    /// Decides whether a fix is worth keeping, and if so stores it in the
    /// outbox (never sends it directly), then triggers a flush when due.
    Future<void> capture(
      Position position, {
      required bool isInitialPoint,
      bool isHeartbeat = false,
    }) async {
      try {
        final prefs = await SharedPreferences.getInstance();
        await prefs.reload();
        if ((prefs.getString('accessToken') ?? '').isEmpty) {
          _log('fix skipped (no access token)');
          return;
        }

        if (!isInitialPoint) {
          // Between buildings or indoors the receiver reports fixes tens of
          // metres off. Uploading them draws the route down streets the
          // employee never walked, so drop them and wait for a better fix.
          if (position.accuracy > _maxAccuracyMeters) {
            _log(
              'point skipped (poor GPS accuracy '
              '${position.accuracy.toStringAsFixed(0)}m > '
              '${_maxAccuracyMeters}m)',
            );
            return;
          }
        }

        // A heartbeat is recorded precisely because the employee has not
        // moved, so the minimum-movement rule does not apply to it.
        if (!isInitialPoint && !isHeartbeat && lastUploadedPosition != null) {
          final movedMeters = Geolocator.distanceBetween(
            lastUploadedPosition!.latitude,
            lastUploadedPosition!.longitude,
            position.latitude,
            position.longitude,
          );
          // Movement smaller than the fix's own error is jitter, not travel.
          final requiredMeters = position.accuracy > _minimumMovementMeters
              ? position.accuracy
              : _minimumMovementMeters.toDouble();
          if (movedMeters < requiredMeters) {
            _log(
              'point skipped (${movedMeters.toStringAsFixed(0)}m < '
              '${requiredMeters.toStringAsFixed(0)}m)',
            );
            return;
          }
        }

        double? batteryPercent;
        try {
          batteryPercent = (await Battery().batteryLevel).toDouble();
        } catch (_) {}

        // A heartbeat must not move the baseline the 30 m rule measures from.
        if (!isHeartbeat) lastUploadedPosition = position;
        lastCaptureAt = DateTime.now();

        final capturedAt = _capturedAt(position);
        final id = _newPingId();
        final payload = <String, dynamic>{
          'clientPingId': id,
          'latitude': position.latitude,
          'longitude': position.longitude,
          'accuracyMeters': position.accuracy,
          if (batteryPercent != null) 'batteryPercent': batteryPercent,
          'activityType': isHeartbeat ? 'IDLE_PING' : 'EN_ROUTE',
          'capturedAt': capturedAt.toIso8601String(),
        };
        await TrackingOutbox.add(
          clientPingId: id,
          capturedAtMs: capturedAt.millisecondsSinceEpoch,
          payload: jsonEncode(payload),
        );
        unawaited(touchAlive());
        if (kDebugMode) {
          debugPrint(
            'Tracking: stored ${position.latitude.toStringAsFixed(6)}, '
            '${position.longitude.toStringAsFixed(6)} '
            '(accuracy ${position.accuracy.toStringAsFixed(0)}m, '
            '${isHeartbeat ? 'IDLE_PING' : 'EN_ROUTE'})',
          );
        }

        final pending = await TrackingOutbox.count();
        final sinceFlush = DateTime.now().difference(lastFlushAt);
        if (isInitialPoint ||
            pending >= _flushThreshold ||
            sinceFlush >= _flushInterval) {
          unawaited(flush());
        }
      } catch (e) {
        _log('capture error: $e');
      }
    }

    service.on('stopService').listen((event) async {
      flushTimer?.cancel();
      heartbeatTimer?.cancel();
      connectivitySubscription?.cancel();
      positionSubscription?.cancel();
      // Last chance to upload the final stretch before the service goes away.
      try {
        await flush(force: true).timeout(const Duration(seconds: 10));
      } catch (_) {}
      service.stopSelf();
    });
    service.on('flushNow').listen((event) => unawaited(flush(force: true)));

    await _migrateLegacyQueue();
    unawaited(touchAlive());

    // Record the punch-in position once. Subsequent points come from the
    // platform GPS stream only after at least 30m of movement.
    try {
      final initialPosition = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 30),
        ),
      );
      await capture(initialPosition, isInitialPoint: true);
    } on TimeoutException {
      final fallback = await Geolocator.getLastKnownPosition();
      if (fallback != null) {
        await capture(fallback, isInitialPoint: true);
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
      (position) {
        chain = chain.then((_) => capture(position, isInitialPoint: false));
      },
      onError: (Object error) => _log('GPS stream error: $error'),
    );

    // Upload on a timer, and straight away when the network comes back (the
    // retry back-off is reset, because the connection has just changed).
    flushTimer = Timer.periodic(_flushInterval, (_) => unawaited(flush()));
    connectivitySubscription = Connectivity().onConnectivityChanged.listen((
      results,
    ) {
      if (results.any((result) => result != ConnectivityResult.none)) {
        nextFlushAllowed = DateTime.fromMillisecondsSinceEpoch(0);
        backoff = Duration.zero;
        unawaited(flush());
      }
    });

    heartbeatTimer = Timer.periodic(_heartbeatInterval, (_) {
      unawaited(touchAlive()); // the loop is running, even if there is no fix to record
      final last = lastCaptureAt;
      if (last != null && DateTime.now().difference(last) < _heartbeatInterval) {
        return; // something was recorded recently; no heartbeat needed
      }
      // Same single-file chain as real fixes, so a heartbeat never overlaps one.
      chain = chain.then((_) async {
        try {
          final position = await Geolocator.getCurrentPosition(
            locationSettings: const LocationSettings(
              accuracy: LocationAccuracy.high,
              timeLimit: Duration(seconds: 20),
            ),
          );
          await capture(position, isInitialPoint: false, isHeartbeat: true);
        } catch (e) {
          _log('heartbeat skipped: $e');
        }
      });
    });
  }
}
