import 'dart:convert';

import 'package:flutter/foundation.dart';
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
  /// If road routing is unavailable, the API returns the original
  /// chronological GPS points. Render that fallback so a real tracked route
  /// stays visible rather than disappearing.
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
      if (response.statusCode < 200 || response.statusCode >= 300) {
        if (kDebugMode) {
          debugPrint('Route map: route request failed (${response.statusCode})');
        }
        return const [];
      }
      final decoded = _tryDecodeJson(response);
      if (decoded == null) {
        if (kDebugMode) {
          debugPrint('Route map: server returned HTML/non-JSON data');
        }
        return const [];
      }
      final data = decoded is Map && decoded['data'] is Map
          ? decoded['data'] as Map
          : decoded;
      final routePoints = data is Map ? data['points'] : null;
      if (routePoints is! List) {
        if (kDebugMode) {
          debugPrint('Route map: route request failed (${response.statusCode})');
        }
        return const [];
      }
      final parsedPoints = routePoints
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
      if (kDebugMode) {
        debugPrint(
          'Route map: ${parsedPoints.length} points loaded '
          '(${data is Map ? data['source'] ?? 'unknown' : 'unknown'} route)',
        );
      }
      return parsedPoints;
    } catch (error, stackTrace) {
      if (kDebugMode) {
        debugPrint('Route map: route request error: $error');
        debugPrintStack(stackTrace: stackTrace);
      }
      return const [];
    }
  }

  static Future<Map<String, dynamic>> trackingDetail({
    required String employeeId,
    required DateTime date,
  }) async {
    // Send a date-only value in a URL-safe query string.  Using Uri here also
    // prevents an employee id containing reserved characters from changing the
    // route or query that reaches the server.
    final dateKey =
        '${date.year.toString().padLeft(4, '0')}-'
        '${date.month.toString().padLeft(2, '0')}-'
        '${date.day.toString().padLeft(2, '0')}';
    final employeeKey = Uri.encodeComponent(employeeId);
    final query = Uri(queryParameters: {'date': dateKey}).query;
    final payload = await _get(
      '/api/hr/tracking/employee/$employeeKey/detail?$query',
    );
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
    final decoded = _tryDecodeJson(response);
    if (decoded == null) {
      final contentType = response.headers['content-type'] ?? 'unknown type';
      if (kDebugMode) {
        debugPrint(
          'HR API: non-JSON response for $path '
          '(${response.statusCode}, $contentType)',
        );
      }
      throw const HrApiException(
        'The server returned a web page instead of HR API data. '
        'Please check the API deployment and sign in again.',
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = decoded is Map ? (decoded['message'] ?? decoded['error'])?.toString() : null;
      throw HrApiException(message ?? 'Unable to load HR data (${response.statusCode}).');
    }
    return decoded is Map && decoded.containsKey('data') ? decoded['data'] : decoded;
  }

  /// Returns null for an HTML/proxy error page rather than letting jsonDecode
  /// throw a FormatException into the UI.
  static dynamic _tryDecodeJson(http.Response response) {
    final body = response.body.trim();
    if (body.isEmpty) return null;
    final contentType = response.headers['content-type']?.toLowerCase() ?? '';
    if (body.startsWith('<!DOCTYPE') || body.startsWith('<html') ||
        (!contentType.contains('json') &&
            !body.startsWith('{') &&
            !body.startsWith('['))) {
      return null;
    }
    try {
      return jsonDecode(body);
    } on FormatException {
      return null;
    }
  }
}

class HrApiException implements Exception {
  const HrApiException(this.message);
  final String message;

  @override
  String toString() => message;
}
