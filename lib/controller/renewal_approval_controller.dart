import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// The queue behind Member Approval's "Renewal Loan Approval" tab — mirrors
/// the web's `RenewalLoanApprovalQueue`. The server returns only the renewals
/// waiting at the stage(s) the logged-in user's role holds (BM, AM, QC, any
/// configured stage, plus the Admin final review), within the user's
/// branches, so the app needs no role logic of its own.
class RenewalApprovalController extends GetxController {
  final ApiClient _api = ApiClient();

  /// Queue rows: id, loanNumber, amount, renewalApprovalStatus, clientId (the
  /// internal id), clientDisplayId, clientName, mobileNumber, centerName,
  /// productName, kycDocCount, fdoName.
  final items = <Map<String, dynamic>>[].obs;

  /// Branches (within the caller's scope) that have renewals in the queue:
  /// id, name, code, count.
  final branches = <Map<String, dynamic>>[].obs;

  final isLoading = false.obs;
  final search = ''.obs;

  /// '' = all branches.
  final branchId = ''.obs;

  /// [silent] skips the error snackbar — used for the background load when
  /// Member Approval opens, so users without a renewal role aren't nagged.
  Future<void> load({bool silent = false}) async {
    isLoading.value = true;
    try {
      final params = <String, String>{'search': search.value};
      if (branchId.value.isNotEmpty) params['branchId'] = branchId.value;
      final url = Uri.parse(
        '${Api.baseUrl}/api/approval/loans/renewal-queue',
      ).replace(queryParameters: params).toString();

      final response = await _api.get(url);
      final body = response.body;
      if (body is Map && body['success'] == true && body['data'] is Map) {
        final data = Map<String, dynamic>.from(body['data'] as Map);
        items.assignAll(_maps(data['items']));
        branches.assignAll(_maps(data['branches']));
      } else if (!silent) {
        _error(_message(body) ?? 'Failed to load the renewal queue.');
      }
    } catch (_) {
      if (!silent) _error('Failed to load the renewal queue.');
    } finally {
      isLoading.value = false;
    }
  }

  List<Map<String, dynamic>> _maps(dynamic raw) => raw is List
      ? raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList()
      : <Map<String, dynamic>>[];

  String? _message(dynamic body) {
    if (body is! Map) return null;
    final m = (body['message'] ?? body['error'])?.toString();
    return m == null || m.isEmpty ? null : m;
  }

  void _error(String message) {
    Get.snackbar(
      'Error',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: Colors.redAccent,
      colorText: Colors.white,
    );
  }
}
