import 'dart:convert';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../domain/models/face_embedding.dart';

class SecureBiometricStorageService {
  final FlutterSecureStorage _storage;
  static const String _embeddingKeyPrefix = 'sec_bio_face_emb_';
  static const String _consentKey = 'sec_bio_consent_granted';
  static const String _rateLimitCountKey = 'sec_bio_failed_attempts';
  static const String _rateLimitTimestampKey = 'sec_bio_last_failed_ts';

  SecureBiometricStorageService()
      : _storage = const FlutterSecureStorage(
          aOptions: AndroidOptions(
            encryptedSharedPreferences: true,
          ),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        );

  /// Save encrypted face embedding template
  Future<bool> saveEmbedding(FaceEmbedding embedding) async {
    try {
      final jsonStr = embedding.toRawJson();
      final encryptedPayload = _encryptData(jsonStr, embedding.userId);

      await _storage.write(
        key: '$_embeddingKeyPrefix${embedding.userId}',
        value: encryptedPayload,
      );
      return true;
    } catch (e) {
      debugPrint('SecureBiometricStorageService: Error saving embedding: $e');
      return false;
    }
  }

  /// Retrieve and decrypt stored face embedding template
  Future<FaceEmbedding?> getEmbedding(String userId) async {
    try {
      final encryptedPayload = await _storage.read(
        key: '$_embeddingKeyPrefix$userId',
      );
      if (encryptedPayload == null || encryptedPayload.isEmpty) {
        return null;
      }
      final decryptedJson = _decryptData(encryptedPayload, userId);
      if (decryptedJson == null) return null;

      return FaceEmbedding.fromRawJson(decryptedJson);
    } catch (e) {
      debugPrint('SecureBiometricStorageService: Error reading embedding: $e');
      return null;
    }
  }

  /// Check if face embedding exists for user
  Future<bool> hasEnrolledFace(String userId) async {
    final raw = await _storage.read(key: '$_embeddingKeyPrefix$userId');
    return raw != null && raw.isNotEmpty;
  }

  /// Delete enrolled biometric template securely
  Future<bool> deleteEmbedding(String userId) async {
    try {
      await _storage.delete(key: '$_embeddingKeyPrefix$userId');
      return true;
    } catch (e) {
      debugPrint('SecureBiometricStorageService: Delete error: $e');
      return false;
    }
  }

  /// Save consent status
  Future<void> setConsentGranted(bool granted) async {
    await _storage.write(key: _consentKey, value: granted.toString());
  }

  /// Read consent status
  Future<bool> getConsentGranted() async {
    final val = await _storage.read(key: _consentKey);
    return val == 'true';
  }

  /// Rate limiting: Get failed attempt count
  Future<int> getFailedAttempts() async {
    final val = await _storage.read(key: _rateLimitCountKey);
    return int.tryParse(val ?? '0') ?? 0;
  }

  /// Rate limiting: Increment failed attempts
  Future<void> incrementFailedAttempts() async {
    final current = await getFailedAttempts();
    await _storage.write(key: _rateLimitCountKey, value: (current + 1).toString());
    await _storage.write(
      key: _rateLimitTimestampKey,
      value: DateTime.now().millisecondsSinceEpoch.toString(),
    );
  }

  /// Rate limiting: Reset failed attempts
  Future<void> resetFailedAttempts() async {
    await _storage.delete(key: _rateLimitCountKey);
    await _storage.delete(key: _rateLimitTimestampKey);
  }

  /// Rate limiting: Get timestamp of last failed attempt
  Future<int?> getLastFailedTimestamp() async {
    final val = await _storage.read(key: _rateLimitTimestampKey);
    return int.tryParse(val ?? '');
  }

  /// Simple AES-like obfuscation + HMAC checksum wrapper over raw JSON string
  /// Enforces payload integrity without plaintext leaks
  String _encryptData(String data, String salt) {
    final key = sha256.convert(utf8.encode('SARVAM_BIO_SECRET_$salt')).bytes;
    final bytes = utf8.encode(data);
    final encryptedBytes = List<int>.generate(
      bytes.length,
      (i) => bytes[i] ^ key[i % key.length],
    );
    final base64Encrypted = base64Encode(encryptedBytes);
    final mac = hmacSha256(key, base64Encrypted);
    return '$base64Encrypted:$mac';
  }

  String? _decryptData(String payload, String salt) {
    final parts = payload.split(':');
    if (parts.length != 2) return null;
    final base64Encrypted = parts[0];
    final mac = parts[1];

    final key = sha256.convert(utf8.encode('SARVAM_BIO_SECRET_$salt')).bytes;
    final expectedMac = hmacSha256(key, base64Encrypted);

    if (mac != expectedMac) {
      debugPrint('SecureBiometricStorageService: Integrity checksum mismatch!');
      return null;
    }

    final encryptedBytes = base64Decode(base64Encrypted);
    final decryptedBytes = List<int>.generate(
      encryptedBytes.length,
      (i) => encryptedBytes[i] ^ key[i % key.length],
    );
    return utf8.decode(decryptedBytes);
  }

  String hmacSha256(List<int> key, String data) {
    final hmac = Hmac(sha256, key);
    return hmac.convert(utf8.encode(data)).toString();
  }
}
