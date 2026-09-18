import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// User model pulled from `/api/users`. Kept as a lightweight immutable
/// holder so screens don't index raw maps ad-hoc.
class AdminUser {
  AdminUser.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      employeeId = '${json['employeeId'] ?? ''}',
      mobileNumber = '${json['mobileNumber'] ?? ''}',
      email = '${json['email'] ?? ''}',
      firstName = '${json['firstName'] ?? ''}',
      lastName = '${json['lastName'] ?? ''}',
      role = '${json['role'] ?? ''}',
      branchId = json['branchId'] as String?,
      isActive = json['isActive'] == true,
      createdAt = '${json['createdAt'] ?? ''}',
      branch = (json['branch'] is Map)
          ? Map<String, dynamic>.from(json['branch'] as Map)
          : {},
      rbacRole = (json['rbacRole'] is Map)
          ? Map<String, dynamic>.from(json['rbacRole'] as Map)
          : {};

  final String id;
  final String employeeId;
  final String mobileNumber;
  final String email;
  final String firstName;
  final String lastName;
  final String role;
  final String? branchId;
  final bool isActive;
  final String createdAt;
  final Map<String, dynamic> branch;
  final Map<String, dynamic> rbacRole;

  String get fullName => '$firstName $lastName'.trim();
  String get branchName => '${branch['name'] ?? ''}';
  String get rbacRoleName => '${rbacRole['name'] ?? ''}';
}

/// RBAC role from `/api/admin/roles` or the public `/api/roles` endpoint.
class AdminRbacRole {
  final List<dynamic> permissions;

  AdminRbacRole.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      name = '${json['name'] ?? ''}',
      slug = '${json['slug'] ?? ''}',
      description = '${json['description'] ?? ''}',
      color = '${json['color'] ?? ''}',
      priority = (json['priority'] as num?)?.toInt() ?? 0,
      isActive = json['isActive'] != false,
      legacyRole = '${json['legacyRole'] ?? ''}',
      isSubAdmin = json['isSubAdmin'] == true,
      permissions = (json['permissions'] is List)
          ? List<dynamic>.from(json['permissions'] as List)
          : const [];

  final String id;
  final String name;
  final String slug;
  final String description;
  final String color;
  final int priority;
  final bool isActive;
  final String legacyRole;
  final bool isSubAdmin;
}

/// Backs the Admin -> Users + Roles screens. Handles: fetching users with
/// role/branch filters, creating users, resetting passwords, suspending
/// users, and listing RBAC roles/branches used by those forms.
class AdminUserController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isSaving = false.obs;
  final RxList<AdminUser> users = <AdminUser>[].obs;
  final RxList<AdminRbacRole> roles = <AdminRbacRole>[].obs;
  final RxList<dynamic> branches = <dynamic>[].obs;
  final RxString roleFilter = ''.obs;
  final RxString branchFilter = ''.obs;

  Future<void> loadUsers() async {
    try {
      isLoading.value = true;
      final params = <String>[];
      if (roleFilter.value.isNotEmpty) params.add('role=${roleFilter.value}');
      if (branchFilter.value.isNotEmpty) {
        params.add('branchId=${branchFilter.value}');
      }
      final url = params.isEmpty
          ? Api.usersUrl
          : '${Api.usersUrl}?${params.join('&')}';

      final response = await _connect.get(url);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          users.assignAll(
            (body['data'] as List).whereType<Map>().map(
              (u) => AdminUser.fromJson(Map<String, dynamic>.from(u)),
            ),
          );
          return;
        }
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to load users.',
      );
    } catch (e) {
      _showError(0, 'Request Error: $e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> loadRbacRoles() async {
    try {
      final response = await _connect.get(Api.superAdminRolesUrl);
      if (response.statusCode == 200) {
        final body = response.body;
        // Note: /api/admin/roles returns the list under `roles`, not `data`.
        if (body != null && body['success'] == true && body['roles'] is List) {
          roles.assignAll(
            (body['roles'] as List).whereType<Map>().map(
              (r) => AdminRbacRole.fromJson(Map<String, dynamic>.from(r)),
            ),
          );
          return;
        }
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to load roles.',
      );
    } catch (e) {
      _showError(0, 'Request Error: $e');
    }
  }

  Future<void> loadBranches() async {
    try {
      final response = await _connect.get(
        '${Api.branchesUrl}?includeInactive=true',
      );
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          branches.assignAll(body['data'] as List);
          return;
        }
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to load branches.',
      );
    } catch (e) {
      _showError(0, 'Request Error: $e');
    }
  }

  /// Creates a user via POST /api/users. The payload mirrors the web form
  /// (Role Base Access entity selection + branch assignment).
  Future<String?> createUser(Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.usersUrl, payload);
      if (response.statusCode == 200 || response.statusCode == 201) {
        if (response.body != null && response.body['success'] == true) {
          await loadUsers();
          return null;
        }
        return response.body?['message'] ?? 'Failed to create user.';
      }
      return response.body?['message'] ??
          'Failed to create user (${response.statusCode}).';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  /// Resets a user's password via POST /api/users/{id}/reset-password.
  Future<String?> resetPassword(String userId, String newPassword) async {
    try {
      isSaving.value = true;
      final url = Api.userResetPasswordUrl.replaceFirst('{id}', userId);
      final response = await _connect.post(url, {'newPassword': newPassword});
      if (response.statusCode == 200 && response.body?['success'] == true) {
        return null;
      }
      return response.body?['message'] ?? 'Failed to reset password.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  /// Suspends (isActive=false) a user via DELETE /api/users/{id}.
  Future<String?> suspendUser(AdminUser user) async {
    try {
      isSaving.value = true;
      final url = Api.usersWithRoleUrl.replaceFirst('{id}', user.id);
      final response = await _connect.delete(url);
      if (response.statusCode == 200 && response.body?['success'] == true) {
        await loadUsers();
        return null;
      }
      return response.body?['message'] ?? 'Failed to suspend user.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  void _showError(int? code, String message) {
    Get.snackbar(
      'Error $code',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.redAccent,
      colorText: Colors.white,
    );
  }

  /// --- User role assignments ------------------------------------------
  /// Fetch active and historical role assignments for a user via
  /// GET /api/admin/users/{userId}/roles
  Future<List<AdminUserRole>> fetchUserRoles(String userId) async {
    try {
      final url = Api.adminUsersRolesUrl.replaceFirst('{userId}', userId);
      final response = await _connect.get(url);
      if (response.statusCode == 200 &&
          response.body != null &&
          response.body['success'] == true) {
        final list = response.body['userRoles'] as List? ?? [];
        return list
            .whereType<Map>()
            .map((m) => AdminUserRole.fromJson(Map<String, dynamic>.from(m)))
            .toList();
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to fetch user roles.',
      );
      return [];
    } catch (e) {
      _showError(0, 'Request Error: $e');
      return [];
    }
  }

  /// Assign a role to a user — POST /api/admin/users/{userId}/roles
  Future<String?> assignRoleToUser(
    String userId,
    Map<String, dynamic> payload,
  ) async {
    try {
      isSaving.value = true;
      final url = Api.adminUsersRolesUrl.replaceFirst('{userId}', userId);
      final response = await _connect.post(url, payload);
      if ((response.statusCode == 200 || response.statusCode == 201) &&
          response.body?['success'] == true) {
        return null;
      }
      return response.body?['message'] ?? 'Failed to assign role.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  /// Remove a role assignment — DELETE /api/admin/users/{userId}/roles
  Future<String?> removeRoleFromUser(
    String userId,
    Map<String, dynamic> payload,
  ) async {
    try {
      isSaving.value = true;
      final url = Api.adminUsersRolesUrl.replaceFirst('{userId}', userId);
      final response = await _connect.request(url, 'DELETE', body: payload);
      if (response.statusCode == 200 && response.body?['success'] == true) {
        return null;
      }
      return response.body?['message'] ?? 'Failed to remove role.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }
}

/// Represents a role assignment for a user returned by the admin API.
class AdminUserRole {
  AdminUserRole.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      role = json['role'] is Map
          ? AdminRbacRole.fromJson(Map<String, dynamic>.from(json['role']))
          : AdminRbacRole.fromJson({}),
      branch = json['branch'] is Map
          ? Map<String, dynamic>.from(json['branch'])
          : {},
      expiresAt = json['expiresAt'] ?? null,
      isActive = json['isActive'] == true;

  final String id;
  final AdminRbacRole role;
  final Map<String, dynamic> branch;
  final String? expiresAt;
  final bool isActive;
}
