import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Stores credentials and short-lived authentication tickets in the platform
/// keystore (Android Keystore / iOS Keychain), never in preferences.
class SecureSessionService {
  SecureSessionService._();

  static const _storage = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
    iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
  );

  static const accessTokenKey = 'accessToken';
  static const refreshTokenKey = 'refreshToken';
  static const pendingTokenKey = 'pendingAuthToken';

  static Future<String?> readAccessToken() => _storage.read(key: accessTokenKey);
  static Future<String?> readPendingToken() => _storage.read(key: pendingTokenKey);

  static Future<void> saveTokens({String? accessToken, String? refreshToken}) async {
    if (accessToken != null && accessToken.isNotEmpty) {
      await _storage.write(key: accessTokenKey, value: accessToken);
    }
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _storage.write(key: refreshTokenKey, value: refreshToken);
    }
  }

  static Future<void> savePendingToken(String token) =>
      _storage.write(key: pendingTokenKey, value: token);

  static Future<void> clearPendingToken() => _storage.delete(key: pendingTokenKey);

  static Future<void> writeSecret(String key, String value) => _storage.write(key: key, value: value);
  static Future<String?> readSecret(String key) => _storage.read(key: key);
  static Future<void> deleteSecret(String key) => _storage.delete(key: key);

  /// Signing out must not silently delete a registered biometric template.
  static Future<void> clearSession() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: refreshTokenKey);
    await _storage.delete(key: pendingTokenKey);
  }
}
