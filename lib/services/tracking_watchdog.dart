import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:workmanager/workmanager.dart';
import 'package:sarvam/services/tracking_service.dart';

const String _watchdogUniqueName = 'sarvam_tracking_watchdog';
const String _watchdogTaskName = 'sarvam_tracking_watchdog_task';

/// Entry point of the watchdog task. Android's WorkManager runs it in its own
/// short-lived isolate, even when the app has been closed or swiped away.
/// Must be a top-level function.
@pragma('vm:entry-point')
void trackingWatchdogDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    try {
      DartPluginRegistrant.ensureInitialized();
      await TrackingService.restartIfStopped();
    } catch (e) {
      // Android 12+ can refuse to start a foreground service from the
      // background. Never fail the task; the next run (or the next time the
      // app is opened, see reconcilePunchPrefs) tries again.
      // ignore: avoid_print
      print('Tracking: watchdog could not restart the service: $e');
    }
    return true;
  });
}

/// Restarts live tracking if the phone's battery manager kills the background
/// service while the employee is still punched in.
///
/// While tracking runs, a periodic task checks every ~15 minutes (Android's
/// minimum) whether the service has gone silent and, if so, starts it again.
/// [TrackingService.start] schedules it and [TrackingService.stop] cancels it, so
/// it can never bring tracking back after a punch-out. Android only.
class TrackingWatchdog {
  TrackingWatchdog._();

  static bool _initialized = false;

  static bool get _supported => defaultTargetPlatform == TargetPlatform.android;

  /// Registers the dispatcher. Call once from `main()`; safe to call again.
  static Future<void> init() async {
    if (!_supported || _initialized) return;
    await Workmanager().initialize(trackingWatchdogDispatcher);
    _initialized = true;
  }

  static Future<void> schedule() async {
    if (!_supported) return;
    try {
      await init();
      await Workmanager().registerPeriodicTask(
        _watchdogUniqueName,
        _watchdogTaskName,
        frequency: const Duration(minutes: 15),
        // Keep the existing schedule if there is one, so repeated start()
        // calls (every home screen load) do not keep resetting the timer.
        existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
      );
    } catch (e) {
      // ignore: avoid_print
      print('Tracking: watchdog schedule failed: $e');
    }
  }

  static Future<void> cancel() async {
    if (!_supported) return;
    try {
      await Workmanager().cancelByUniqueName(_watchdogUniqueName);
    } catch (e) {
      // ignore: avoid_print
      print('Tracking: watchdog cancel failed: $e');
    }
  }
}
