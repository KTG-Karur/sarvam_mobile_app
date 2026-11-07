import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Holds the logged-in user's RBAC page permissions, fetched from the same
/// `/api/auth/permissions` endpoint the web app hydrates its sidebar and route
/// guards from.
///
/// [pagePermissions] mirrors the web's `PagePermissionsMap`:
///  * `null`  → no role has page permissions configured (or Head-Office admin):
///              callers fall back to the built-in role rules.
///  * a map   → `{ "/dashboard/...": { "view": true, "add": false, ... } }`
///              (union across all of the user's active roles).
///
/// This service only fetches and stores the data; it does not decide access.
class PermissionService {
  PermissionService._();

  static const _prefsKey = 'rbacPagePermissions';
  static const _prefsHydratedKey = 'rbacPermissionsHydrated';

  static Map<String, Map<String, bool>>? _pagePermissions;
  static bool _hydrated = false;
  static Future<void>? _inFlight;

  /// Bumps whenever the stored permissions change (fetched or cleared), so
  /// screens can re-evaluate what they show.
  static final ValueNotifier<int> changes = ValueNotifier<int>(0);

  /// Page permissions, or `null` when not configured / not loaded yet.
  static Map<String, Map<String, bool>>? get pagePermissions => _pagePermissions;

  /// True once a fetch (or a cached copy from an earlier fetch) has been loaded.
  static bool get hydrated => _hydrated;

  /// Loads the last stored copy so permissions are available immediately,
  /// even before (or without) a network call.
  static Future<void> loadCached() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _hydrated = prefs.getBool(_prefsHydratedKey) ?? false;
      final raw = prefs.getString(_prefsKey);
      _pagePermissions = raw == null || raw.isEmpty ? null : _parse(jsonDecode(raw));
    } catch (e) {
      debugPrint('[PermissionService] loadCached failed: $e');
    }
  }

  /// Fetches the latest permissions and stores them. Never throws: on failure
  /// the previously stored copy stays in place. Concurrent calls share one
  /// request.
  static Future<void> refresh() {
    return _inFlight ??= _fetch().whenComplete(() => _inFlight = null);
  }

  static Future<void> _fetch() async {
    try {
      final client = Get.isRegistered<ApiClient>()
          ? Get.find<ApiClient>()
          : Get.put(ApiClient());
      final response = await client.get('${Api.baseUrl}/api/auth/permissions');
      final body = response.body;
      if (body is! Map || body['success'] != true) {
        debugPrint('[PermissionService] unexpected response (${response.statusCode})');
        return;
      }
      _pagePermissions = _parse(body['pagePermissions']);
      _hydrated = true;

      final prefs = await SharedPreferences.getInstance();
      if (_pagePermissions == null) {
        await prefs.remove(_prefsKey);
      } else {
        await prefs.setString(_prefsKey, jsonEncode(_pagePermissions));
      }
      await prefs.setBool(_prefsHydratedKey, true);
      changes.value++;
    } catch (e) {
      debugPrint('[PermissionService] refresh failed: $e');
    }
  }

  /// Clears in-memory and stored permissions (call on logout).
  static Future<void> clear() async {
    _pagePermissions = null;
    _hydrated = false;
    changes.value++;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_prefsKey);
      await prefs.remove(_prefsHydratedKey);
    } catch (_) {}
  }

  /// Accepts both backend shapes: `{href: bool}` (old, meaning view only) and
  /// `{href: {view, add, edit, delete, approve}}`.
  static Map<String, Map<String, bool>>? _parse(dynamic raw) {
    if (raw is! Map) return null;
    final result = <String, Map<String, bool>>{};
    raw.forEach((href, value) {
      if (value is bool) {
        result[href.toString()] = {'view': value};
      } else if (value is Map) {
        result[href.toString()] = {
          for (final e in value.entries) e.key.toString(): e.value == true,
        };
      }
    });
    return result;
  }
}
