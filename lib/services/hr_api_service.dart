import 'dart:convert';
import 'dart:math' as math;

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

  /// GET /api/hr/employees/me/id-card — every value the signed-in employee's
  /// ID card prints (profile merged with the onboarding record, plus the
  /// photo's storage key), unaffected by field-visibility settings.
  static Future<Map<String, dynamic>> myIdCard() async {
    final payload = await _get('/api/hr/employees/me/id-card');
    return payload is Map
        ? Map<String, dynamic>.from(payload)
        : <String, dynamic>{};
  }

  /// GET /api/hr/employee-documents?employeeId= — an employee's document
  /// catalog (the caller's own is always allowed). The ID card reads the
  /// KYC / "Photo" entry from it.
  static Future<List<dynamic>> employeeDocuments(String employeeId) => _getList(
        '/api/hr/employee-documents?employeeId=${Uri.encodeQueryComponent(employeeId)}',
      );

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
    final backend = await _backendRoadRoute(points);
    final route =
        backend.length >= 2 ? backend : await _osrmRoadRoute(points);
    return _cleanRoute(route);
  }

  static double _meters(Map<String, double> a, Map<String, double> b) {
    final dLat = (b['latitude']! - a['latitude']!) * 110540;
    final dLng = (b['longitude']! - a['longitude']!) *
        111320 *
        math.cos(a['latitude']! * math.pi / 180);
    return math.sqrt(dLat * dLat + dLng * dLng);
  }

  /// A punch or GPS fix taken inside a building snaps to the nearest side
  /// alley, so the router draws a dead-end stub off the real road. Remove
  /// (1) out-and-back spurs and small loops the route makes to reach such a
  /// point, and (2) short dead-end tails/heads that branch off the path.
  static List<Map<String, double>> _cleanRoute(
    List<Map<String, double>> route,
  ) {
    if (route.length < 3) return route;

    bool isSpur(List<Map<String, double>> path, int from, Map<String, double> back) {
      var length = 0.0;
      var area = 0.0;
      final loop = [...path.sublist(from), back];
      for (var i = 1; i < loop.length; i++) {
        length += _meters(loop[i - 1], loop[i]);
        // Shoelace area in local metres (retraced spurs enclose ~nothing).
        final ax = (loop[i - 1]['longitude']! - loop[0]['longitude']!) * 111320;
        final ay = (loop[i - 1]['latitude']! - loop[0]['latitude']!) * 110540;
        final bx = (loop[i]['longitude']! - loop[0]['longitude']!) * 111320;
        final by = (loop[i]['latitude']! - loop[0]['latitude']!) * 110540;
        area += ax * by - bx * ay;
      }
      return length <= 250 && (area / 2).abs() <= 300;
    }

    final out = <Map<String, double>>[];
    for (final p in route) {
      var cut = -1;
      for (var i = math.max(0, out.length - 80); i < out.length - 1; i++) {
        if (_meters(out[i], p) < 3) {
          cut = i;
          break;
        }
      }
      if (cut >= 0 && isSpur(out, cut, p)) {
        out.removeRange(cut + 1, out.length);
        continue;
      }
      out.add(p);
    }

    List<Map<String, double>> trimEnd(List<Map<String, double>> r) {
      var length = 0.0;
      for (var k = r.length - 1; k > 0 && length <= 60; k--) {
        length += _meters(r[k], r[k - 1]);
        for (var j = 0; j < k - 1; j++) {
          if (_meters(r[j], r[k - 1]) < 3) return r.sublist(0, k);
        }
      }
      return r;
    }

    final trimmedEnd = trimEnd(out);
    final trimmed = trimEnd(trimmedEnd.reversed.toList()).reversed.toList();
    return trimmed.length >= 2 ? trimmed : route;
  }

  /// Road geometry straight from the public OSRM server — used when the
  /// Sarvam API can't supply it (endpoint not deployed, offline, or it only
  /// had straight-line data). `match` is built for noisy GPS traces and snaps
  /// them onto the road they were actually driven on; plain `route` is the
  /// fallback if matching finds nothing.
  static Future<List<Map<String, double>>> _osrmRoadRoute(
    List<Map<String, double>> points,
  ) async {
    final coordinates = points
        .map((p) => '${p['longitude']},${p['latitude']}')
        .join(';');
    const base = 'https://router.project-osrm.org';

    List<Map<String, double>> fromGeometry(dynamic geometry) {
      final coords = geometry is Map ? geometry['coordinates'] : null;
      if (coords is! List) return const [];
      return coords
          .whereType<List>()
          .where((c) => c.length >= 2)
          .map((c) => <String, double>{
                'latitude': (c[1] as num).toDouble(),
                'longitude': (c[0] as num).toDouble(),
              })
          .toList();
    }

    Future<dynamic> fetch(String url) async {
      final response =
          await http.get(Uri.parse(url)).timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) return null;
      final body = jsonDecode(response.body);
      return body is Map && body['code'] == 'Ok' ? body : null;
    }

    try {
      // Tight radius: a fix further than this from any road is dropped rather
      // than snapped to a side alley that forces a detour.
      final radiuses = List.filled(points.length, '20').join(';');
      final matched = await fetch(
        '$base/match/v1/driving/$coordinates'
        '?geometries=geojson&overview=full&tidy=true&radiuses=$radiuses',
      );
      final matchings = matched?['matchings'];
      if (matchings is List && matchings.isNotEmpty) {
        final route = <Map<String, double>>[
          for (final m in matchings.whereType<Map>()) ...fromGeometry(m['geometry']),
        ];
        if (route.length >= 2) {
          if (kDebugMode) debugPrint('Route map: ${route.length} points (osrm match)');
          return route;
        }
      }
      final routed = await fetch(
        '$base/route/v1/driving/$coordinates'
        '?geometries=geojson&overview=full&continue_straight=true',
      );
      final routes = routed?['routes'];
      if (routes is List && routes.isNotEmpty) {
        final route = fromGeometry((routes.first as Map)['geometry']);
        if (route.length >= 2) {
          if (kDebugMode) debugPrint('Route map: ${route.length} points (osrm route)');
          return route;
        }
      }
    } catch (error) {
      if (kDebugMode) debugPrint('Route map: OSRM error: $error');
    }
    return const [];
  }

  static Future<List<Map<String, double>>> _backendRoadRoute(
    List<Map<String, double>> points,
  ) async {
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
      // The server echoes the raw GPS points when it couldn't reach a router;
      // treat that as "no road data" so the OSRM fallback gets a chance.
      if (data is Map && data['source'] == 'straight-line') return const [];
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
