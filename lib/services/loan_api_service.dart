import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Thrown by [LoanApiService] methods on a non-success response; callers
/// decide how to surface [message] (snackbar, inline field error...).
class LoanApiException implements Exception {
  LoanApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// HTTP calls for the Renewal Loan Application feature (FDO) — mirrors
/// `components/loan-module/ApplicationForm.tsx` on the web app.
class LoanApiService {
  LoanApiService(this._client);

  final ApiClient _client;

  Future<String> _authToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('accessToken') ?? '';
  }

  Map<String, String> _authHeaders(String token) => {
    'Authorization': 'Bearer $token',
    'Content-Type': 'application/json',
  };

  /// Unwraps `{success, data, message}`; throws [LoanApiException] with the
  /// backend's message/error when `success` isn't true.
  dynamic _unwrap(Response response) {
    final body = response.body;
    if (body is Map && body['success'] == true) {
      return body['data'];
    }
    final message = (body is Map ? (body['message'] ?? body['error']) : null);
    throw LoanApiException(
      message?.toString() ??
          'Request failed${response.statusCode != null ? ' (${response.statusCode})' : ''}',
    );
  }

  Future<List<dynamic>> _getList(String url) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(url, headers: _authHeaders(token));
    final data = _unwrap(response);
    return data is List ? data : <dynamic>[];
  }

  // ---------------------------------------------------------------------
  // Lookups (shared with the enrollment feature's endpoints)
  // ---------------------------------------------------------------------

  Future<List<dynamic>> getApprovedCenters() =>
      _getList("${Api.centersUrl}?status=APPROVED");

  Future<List<dynamic>> getLoanProductTypes() =>
      _getList("${Api.loanProductTypesUrl}?includeInactive=false");

  Future<List<dynamic>> getProducts(String branchId) =>
      _getList("${Api.productsUrl}?branchId=$branchId");

  Future<List<dynamic>> getLoanPurposeTypes() =>
      _getList(Api.loanPurposeTypesUrl);

  Future<List<dynamic>> getLoanPurposes(String purposeTypeId) => _getList(
    "${Api.loanPurposesUrl}?purposeTypeId=$purposeTypeId&includeInactive=false",
  );

  // ---------------------------------------------------------------------
  // Renewal-specific lookups
  // ---------------------------------------------------------------------

  /// `GET /api/loans/eligible-clients?centerId=` — VERIFIED clients in the
  /// center with at least one prior loan and no loan still awaiting
  /// indexation (renewal eligibility).
  Future<List<dynamic>> getEligibleClientsForRenewal(String centerId) =>
      _getList("${Api.loanEligibleClientsUrl}?centerId=$centerId");

  /// `GET /api/loans?centerId=&includeInactive=false` filtered client-side
  /// to loans still pending indexation — mirrors the web app's
  /// `fetchUnindexedLoans`.
  Future<List<dynamic>> getUnindexedLoans(String centerId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(
      "${Api.loansUrl}?centerId=$centerId&includeInactive=false",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    final loans = data is Map ? data['loans'] : null;
    if (loans is! List) return <dynamic>[];
    return loans.where((loan) {
      if (loan is! Map) return false;
      final status = loan['disbursementStatus'];
      final indexId = loan['indexId'];
      return (status == 'PENDING_LEVEL1' || status == 'APPROVED_LEVEL1') &&
          (indexId == null || indexId == '');
    }).toList();
  }

  /// `GET /api/clients/{clientId}/ongoing-loans` — active loans the selected
  /// client already has, surfaced as a warning before a renewal is created.
  Future<List<dynamic>> getOngoingLoans(String clientId) =>
      _getList("${Api.clientsUrl}/$clientId/ongoing-loans");

  /// `GET /api/co-applicants?clientId=&eligible=true` — this client's
  /// co-applicants that have passed full approval and are selectable.
  Future<List<dynamic>> getEligibleCoApplicants(String clientId) =>
      _getList("${Api.coApplicantsUrl}?clientId=$clientId&eligible=true");

  // ---------------------------------------------------------------------
  // Create / delete
  // ---------------------------------------------------------------------

  /// `POST /api/loans` — creates the renewal loan application.
  Future<Map<String, dynamic>> createLoan(
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.loansUrl,
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `DELETE /api/loans?id=` — soft delete an unindexed loan. Backend
  /// restricts FDOs to loans they created themselves.
  Future<void> deleteLoan(String id) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.delete(
      "${Api.loansUrl}?id=$id",
      headers: _authHeaders(token),
    );
    _unwrap(response);
  }

  // ---------------------------------------------------------------------
  // Loan Indexation (BM Loan Index Approval) — mirrors
  // `components/loan-module/LoanIndexationClient.tsx` on the web app.
  // ---------------------------------------------------------------------

  Future<Map<String, dynamic>> _getMap(String url) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(url, headers: _authHeaders(token));
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/loan-indexes/unindexed-loans?centerId=` — verified loans in
  /// the center that haven't been added to a loan index yet.
  Future<List<dynamic>> getUnindexedLoansForIndexation(String centerId) =>
      _getList("${Api.loanIndexesUnindexedLoansUrl}?centerId=$centerId");

  /// `GET /api/loan-indexes/next-id?branchId=&centerId=` — preview of the
  /// index number the next created index for this branch/center will get.
  Future<Map<String, dynamic>> getNextIndexNo(
    String branchId,
    String centerId,
  ) => _getMap(
    "${Api.loanIndexesNextIdUrl}?branchId=$branchId&centerId=$centerId",
  );

  /// `GET /api/loan-indexes?fromDate=&toDate=&centerId=` — created loan
  /// index batches, auto-scoped server-side to the caller's branch.
  Future<List<dynamic>> getLoanIndexes({
    String? fromDate,
    String? toDate,
    String? centerId,
  }) {
    final params = <String, String>{
      if (fromDate != null && fromDate.isNotEmpty) 'fromDate': fromDate,
      if (toDate != null && toDate.isNotEmpty) 'toDate': toDate,
      if (centerId != null && centerId.isNotEmpty) 'centerId': centerId,
    };
    final query = params.entries.map((e) => '${e.key}=${e.value}').join('&');
    return _getList(
      "${Api.loanIndexesUrl}${query.isNotEmpty ? '?$query' : ''}",
    );
  }

  /// `POST /api/loan-indexes` — creates a loan index batch from the
  /// selected loans for a center.
  Future<Map<String, dynamic>> createLoanIndex(
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      Api.loanIndexesUrl,
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `POST /api/loan-indexes/{indexId}/approve` — unified "Approve & Submit
  /// for Disbursement": approved loans go straight to PENDING_LEVEL2 (ready
  /// for AM review), rejected loans are marked REJECTED.
  Future<Map<String, dynamic>> approveLoanIndex(
    String indexId,
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.post(
      "${Api.loanIndexesUrl}/$indexId/approve",
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/loans/{loanId}/passbook?firstDueDate=` — passbook details
  /// and installment schedule preview.
  Future<Map<String, dynamic>> getPassbookData(
    String loanId, {
    String? firstDueDate,
  }) async {
    final query = firstDueDate != null && firstDueDate.isNotEmpty
        ? '?firstDueDate=$firstDueDate'
        : '';
    return _getMap("${Api.loansUrl}/$loanId/passbook$query");
  }
}
