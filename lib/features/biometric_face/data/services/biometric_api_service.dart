import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../../domain/models/face_embedding.dart';

class BiometricApiService {
  final String baseUrl;
  final http.Client _httpClient;

  BiometricApiService({
    this.baseUrl = 'https://api.sarvam.ai/v1/biometrics',
    http.Client? httpClient,
  }) : _httpClient = httpClient ?? http.Client();

  /// Sync encrypted biometric embedding with secure backend over HTTPS
  Future<bool> syncEmbeddingToBackend({
    required String authToken,
    required FaceEmbedding embedding,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/enroll');
      final response = await _httpClient.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
          'X-Security-Policy': 'Biometric-AES256',
        },
        body: jsonEncode({
          'userId': embedding.userId,
          'engineVersion': embedding.engineVersion,
          'checksum': embedding.checksum,
          'encryptedEmbedding': embedding.toRawJson(),
        }),
      );

      return response.statusCode == 200 || response.statusCode == 201;
    } catch (e) {
      debugPrint('BiometricApiService: Sync network call failed (offline mode): $e');
      return false;
    }
  }

  /// Verify face embedding against backend over HTTPS
  Future<bool> verifyRemoteFace({
    required String authToken,
    required FaceEmbedding probeEmbedding,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/verify');
      final response = await _httpClient.post(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: jsonEncode({
          'userId': probeEmbedding.userId,
          'checksum': probeEmbedding.checksum,
        }),
      );

      if (response.statusCode == 200) {
        final body = jsonDecode(response.body);
        return body['verified'] == true;
      }
      return false;
    } catch (e) {
      debugPrint('BiometricApiService: Remote verification error: $e');
      return false;
    }
  }

  /// Request backend server to purge/clear enrolled face template data over HTTPS
  Future<bool> clearRemoteFaceEmbedding({
    required String authToken,
  }) async {
    try {
      final uri = Uri.parse('$baseUrl/register');
      final response = await _httpClient.delete(
        uri,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
      );
      return response.statusCode == 200 || response.statusCode == 204;
    } catch (e) {
      debugPrint('BiometricApiService: Remote clear face error: $e');
      return false;
    }
  }
}
