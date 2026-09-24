import 'package:shared_preferences/shared_preferences.dart';

/// Resolved role of the logged-in user. Mirrors the backend's raw `role`
/// values (ADMIN / AREA_MANAGER / BRANCH_MANAGER / FDO) as well as the
/// human-readable `rbacRoleName` and auto-generated RBAC role slugs — the
/// same tolerance used by the web app's role checks.
///
/// [headOffice] covers HR and executive roles (HR, HRM, CM-HR, CEO, COO, CAO,
/// Zonal Head, Division Manager). They have no branch/field dashboard on
/// mobile and the backend rejects them on ADMIN-only APIs, so they land on
/// the HRM screen.
enum AppRole { admin, headOffice, areaManager, branchManager, fdo, unknown }

/// Central place for role-based access decisions. Screens, menus and
/// permission checks should use these helpers instead of re-implementing
/// string matching (which previously drifted across controllers).
class RoleScope {
  RoleScope._();

  static const List<String> _branchTokens = [
    'BM',
    'BRANCH MANAGER',
    'BRANCH_MANAGER',
    'BRANCHMANAGER',
  ];

  static const List<String> _areaTokens = [
    'AM',
    'AREA MANAGER',
    'AREA_MANAGER',
    'AREAMANAGER',
  ];

  static bool _matches(String value, List<String> tokens, List<String> needles) {
    final v = value.trim().toUpperCase();
    if (v.isEmpty) return false;
    if (tokens.contains(v)) return true;
    return needles.any(v.contains);
  }

  static bool isAreaManager(String value) =>
      _matches(value, _areaTokens, const ['AREA', 'AREAMANAGER']);

  static bool isBranchManager(String value) =>
      _matches(value, _branchTokens, const ['BRANCH', 'BRANCHMANAGER']);

  static const List<String> _adminTokens = [
    'ADMIN',
    'ADMINISTRATOR',
    'SUPER ADMIN',
    'SUPER_ADMIN',
    'SUPERADMIN',
  ];

  /// Exact match only — the backend grants admin APIs to `role == 'ADMIN'`
  /// alone, so a substring match wrongly promoted e.g. "Chief
  /// Administrative Officer" (CAO) to the admin console.
  static bool isAdmin(String value) =>
      _adminTokens.contains(value.trim().toUpperCase());

  static const List<String> _headOfficeTokens = [
    'HR',
    'HRM',
    'CM-HR',
    'CEO',
    'COO',
    'CAO',
    'ZH',
    'DM',
    'DIVISION_MANAGER',
  ];

  static bool isHeadOffice(String value) => _matches(
    value,
    _headOfficeTokens,
    const ['HUMAN RESOURCE', 'CHIEF', 'ZONAL', 'DIVISION'],
  );

  /// Resolves an [AppRole] from either the raw `role` or the display
  /// `rbacRoleName` value. Admin wins over manager checks.
  static AppRole resolve(String role, String rbacRoleName) {
    if (isAdmin(role) || isAdmin(rbacRoleName)) return AppRole.admin;
    if (isHeadOffice(role) || isHeadOffice(rbacRoleName)) {
      return AppRole.headOffice;
    }
    if (isAreaManager(role) || isAreaManager(rbacRoleName)) {
      return AppRole.areaManager;
    }
    if (isBranchManager(role) || isBranchManager(rbacRoleName)) {
      return AppRole.branchManager;
    }
    if (role.isEmpty && rbacRoleName.isEmpty) return AppRole.unknown;
    return AppRole.fdo;
  }

  /// Reads the persisted role fields and resolves the active [AppRole].
  static Future<AppRole> current() async {
    final prefs = await SharedPreferences.getInstance();
    return resolve(
      prefs.getString('role') ?? '',
      prefs.getString('rbacRoleName') ?? '',
    );
  }

  static Future<bool> currentIsAreaManager() async =>
      (await current()) == AppRole.areaManager;
}
