import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

/// Outcome of [PunchLocationService.captureFresh]: either a trustworthy live
/// position, or a message the user can act on.
class PunchLocationResult {
  const PunchLocationResult.ok(this.position) : error = null;
  const PunchLocationResult.failed(this.error) : position = null;

  final Position? position;
  final String? error;

  bool get isOk => position != null;
}

/// The location a punch is judged on. Taken at the moment the user verifies
/// (not when the screen opened, and never the phone's cached position) so the
/// server compares where the employee is NOW with the branch's punch radius.
///
/// A punch-in without a trustworthy fix is refused by the caller with the
/// message from here, instead of being sent without coordinates (the server
/// would then borrow a nearby tracking ping, which can be minutes old).
class PunchLocationService {
  PunchLocationService._();

  /// A fix with a reported error larger than this is too vague to compare with the punch radius.
  static const double maxAccuracyMeters = 50;

  /// A fix older than this is not "now" (guards against a cached position being returned).
  static const Duration maxFixAge = Duration(seconds: 30);

  /// How long to keep looking for a good fix before giving up.
  static const Duration overallTimeout = Duration(seconds: 25);

  /// [timeout] and [maxAccuracy] default to the punch-in rules. A collection uses a shorter wait and a looser
  /// accuracy (it never blocks on a missing fix; it is just sent without coordinates).
  static Future<PunchLocationResult> captureFresh({
    Duration timeout = overallTimeout,
    double maxAccuracy = maxAccuracyMeters,
  }) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return const PunchLocationResult.failed(
          'Location (GPS) is turned off. Turn it on and try again.',
        );
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        return const PunchLocationResult.failed(
          'Location permission is blocked for this app. Allow it in the phone settings and try again.',
        );
      }
      if (permission == LocationPermission.denied) {
        return const PunchLocationResult.failed(
          'Location permission is needed to punch. Allow it and try again.',
        );
      }

      final deadline = DateTime.now().add(timeout);
      Position? best;
      // A few attempts: the first fix after opening the app is often vague indoors or under cover.
      while (DateTime.now().isBefore(deadline)) {
        final remaining = deadline.difference(DateTime.now());
        final attemptLimit = remaining < const Duration(seconds: 10)
            ? remaining
            : const Duration(seconds: 10);
        try {
          final fix = await Geolocator.getCurrentPosition(
            locationSettings: LocationSettings(
              accuracy: LocationAccuracy.best,
              timeLimit: attemptLimit,
            ),
          );
          if (fix.isMocked) {
            return const PunchLocationResult.failed(
              'A fake (mock) location is switched on. Turn it off to punch.',
            );
          }
          if (DateTime.now().difference(fix.timestamp.toLocal()).abs() >
              maxFixAge) {
            continue; // an old position handed back by the system: ask again
          }
          if (best == null || fix.accuracy < best.accuracy) best = fix;
          if (fix.accuracy <= maxAccuracy) {
            return PunchLocationResult.ok(fix);
          }
        } on TimeoutException {
          // try again until the overall deadline
        }
      }

      if (best != null) {
        return PunchLocationResult.failed(
          'GPS signal is weak (accurate to about ${best.accuracy.round()} m). '
          'Move to an open area and try again.',
        );
      }
      return const PunchLocationResult.failed(
        'Could not get your current location. Check that GPS is on, and try again.',
      );
    } catch (e) {
      if (kDebugMode) debugPrint('PunchLocationService error: $e');
      return const PunchLocationResult.failed(
        'Could not get your current location. Check that GPS is on, and try again.',
      );
    }
  }
}
