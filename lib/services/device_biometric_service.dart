import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

enum DeviceBiometricResult { success, failed, cancelled, unavailable, error }

/// Thin wrapper around `local_auth` for the optional device-biometric
/// (fingerprint / Face unlock) check shown before punch-in / punch-out.
/// This is a convenience gate only — it never replaces the face-recognition
/// identity check, so every failure mode here is non-blocking for callers.
class DeviceBiometricService {
  DeviceBiometricService._();

  static final LocalAuthentication _auth = LocalAuthentication();

  /// Whether this device can run a biometric / device-credential prompt.
  ///
  /// Intentionally lenient: some Android OEM ROMs report
  /// `getAvailableBiometrics()` as empty even with a fingerprint enrolled, so
  /// an empty list is not treated as a hard "no" as long as the platform says
  /// biometrics are checkable or the device is supported. The real test is the
  /// [authenticate] call, which fails closed and lets callers fall back.
  static Future<bool> isAvailable() async {
    try {
      final supported = await _auth.isDeviceSupported();
      final canCheck = await _auth.canCheckBiometrics;
      List<BiometricType> enrolled = const [];
      try {
        enrolled = await _auth.getAvailableBiometrics();
      } catch (e) {
        if (kDebugMode) {
          print('DeviceBiometricService: getAvailableBiometrics threw: $e');
        }
      }
      final available = canCheck || supported || enrolled.isNotEmpty;
      if (kDebugMode) {
        print('DeviceBiometricService.isAvailable -> $available '
            '(isDeviceSupported=$supported, canCheckBiometrics=$canCheck, '
            'enrolled=$enrolled)');
      }
      return available;
    } catch (e) {
      if (kDebugMode) print('DeviceBiometricService.isAvailable error: $e');
      return false;
    }
  }

  static Future<DeviceBiometricResult> authenticate(String reason) async {
    try {
      final ok = await _auth.authenticate(
        localizedReason: reason,
        biometricOnly: true,
      );
      return ok ? DeviceBiometricResult.success : DeviceBiometricResult.failed;
    } on LocalAuthException catch (e) {
      if (kDebugMode) print('DeviceBiometricService.authenticate error: $e');
      switch (e.code) {
        case LocalAuthExceptionCode.userCanceled:
        case LocalAuthExceptionCode.userRequestedFallback:
          return DeviceBiometricResult.cancelled;
        case LocalAuthExceptionCode.noCredentialsSet:
        case LocalAuthExceptionCode.noBiometricsEnrolled:
        case LocalAuthExceptionCode.noBiometricHardware:
        case LocalAuthExceptionCode.biometricHardwareTemporarilyUnavailable:
          return DeviceBiometricResult.unavailable;
        case LocalAuthExceptionCode.temporaryLockout:
        case LocalAuthExceptionCode.biometricLockout:
          return DeviceBiometricResult.failed;
        default:
          return DeviceBiometricResult.error;
      }
    } catch (e) {
      if (kDebugMode) print('DeviceBiometricService.authenticate error: $e');
      return DeviceBiometricResult.error;
    }
  }
}
