import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:local_auth/local_auth.dart';

class FingerprintBiometricService {
  static final LocalAuthentication _auth = LocalAuthentication();

  /// Checks if hardware supports fingerprint / biometric authentication.
  static Future<bool> isFingerprintAvailable() async {
    try {
      final bool canAuthenticateWithBiometrics = await _auth.canCheckBiometrics;
      final bool canAuthenticate = canAuthenticateWithBiometrics || await _auth.isDeviceSupported();
      if (!canAuthenticate) return false;

      final List<BiometricType> availableBiometrics = await _auth.getAvailableBiometrics();
      return availableBiometrics.contains(BiometricType.fingerprint) ||
          availableBiometrics.contains(BiometricType.strong) ||
          availableBiometrics.contains(BiometricType.weak);
    } on PlatformException catch (e) {
      if (kDebugMode) print('Error checking biometrics availability: $e');
      return false;
    }
  }

  /// Triggers local device fingerprint scanner prompt.
  /// Returns `true` if fingerprint match is successful, `false` otherwise.
  static Future<bool> authenticateWithFingerprint({
    String reason = 'Scan your fingerprint to verify attendance',
  }) async {
    try {
      final bool isAvailable = await isFingerprintAvailable();
      if (!isAvailable) {
        if (kDebugMode) print('Fingerprint sensor not available on this device.');
      }

      final bool authenticated = await _auth.authenticate(
        localizedReason: reason,
      );
      return authenticated;
    } on PlatformException catch (e) {
      if (kDebugMode) print('Fingerprint authentication error: $e');
      return false;
    }
  }
}
