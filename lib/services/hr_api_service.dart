import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';

/// Authenticated HR endpoints shared by the HRM screens.
///
/// The web API wraps successful payloads in `{ data: ... }`; keeping that
/// detail here prevents individual screens from silently rendering empty data.
class HrApiService {
  HrApiService._();

  static Future<List<dynamic>> myLeaveRequests() => _getList('/api/hr/leave');

  /// GET /api/hr/employees/me — the signed-in employee's current profile.
  static Future<Map<String, dynamic>> myEmployeeProfile() async {
    final payload = await _get('/api/hr/employees/me');
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  static Future<Map<String, dynamic>> trackingDetail({
    required String employeeId,
    required DateTime date,
  }) async {
    final dateKey = date.toIso8601String().substring(0, 10);
    final payload = await _get('/api/hr/tracking/employee/$employeeId/detail?date=$dateKey');
    return payload is Map<String, dynamic> ? payload : <String, dynamic>{};
  }

  static Future<List<dynamic>> _getList(String path) async {
    final payload = await _get(path);
    return payload is List ? List<dynamic>.from(payload) : <dynamic>[];
  }

  static Future<dynamic> _get(String path) async {
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('accessToken') ?? '';
    if (token.isEmpty) throw const HrApiException('Your session has expired. Please sign in again.');

    final response = await http
        .get(
          Uri.parse('${Api.baseUrl}$path'),
          headers: {'Authorization': 'Bearer $token', 'Accept': 'application/json'},
        )
        .timeout(const Duration(seconds: 20));
    final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map ? (decoded['message'] ?? decoded['error'])?.toString() : null;
      throw HrApiException(message ?? 'Unable to load HR data (${response.statusCode}).');
    }
    return decoded is Map && decoded.containsKey('data') ? decoded['data'] : decoded;
  }
}

class HrApiException implements Exception {
  const HrApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
