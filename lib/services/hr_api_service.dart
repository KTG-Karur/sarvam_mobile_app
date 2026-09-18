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

  /// Returns road-following map geometry for chronological tracking points.
  /// An empty result means a road geometry was unavailable. Callers must keep
  /// the GPS markers but never invent a straight connector between points.
  static Future<List<Map<String, double>>> roadRoute(
    List<Map<String, double>> points,
  ) async {
    if (points.length < 2) return const [];
    // OSRM accepts a limited number of waypoints. Split long workdays into
    // overlapping chronological chunks so the final path keeps its order and
    // never reconnects unrelated first/last points.
    if (points.length > 100) {
      final route = <Map<String, double>>[];
      for (var start = 0; start < points.length - 1; start += 99) {
        final end = (start + 100).clamp(0, points.length).toInt();
        final chunk = points.sublist(start, end);
        final chunkRoute = await roadRoute(chunk);
        if (chunkRoute.length < 2) return const [];
        if (route.isNotEmpty && chunkRoute.isNotEmpty) {
          route.addAll(chunkRoute.skip(1));
        } else {
          route.addAll(chunkRoute);
        }
      }
      return route;
    }
    final prefs = await SharedPreferences.getInstance();
    final token = prefs.getString('accessToken') ?? '';
    if (token.isEmpty) return const [];
    try {
      final response = await http
          .post(
            Uri.parse(Api.geoRoadRouteUrl),
            headers: {
              'Authorization': 'Bearer $token',
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'points': points}),
          )
          .timeout(const Duration(seconds: 20));
      final decoded = response.body.isEmpty ? null : jsonDecode(response.body);
      final data = decoded is Map && decoded['data'] is Map
          ? decoded['data'] as Map
          : decoded;
      final routePoints = data is Map ? data['points'] : null;
      if (response.statusCode < 200 || response.statusCode >= 300 ||
          routePoints is! List) {
        return const [];
      }
      if (data['source']?.toString() != 'osrm') return const [];
      return routePoints
          .whereType<Map>()
          .map((point) {
            final latitude = (point['latitude'] as num?)?.toDouble();
            final longitude = (point['longitude'] as num?)?.toDouble();
            return latitude == null || longitude == null
                ? null
                : <String, double>{'latitude': latitude, 'longitude': longitude};
          })
          .whereType<Map<String, double>>()
          .toList();
    } catch (_) {
      return const [];
    }
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
