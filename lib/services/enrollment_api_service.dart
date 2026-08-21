import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Thrown by [EnrollmentApiService] methods on a non-success response;
/// callers decide how to surface [message] (snackbar, inline field error...).
class EnrollmentApiException implements Exception {
  EnrollmentApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// Owns every HTTP call the Member Enrollment feature needs (lookups,
/// uniqueness checks, IFSC/pincode, Highmark credit check, KYC upload,
/// enrollment submit, drafts). Kept separate from the GetX controller so the
/// controller file isn't also a ~15-endpoint HTTP client.
class EnrollmentApiService {
  EnrollmentApiService(this._client);

  final ApiClient _client;

  Future<String> _authToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('accessToken') ?? '';
  }

  Map<String, String> _authHeaders(String token) => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  /// Unwraps `{success, data, message}`; throws [EnrollmentApiException] with
  /// the backend's message/error when `success` isn't true.
  dynamic _unwrap(Response response) {
    final body = response.body;
    if (body is Map && body['success'] == true) {
      return body['data'];
    }
    final message = (body is Map ? (body['message'] ?? body['error']) : null);
    throw EnrollmentApiException(
      message?.toString() ??
          'Request failed${response.statusCode != null ? ' (${response.statusCode})' : ''}',
    );
  }

  Future<List<dynamic>> _getList(String url) async {
    try {
      final token = await _authToken();
      _client.timeout = const Duration(seconds: 20);
      final response = await _client.get(url, headers: _authHeaders(token));
      if (response.statusCode == 404) return <dynamic>[];
      final data = _unwrap(response);
      return data is List ? data : <dynamic>[];
    } catch (e) {
      debugPrint("EnrollmentApiService _getList error ($url): $e");
      return <dynamic>[];
    }
  }

  Future<Map<String, dynamic>?> _getMap(String url) async {
    try {
      final token = await _authToken();
      _client.timeout = const Duration(seconds: 20);
      final response = await _client.get(url, headers: _authHeaders(token));
      if (response.statusCode == 404) return null;
      final data = _unwrap(response);
      return data is Map ? Map<String, dynamic>.from(data) : null;
    } catch (e) {
      debugPrint("EnrollmentApiService _getMap error ($url): $e");
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------

  Future<List<dynamic>> getApprovedCenters() => _getList(
    "${Api.centersUrl}?status=APPROVED&includeInactive=false",
  );

  Future<List<dynamic>> getGroupsForCenter(
    String centerId, {
    bool availableOnly = true,
  }) async {
    if (centerId.isEmpty) return <dynamic>[];
    final availableGroups = await _getList(
      "${Api.groupsUrl}?centerId=$centerId&includeInactive=false"
      "${availableOnly ? '&availableOnly=true' : ''}",
    );
    if (availableGroups.isNotEmpty || !availableOnly) return availableGroups;
    // Fallback: fetch all active groups in center regardless of spare capacity
    return _getList("${Api.groupsUrl}?centerId=$centerId&includeInactive=false");
  }

  /// `GET /api/clients` — pass [noCenter] for Tab 1's "awaiting center
  /// assignment" roster, or [centerId] for Tab 2's "clients already in this
  /// center" roster (Center & Group Assignment feature, BM only). Unlike the
  /// other list endpoints, `data` here is `{clients: [...], pagination}`,
  /// not a bare array, so this can't reuse `_getList` as-is.
  Future<List<dynamic>> getClients({
    bool noCenter = false,
    String? centerId,
  }) async {
    try {
      final params = <String>['includeInactive=false', 'pageSize=1000'];
      if (noCenter) params.add('noCenter=true');
      if (centerId != null && centerId.isNotEmpty) params.add('centerId=$centerId');

      final token = await _authToken();
      _client.timeout = const Duration(seconds: 20);
      final response = await _client.get(
        "${Api.clientsUrl}?${params.join('&')}",
        headers: _authHeaders(token),
      );
      if (response.statusCode == 404) return <dynamic>[];
      final data = _unwrap(response);
      final clients = data is Map ? data['clients'] : null;
      return clients is List ? clients : <dynamic>[];
    } catch (e) {
      debugPrint("EnrollmentApiService getClients error: $e");
      return <dynamic>[];
    }
  }

  Future<List<dynamic>> getLoanProductTypes() =>
      _getList("${Api.loanProductTypesUrl}?includeInactive=false");

  Future<List<dynamic>> getProducts(String branchId) {
    if (branchId.isEmpty) return Future.value(<dynamic>[]);
    return _getList("${Api.productsUrl}?branchId=$branchId");
  }

  Future<List<dynamic>> getLoanPurposeTypes() =>
      _getList("${Api.loanPurposeTypesUrl}?includeInactive=false");

  Future<List<dynamic>> getLoanPurposes(String purposeTypeId) {
    if (purposeTypeId.isEmpty) return Future.value(<dynamic>[]);
    return _getList(
      "${Api.loanPurposesUrl}?purposeTypeId=$purposeTypeId&includeInactive=false",
    );
  }

  Future<List<dynamic>> getEconomicActivityTypes() =>
      _getList(Api.economicActivityTypesUrl);

  Future<List<dynamic>> getEconomicActivities(String activityTypeId) {
    if (activityTypeId.isEmpty) return Future.value(<dynamic>[]);
    return _getList("${Api.economicActivitiesUrl}?activityTypeId=$activityTypeId");
  }

  Future<Map<String, dynamic>?> lookupIfsc(String code) =>
      _getMap("${Api.ifscUrl}?code=$code");

  /// Direct call to the public India Post pincode API — deliberately NOT
  /// routed through [ApiClient] so our bearer token is never sent to a
  /// third-party host.
  Future<Map<String, dynamic>?> lookupPincode(String pincode) async {
    final plain = GetConnect(timeout: const Duration(seconds: 15));
    final response = await plain.get("${Api.pincodeLookupUrl}/$pincode");
    final body = response.body;
    if (body is List && body.isNotEmpty && body.first is Map) {
      return Map<String, dynamic>.from(body.first as Map);
    }
    return null;
  }

  Future<List<dynamic>> getEnrollmentValidationConfig() =>
      _getList(Api.enrollmentValidationUrl);

  // ---------------------------------------------------------------------
  // Identity uniqueness
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> checkIdentityUniqueness({
    required String field,
    required String value,
    required String side,
    String? siblingValue,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.post(
      Api.checkIdentityUniquenessUrl,
      {
        'field': field,
        'value': value,
        'side': side,
        if (siblingValue != null && siblingValue.isNotEmpty)
          'siblingValue': siblingValue,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Highmark / credit check
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> runHighmarkCheck(
    Map<String, dynamic> body,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      Api.highmarkCheckUrl,
      body,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>?> getLatestHighmarkReport(String aadhaar) =>
      _getMap("${Api.highmarkLatestUrl}?aadhaar=$aadhaar");

  // ---------------------------------------------------------------------
  // KYC document upload
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> uploadKycDocument({
    required List<int> bytes,
    required String filename,
    required String contentType,
    required String documentType,
    required String owner,
  }) async {
    final token = await _authToken();
    final formData = FormData({
      'file': MultipartFile(
        bytes,
        filename: filename,
        contentType: contentType,
      ),
      'clientId': 'pending-client',
      'documentType': documentType,
      'isEnrollment': 'true',
      'owner': owner,
    });
    _client.timeout = const Duration(seconds: 60);
    final response = await _client.post(
      Api.kycUploadUrl,
      formData,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Enrollment submit
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> submitEnrollment(
    Map<String, dynamic> body,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      Api.clientEnrollmentUrl,
      body,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Center & Group Assignment (BM only)
  // ---------------------------------------------------------------------

  /// `POST /api/client-operations/center-group-assign` — assigns a center
  /// AND an existing group (with spare capacity) to clients that currently
  /// have no center. Each entry: `{clientDbId, centerId, groupId}`.
  Future<Map<String, dynamic>> submitCenterGroupAssignments(
    List<Map<String, dynamic>> assignments,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.centerGroupAssignUrl,
      {'assignments': assignments},
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/client-operations/group-assign` — reassigns/unassigns
  /// clients already in [centerId] to a different group within the same
  /// center. Each entry: `{clientId, groupId?}` — omit/empty `groupId`
  /// means "remove from group".
  Future<Map<String, dynamic>> submitGroupReassignments(
    String centerId,
    List<Map<String, dynamic>> assignments,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.groupAssignUrl,
      {'centerId': centerId, 'assignments': assignments},
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Member Approval (client enrollment approval chain)
  // ---------------------------------------------------------------------

  /// `GET /api/approval/queue?allBranch=true&...` — the BM's flat approval
  /// queue (server auto-scopes to `SUBMITTED`/`PENDING_BM_REVIEW`/
  /// `BM_RETAKE_REQUIRED` clients in the BM's own branch). Unlike the other
  /// list endpoints, `data` is `{level, items: [...], totalPending,
  /// pagination}`, not a bare array.
  Future<List<dynamic>> getApprovalQueue({String search = ''}) async {
    final params = <String>['allBranch=true', 'page=1', 'limit=100'];
    if (search.isNotEmpty) params.add('search=${Uri.encodeQueryComponent(search)}');

    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(
      "${Api.approvalQueueUrl}?${params.join('&')}",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    final items = data is Map ? data['items'] : null;
    return items is List ? items : <dynamic>[];
  }

  /// `GET /api/approval/clients/{clientId}` — `clientId` here is the
  /// *business* client id string (e.g. "3-1-1-2"), not the DB id.
  Future<Map<String, dynamic>?> getApprovalClientDetail(String clientId) =>
      _getMap("${Api.approvalClientsUrl}/$clientId");

  /// `POST /api/approval/clients/{clientId}/action` — BM-relevant actions:
  /// `BM_SUBMIT_TO_AM`, `BM_RETAKE`, `BM_REJECT`. `remarks` required for
  /// RETAKE/REJECT.
  Future<Map<String, dynamic>> submitClientApprovalAction(
    String clientId,
    String action, {
    String? remarks,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      "${Api.approvalClientsUrl}/$clientId/action",
      {
        'action': action,
        if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/approval/clients/bulk-action` — execute stage-level action
  /// on multiple clients at once.
  Future<Map<String, dynamic>> submitBulkClientApprovalAction(
    List<String> clientIds,
    String action, {
    String? remarks,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 45);
    final response = await _client.post(
      "${Api.approvalClientsUrl}/bulk-action",
      {
        'clientIds': clientIds,
        'action': action,
        if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/approval/clients/{clientId}/documents/{documentId}/review` —
  /// per-document decision by the currently signed-in reviewer (BM writes
  /// `bmDecision`, AM writes `amDecision`, etc. — resolved server-side from
  /// the caller's role). `decision` is one of `VERIFIED`, `RETAKE_REQUIRED`,
  /// `DELETED`, `REJECTED`; `remark` is mandatory for anything but VERIFIED.
  Future<Map<String, dynamic>> reviewKycDocument(
    String clientId,
    String documentId,
    String decision, {
    String? remark,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      "${Api.approvalClientsUrl}/$clientId/documents/$documentId/review",
      {
        'decision': decision,
        if (remark != null && remark.isNotEmpty) 'remark': remark,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Co-Applicant Approval
  // ---------------------------------------------------------------------

  /// `GET /api/co-applicants/approval-queue` — BM's own-branch co-applicants
  /// currently pending at the BM stage. Plain array, not paginated.
  Future<List<dynamic>> getCoApplicantApprovalQueue() =>
      _getList(Api.coApplicantApprovalQueueUrl);

  /// `POST /api/co-applicants/{id}/action` — `id` is the co-applicant's DB
  /// id (not the client's). `action` is lowercase `'approve'`/`'reject'` —
  /// a different casing convention than the client action route above.
  /// `remarks` required only for `'reject'`.
  Future<Map<String, dynamic>> submitCoApplicantAction(
    String id,
    String action, {
    String? remarks,
  }) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      "${Api.coApplicantsUrl}/$id/action",
      {
        'action': action,
        if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
      },
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  // ---------------------------------------------------------------------
  // Storage (signed URLs for private-bucket KYC documents)
  // ---------------------------------------------------------------------

  /// `GET /api/storage/signed-url?key=` — resolves a private-bucket object
  /// key into a short-lived viewable URL. Legacy `https://` values pass
  /// through unchanged server-side.
  Future<String?> getSignedUrl(String key) async {
    final result = await _getMap(
      "${Api.signedUrlUrl}?key=${Uri.encodeQueryComponent(key)}",
    );
    return result?['url']?.toString();
  }

  // ---------------------------------------------------------------------
  // Drafts
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>?> saveDraft(Map<String, dynamic> body) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.clientDraftUrl,
      body,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : null;
  }

  Future<Map<String, dynamic>?> loadDraft(String mobile) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(
      "${Api.clientDraftUrl}?mobile=$mobile",
      headers: _authHeaders(token),
    );
    final body = response.body;
    if (body is Map && body['success'] == true) {
      final data = body['data'];
      return data is Map ? Map<String, dynamic>.from(data) : null;
    }
    // A "no draft found" response is not an error condition for callers.
    return null;
  }

  Future<void> deleteDraft(String id) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    await _client.delete(
      "${Api.clientDraftUrl}?id=$id",
      headers: _authHeaders(token),
    );
  }
}
