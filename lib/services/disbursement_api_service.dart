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
    String message =
        'Request failed${response.statusCode != null ? ' (${response.statusCode})' : ''}';
    if (body is Map) {
      final msg = body['message'] ?? body['error'];
      final details = body['details'];
      if (details is List && details.isNotEmpty) {
        final detailMsgs = details
            .map(
              (d) => d is Map
                  ? (d['message'] ?? (d['path'] is List ? d['path'].join('.') : ''))
                  : d.toString(),
            )
            .where((s) => s.toString().trim().isNotEmpty)
            .join('; ');
        message = '${msg ?? 'Validation Failed'}: $detailMsgs';
      } else if (msg != null) {
        message = msg.toString();
      }
    }
    throw DisbursementApiException(message);
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
    required String indexId,
    required String funderId,
    required List<Map<String, dynamic>> disbursements,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      Api.disbursementsBmDisburseUrl,
      {
        'centerId': centerId,
        'indexId': indexId,
        'funderId': funderId,
        'disbursements': disbursements,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/loans/{loanId}/member-individual-status`
  Future<Map<String, dynamic>> getMemberIndividualStatus(String loanId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.get(
      "${Api.baseUrl}/api/loans/$loanId/member-individual-status",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/clients/{clientId}/is-new`
  Future<Map<String, dynamic>> getClientIsNew(String clientId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.get(
      "${Api.baseUrl}/api/clients/$clientId/is-new",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/loans/{loanId}/gold-photos`
  Future<List<dynamic>> getGoldPhotos(String loanId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.get(
      "${Api.baseUrl}/api/loans/$loanId/gold-photos",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    if (data is Map && data['photos'] is List) {
      return data['photos'] as List;
    }
    return data is List ? data : <dynamic>[];
  }

  /// `POST /api/loans/{loanId}/gold-photos`
  Future<Map<String, dynamic>> uploadGoldPhoto(
    String loanId,
    List<int> bytes,
    String filename,
  ) async {
    final token = await _authToken();
    final formData = FormData({
      'photo': MultipartFile(bytes, filename: filename, contentType: 'image/jpeg'),
    });
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      "${Api.baseUrl}/api/loans/$loanId/gold-photos",
      formData,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `DELETE /api/loans/{loanId}/gold-photos/{photoId}`
  Future<void> deleteGoldPhoto(String loanId, String photoId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.delete(
      "${Api.baseUrl}/api/loans/$loanId/gold-photos/$photoId",
      headers: _authHeaders(token),
    );
    _unwrap(response);
  }
}
