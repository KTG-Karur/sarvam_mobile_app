import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/permission_service.dart';

/// Page actions an admin can grant on the web's Role Permissions screen.
enum PageAction { view, add, edit, delete, approve }

/// Web page paths used as permission keys. They are the exact `href`s the web
/// Role Permissions screen stores, so a grant made there matches here.
class PagePaths {
  PagePaths._();

  static const memberIndividual = '/dashboard/loan-module/member-individual';
}

/// Mobile equivalent of the web's access decision
/// (`resolvePageAuthorization` on screens, `withRoleOrPageAction` on the API):
///
///  1. Admin always has access.
///  2. A built-in role listed in [builtInRoles] has access (the "legacy"
///     allow-list the web hardcodes per page).
///  3. Otherwise a page permission granted through RBAC adds access: the page's
///     `view` must be granted, plus the requested action when it isn't `view`.
///
/// This only decides what the app shows. The backend still enforces access, so
/// a wrong answer here can hide a button but can't expose data.
class PageAccess {
  PageAccess._();

  /// Pure decision, so it can be unit tested without prefs or network.
  /// [pagePermissions] is `null` when nothing is configured.
  static bool canFor({
    required AppRole role,
    required String page,
    PageAction action = PageAction.view,
    List<AppRole> builtInRoles = const [],
    required Map<String, Map<String, bool>>? pagePermissions,
  }) {
    if (role == AppRole.admin) return true;
    if (builtInRoles.contains(role)) return true;

    final grant = pagePermissions?[page];
    if (grant == null || grant['view'] != true) return false;
    return action == PageAction.view || grant[action.name] == true;
  }

  /// Decision for the logged-in user, using the stored role and the
  /// permissions held by [PermissionService]. Call [PermissionService.loadCached]
  /// first (the home router already does) so the data is present.
  static Future<bool> can(
    String page, {
    PageAction action = PageAction.view,
    List<AppRole> builtInRoles = const [],
  }) async {
    return canFor(
      role: await RoleScope.current(),
      page: page,
      action: action,
      builtInRoles: builtInRoles,
      pagePermissions: PermissionService.pagePermissions,
    );
  }

  /// Write access, matching the web APIs' `['add', 'edit']` rule: the page's
  /// `view` plus `add` or `edit` must be granted (unless admin / built-in role).
  static bool canWriteFor({
    required AppRole role,
    required String page,
    List<AppRole> builtInRoles = const [],
    required Map<String, Map<String, bool>>? pagePermissions,
  }) {
    if (role == AppRole.admin || builtInRoles.contains(role)) return true;
    final grant = pagePermissions?[page];
    return grant != null &&
        grant['view'] == true &&
        (grant['add'] == true || grant['edit'] == true);
  }

  /// [canWriteFor] for the logged-in user.
  static Future<bool> canWrite(
    String page, {
    List<AppRole> builtInRoles = const [],
  }) async {
    return canWriteFor(
      role: await RoleScope.current(),
      page: page,
      builtInRoles: builtInRoles,
      pagePermissions: PermissionService.pagePermissions,
    );
  }
}
