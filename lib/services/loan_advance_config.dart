import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Mobile mirror of the web `useLoanAdvanceEnabled` hook — the Admin's
/// project-wide Loan Advance switch (web: Hub → Settings), backed by
/// `GET /api/settings/loan-advance`.
///
/// When disabled, every Loan Advance field, column, card and menu is hidden
/// and collections submit a Loan Advance of 0. The server enforces the same
/// switch, so this is about not showing controls that can't work.
///
/// Usage:
///   Obx(() => LoanAdvanceConfig.enabled ? field : const SizedBox.shrink())
///   if (LoanAdvanceConfig.enabled) ...[ ... ]
class LoanAdvanceConfig {
  LoanAdvanceConfig._();

  static const _prefsKey = 'loanAdvanceEnabled';

  /// Same default as the web: true until the server says otherwise.
  static final RxBool _enabled = true.obs;
  static DateTime? _fetchedAt;
  static Future<void>? _inFlight;

  /// Reactive read — use inside `Obx` so screens update when it changes.
  static bool get enabled => _enabled.value;

  /// Loads the last known value (instant, offline-safe), then refreshes from
  /// the server. Call once at startup / after login.
  static Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getBool(_prefsKey);
      if (cached != null) _enabled.value = cached;
    } catch (_) {}
    await refresh(force: true);
  }

  /// Fetches the switch from the server. Cached for 1 minute (like the
  /// server-side cache) unless [force] is true. Keeps the last known value
  /// on any failure.
  static Future<void> refresh({bool force = false}) {
    final fetchedAt = _fetchedAt;
    if (!force &&
        fetchedAt != null &&
        DateTime.now().difference(fetchedAt) < const Duration(minutes: 1)) {
      return Future.value();
    }
    return _inFlight ??= _fetch().whenComplete(() => _inFlight = null);
  }

  static Future<void> _fetch() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if ((prefs.getString('accessToken') ?? '').isEmpty) return;

      final client = ApiClient()..timeout = const Duration(seconds: 15);
      final response = await client.get(Api.loanAdvanceSettingUrl);
      final body = response.body;
      if (response.statusCode == 200 &&
          body is Map &&
          body['success'] == true &&
          body['data'] is Map &&
          body['data']['enabled'] is bool) {
        final value = body['data']['enabled'] as bool;
        _enabled.value = value;
        _fetchedAt = DateTime.now();
        await prefs.setBool(_prefsKey, value);
      }
    } catch (e) {
      if (kDebugMode) debugPrint('Loan Advance setting fetch failed: $e');
    }
  }

  /// True while an Admin save is in flight (drives the Settings switch).
  static final RxBool saving = false.obs;

  /// Admin-only: turns the feature on/off project-wide via
  /// `PUT /api/settings/loan-advance`. Returns null on success, else the
  /// error message (server rejects non-Admins with 403).
  static Future<String?> save(bool value) async {
    if (saving.value) return 'Please wait — saving.';
    saving.value = true;
    try {
      final client = ApiClient()..timeout = const Duration(seconds: 20);
      final response = await client.put(Api.loanAdvanceSettingUrl, {
        'enabled': value,
      });
      final body = response.body;
      if (response.statusCode == 200 && body is Map && body['success'] == true) {
        _enabled.value = value;
        _fetchedAt = DateTime.now();
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool(_prefsKey, value);
        return null;
      }
      final message = body is Map ? (body['message'] ?? body['error']) : null;
      return message?.toString() ??
          'Failed to save setting (${response.statusCode ?? 'no response'}).';
    } catch (e) {
      return 'Failed to save setting. Check your connection.';
    } finally {
      saving.value = false;
    }
  }

  /// Menu entries that only make sense with Loan Advance on (web:
  /// `requiresLoanAdvance` in navigation.config.ts).
  static const menuItems = {'Loan Advance Refund', 'Loan Advance Revert'};

  /// True if a menu entry should be shown.
  static bool showMenuItem(String name) =>
      enabled || !menuItems.contains(name);

  /// Drops Loan Advance entries from `{name, children: [...]}` module lists
  /// when the feature is off. Children may be plain names or `{name: ...}`.
  static List<Map<String, dynamic>> filterModules(
    List<Map<String, dynamic>> modules,
  ) {
    if (enabled) return modules;
    return modules.where((m) => showMenuItem('${m['name']}')).map((m) {
      final children = m['children'];
      if (children is! List) return m;
      return {
        ...m,
        'children': children
            .where(
              (c) => showMenuItem(c is Map ? '${c['name']}' : '$c'),
            )
            .toList(),
      };
    }).toList();
  }

  /// The amount to actually submit: the typed value when enabled, else 0.
  static double amount(num? value) =>
      enabled ? (value ?? 0).toDouble() : 0.0;
}
