import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Thrown by [DisbursementApiService] methods on a non-success response;
/// callers decide how to surface [message] (snackbar, inline field error...).
class DisbursementApiException implements Exception {
  DisbursementApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// HTTP calls for the disbursement lifecycle's two approval-adjacent
/// screens — AM's "Disbursement Approval" (Level 2, mirrors
/// `DisbursementClient.tsx`) and BM's "Final Disbursement" (mirrors
/// `FinalDisbursementClient.tsx`). Product-edit, Highmark, the ongoing-loans
/// review dialog, gold-loan detail capture, admission-fee editing and the
/// Member-Individual refresh button stay web-only for now.
class DisbursementApiService {
  DisbursementApiService(this._client);

  final ApiClient _client;

  Future<String> _authToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('accessToken') ?? '';
  }

  Map<String, String> _authHeaders(String token) => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  /// Unwraps `{success, data, message}`; throws
  /// [DisbursementApiException] with the backend's message/error when
  /// `success` isn't true.
  dynamic _unwrap(Response response) {
    final body = response.body;
    if (body is Map && body['success'] == true) {
      return body['data'];
    }
    final message = (body is Map ? (body['message'] ?? body['error']) : null);
    throw DisbursementApiException(
      message?.toString() ??
          'Request failed${response.statusCode != null ? ' (${response.statusCode})' : ''}',
    );
  }

  /// `GET /api/branches?includeInactive=false` — not role-scoped server-side;
  /// an AM selecting a branch they aren't assigned to gets a 403 from
  /// [getPendingLevel2Details], same as on web.
  Future<List<dynamic>> getBranches() async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(
      "${Api.branchesUrl}?includeInactive=false",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is List ? data : <dynamic>[];
  }

  /// `GET /api/disbursements/pending-level2-details?branchId=&fromDate=&toDate=`
  /// — index batches with PENDING_LEVEL2 loans for this branch, each loan
  /// flagged `isVerified` (Member Individual + GRT complete).
  Future<Map<String, dynamic>> getPendingLevel2Details({
    required String branchId,
    String? fromDate,
    String? toDate,
  }) async {
    final params = <String, String>{
      'branchId': branchId,
      if (fromDate != null && fromDate.isNotEmpty) 'fromDate': fromDate,
      if (toDate != null && toDate.isNotEmpty) 'toDate': toDate,
    };
    final query = params.entries.map((e) => '${e.key}=${e.value}').join('&');
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.get(
      "${Api.disbursementsPendingLevel2DetailsUrl}?$query",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/disbursements/level2-action` — approves (APPROVED_LEVEL2) or
  /// rejects (REJECTED) all PENDING_LEVEL2 loans in [indexIds] for
  /// [centerId]. Callers must group selected index batches by centerId
  /// first — this endpoint only accepts one center at a time.
  Future<Map<String, dynamic>> level2Action({
    required String centerId,
    required String action,
    required List<String> indexIds,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.disbursementsLevel2ActionUrl,
      {'centerId': centerId, 'action': action, 'indexIds': indexIds},
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // BM Final Disbursement
  // ---------------------------------------------------------------------

  /// `GET /api/masters/funder` — active funders; funding source is
  /// mandatory before a BM can select an index for disbursement.
  Future<List<dynamic>> getFunders() async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(
      Api.fundersUrl,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is List ? data : <dynamic>[];
  }

  /// `GET /api/disbursements/approved-level2?branchId=` — AM-approved
  /// (APPROVED_LEVEL2) loans for this branch, grouped by index — these are
  /// ready for the BM's final disbursement.
  Future<Map<String, dynamic>> getApprovedLevel2({
    required String branchId,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.get(
      "${Api.disbursementsApprovedLevel2Url}?branchId=$branchId",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/disbursements/bm-disburse` — marks every loan in
  /// [disbursements] DISBURSED: generates its repayment schedule (from the
  /// First Due Date set at indexation) and posts the GL entries. Server
  /// re-enforces the Member Individual + GRT gate as a final defense even
  /// though AM already approved these loans.
  Future<Map<String, dynamic>> bmDisburse({
    required String centerId,
    required String funderId,
    required List<Map<String, dynamic>> disbursements,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      Api.disbursementsBmDisburseUrl,
      {'centerId': centerId, 'funderId': funderId, 'disbursements': disbursements},
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }
}
