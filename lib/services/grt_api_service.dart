import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class GrtApiException implements Exception {
  GrtApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

class GrtApiService {
  GrtApiService(this._client);

  final ApiClient _client;

  Future<String> _authToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('accessToken') ?? '';
  }

  Map<String, String> _authHeaders(String token) => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  dynamic _unwrap(Response response) {
    final body = response.body;
    if (body is Map && body['success'] == true) {
      return body['data'];
    }
    final message = (body is Map ? (body['message'] ?? body['error']) : null);
    throw GrtApiException(
      message?.toString() ??
          'Request failed${response.statusCode != null ? ' (${response.statusCode})' : ''}',
    );
  }

  Future<List<dynamic>> _getList(String url) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(url, headers: _authHeaders(token));
    final data = _unwrap(response);
    return data is List ? data : <dynamic>[];
  }

  Future<Map<String, dynamic>> _getMap(String url) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(url, headers: _authHeaders(token));
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> _postMap(
    String url,
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      url,
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> _patchMap(
    String url,
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.patch(
      url,
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/grt-sessions?centerId=`
  Future<List<dynamic>> getGrtSessions(String centerId) =>
      _getList("${Api.baseUrl}/api/grt-sessions?centerId=$centerId");

  /// `GET /api/questionnaires`
  Future<List<dynamic>> getQuestionnaires() =>
      _getList("${Api.baseUrl}/api/questionnaires");

  /// `POST /api/grt-sessions`
  Future<Map<String, dynamic>> createGrtSession({
    required String centerId,
    required String sessionDate,
    required String questionnaireId,
    required List<String> loanIds,
  }) => _postMap("${Api.baseUrl}/api/grt-sessions", {
    'centerId': centerId,
    'sessionDate': sessionDate,
    'questionnaireId': questionnaireId,
    'loanIds': loanIds,
  });

  /// `GET /api/grt-sessions/{sessionId}`
  Future<Map<String, dynamic>> getGrtSessionDetail(String sessionId) =>
      _getMap("${Api.baseUrl}/api/grt-sessions/$sessionId");

  /// `PATCH /api/grt-sessions/{sessionId}/answers`
  Future<Map<String, dynamic>> saveGrtAnswers(
    String sessionId,
    List<Map<String, dynamic>> answers,
  ) => _patchMap("${Api.baseUrl}/api/grt-sessions/$sessionId/answers", {
    'answers': answers,
  });

  /// `POST /api/grt-sessions/{sessionId}/photos`
  Future<Map<String, dynamic>> uploadGrtPhoto(
    String sessionId, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    String? questionId,
    String? notes,
  }) async {
    final token = await _authToken();
    final formData = FormData({
      'photo': MultipartFile(bytes, filename: filename, contentType: contentType),
      if (questionId != null && questionId.isNotEmpty) 'questionId': questionId,
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    _client.timeout = const Duration(seconds: 60);
    final response = await _client.post(
      "${Api.baseUrl}/api/grt-sessions/$sessionId/photos",
      formData,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `DELETE /api/grt-sessions/{sessionId}/photos/{photoId}`
  Future<void> deleteGrtPhoto(String sessionId, String photoId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.delete(
      "${Api.baseUrl}/api/grt-sessions/$sessionId/photos/$photoId",
      headers: _authHeaders(token),
    );
    _unwrap(response);
  }

  /// `PATCH /api/grt-sessions/{sessionId}/complete`
  Future<Map<String, dynamic>> completeGrtSession(String sessionId) =>
      _patchMap("${Api.baseUrl}/api/grt-sessions/$sessionId/complete", {});

  /// `DELETE /api/grt-sessions/{sessionId}`
  Future<void> deleteGrtSession(String sessionId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.delete(
      "${Api.baseUrl}/api/grt-sessions/$sessionId",
      headers: _authHeaders(token),
    );
    _unwrap(response);
  }

  /// `GET /api/storage/signed-url?key=`
  Future<String?> getSignedUrl(String key) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.get(
      "${Api.signedUrlUrl}?key=${Uri.encodeQueryComponent(key)}",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? data['url']?.toString() : null;
  }
}
