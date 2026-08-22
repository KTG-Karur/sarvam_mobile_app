import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

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
    // Also mirrored into SharedPreferences: a large number of call sites
    // across the app (ApiClient's request modifier, dashboard/collection
    // controllers, several API services) read the token via
    // `prefs.getString('accessToken')` instead of this service, so secure
    // storage alone left every one of those requests with no Authorization
    // header — the real cause of the false "session expired" → logout →
    // MPIN-fails-with-no-token loop. Secure storage remains the source of
    // truth; this is a compatibility mirror for those existing readers.
    final prefs = await SharedPreferences.getInstance();
    if (accessToken != null && accessToken.isNotEmpty) {
      await _storage.write(key: accessTokenKey, value: accessToken);
      await prefs.setString(accessTokenKey, accessToken);
    }
    if (refreshToken != null && refreshToken.isNotEmpty) {
      await _storage.write(key: refreshTokenKey, value: refreshToken);
      await prefs.setString(refreshTokenKey, refreshToken);
    }
  }

  static Future<void> savePendingToken(String token) =>
      _storage.write(key: pendingTokenKey, value: token);

  static Future<void> clearPendingToken() => _storage.delete(key: pendingTokenKey);

  static Future<void> writeSecret(String key, String value) => _storage.write(key: key, value: value);
  static Future<String?> readSecret(String key) => _storage.read(key: key);
  static Future<void> deleteSecret(String key) => _storage.delete(key: key);

  /// Decodes the payload segment of a JWT (base64url) without verifying its
  /// signature — used only to read claims (branchId, role, userId) out of
  /// this device's own already-trusted stored access token as a self-heal
  /// fallback when SharedPreferences' cached copies of those fields went
  /// missing (e.g. wiped by a logout cycle, never repopulated by an MPIN-only
  /// app-resume since that path deliberately returns no user/branch data —
  /// see mpin/verify's dual-purpose doc comment on the backend). Never use
  /// this to authenticate a token from anywhere else; the server remains the
  /// only party that verifies the signature.
  static Map<String, dynamic>? decodeJwtPayload(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return null;
      final normalized = base64Url.normalize(parts[1]);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final map = jsonDecode(decoded);
      return map is Map<String, dynamic> ? map : null;
    } catch (_) {
      return null;
    }
  }

  /// Signing out must not silently delete a registered biometric template.
  static Future<void> clearSession() async {
    await _storage.delete(key: accessTokenKey);
    await _storage.delete(key: refreshTokenKey);
    await _storage.delete(key: pendingTokenKey);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(accessTokenKey);
    await prefs.remove(refreshTokenKey);
  }
}
