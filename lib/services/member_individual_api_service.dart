import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Thrown by [MemberIndividualApiService] methods on a non-success response;
/// callers decide how to surface [message] (snackbar, inline field error...).
class MemberIndividualApiException implements Exception {
  MemberIndividualApiException(this.message);
  final String message;

  @override
  String toString() => message;
}

/// HTTP calls for the BM "Member Individual" feature — mirrors
/// `components/loan-module/MemberIndividualClient.tsx` /
/// `MemberIndividualDetailPage.tsx` on the web app (Cash Flow, Loan
/// Appraisal and House Hold Visit tabs only; GRT Sessions is web-only).
class MemberIndividualApiService {
  MemberIndividualApiService(this._client);

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
  /// [MemberIndividualApiException] with the backend's message/error when
  /// `success` isn't true.
  dynamic _unwrap(Response response) {
    final body = response.body;
    if (body is Map && body['success'] == true) {
      return body['data'];
    }
    final message = (body is Map ? (body['message'] ?? body['error']) : null);
    throw MemberIndividualApiException(
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

  Future<Map<String, dynamic>> _getMap(String url) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.get(url, headers: _authHeaders(token));
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  Future<Map<String, dynamic>> _patchMap(
    String url,
    Map<String, dynamic> payload,
  ) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 30);
    final response = await _client.patch(
      url,
      payload,
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `GET /api/member-individual?centerId=&indexId=` — center-wise roster
  /// of indexed, non-disbursed loans with per-tab completion status.
  Future<List<dynamic>> getRoster(String centerId, {String? indexId}) {
    final query = indexId != null && indexId.isNotEmpty
        ? '&indexId=$indexId'
        : '';
    return _getList("${Api.memberIndividualUrl}?centerId=$centerId$query");
  }

  /// `GET /api/member-individual/{loanId}` — full record for one loan
  /// (loan/center/client context, cash flow, loan appraisal, house hold
  /// visit + photos). Lazily created server-side on first visit.
  Future<Map<String, dynamic>> getMemberIndividual(String loanId) =>
      _getMap("${Api.memberIndividualUrl}/$loanId");

  /// `PATCH /api/member-individual/{loanId}/cash-flow` — saves the 8
  /// household expense fields and marks the tab complete.
  Future<Map<String, dynamic>> saveCashFlow(
    String loanId,
    Map<String, dynamic> payload,
  ) => _patchMap("${Api.memberIndividualUrl}/$loanId/cash-flow", payload);

  /// `PATCH /api/member-individual/{loanId}/loan-appraisal/complete` —
  /// marks the Loan Appraisal tab reviewed.
  Future<Map<String, dynamic>> completeLoanAppraisal(String loanId) =>
      _patchMap("${Api.memberIndividualUrl}/$loanId/loan-appraisal/complete", {});

  /// `POST /api/member-individual/{loanId}/household-visit/photos` —
  /// uploads a house visit photo with captured GPS. The mandatory photo is
  /// validated server-side against the center (500m) and, if the client has
  /// an enrolled location, against it too (100m, accuracy-tolerant).
  Future<Map<String, dynamic>> uploadHouseholdVisitPhoto(
    String loanId, {
    required List<int> bytes,
    required String filename,
    required String contentType,
    required bool isMandatory,
    double? latitude,
    double? longitude,
    double? accuracy,
    String? notes,
  }) async {
    final token = await _authToken();
    final formData = FormData({
      'photo': MultipartFile(bytes, filename: filename, contentType: contentType),
      'isMandatory': isMandatory.toString(),
      if (latitude != null) 'latitude': latitude.toString(),
      if (longitude != null) 'longitude': longitude.toString(),
      if (accuracy != null) 'accuracy': accuracy.toString(),
      if (notes != null && notes.isNotEmpty) 'notes': notes,
    });
    _client.timeout = const Duration(seconds: 60);
    final response = await _client.post(
      "${Api.memberIndividualUrl}/$loanId/household-visit/photos",
      formData,
      headers: {'Authorization': 'Bearer $token'},
    );
    final data = _unwrap(response);
    return data is Map ? Map<String, dynamic>.from(data) : <String, dynamic>{};
  }

  /// `DELETE /api/member-individual/{loanId}/household-visit/photos/{photoId}`
  /// — the completion check always uses the *earliest* uploaded mandatory
  /// photo, so an out-of-range one must be deleted (not just superseded by
  /// a later re-capture) before the tab can be completed.
  Future<void> deleteHouseholdVisitPhoto(String loanId, String photoId) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 20);
    final response = await _client.delete(
      "${Api.memberIndividualUrl}/$loanId/household-visit/photos/$photoId",
      headers: _authHeaders(token),
    );
    _unwrap(response);
  }

  /// `PATCH /api/member-individual/{loanId}/household-visit/complete` —
  /// validates the mandatory in-range photo exists, then marks the tab
  /// complete.
  Future<Map<String, dynamic>> completeHouseholdVisit(String loanId) =>
      _patchMap("${Api.memberIndividualUrl}/$loanId/household-visit/complete", {});

  /// `GET /api/loan-product-types?includeInactive=false`
  Future<List<dynamic>> getLoanProductTypes() =>
      _getList("${Api.loanProductTypesUrl}?includeInactive=false");

  /// `GET /api/products?branchId={branchId}` (with fallback to all products if empty)
  Future<List<dynamic>> getProductsForBranch(String branchId) async {
    if (branchId.isNotEmpty) {
      try {
        final res = await _getList("${Api.productsUrl}?branchId=$branchId");
        if (res.isNotEmpty) return res;
      } catch (_) {}
    }
    return _getList("${Api.productsUrl}?includeInactive=false");
  }

  /// `PATCH /api/disbursements/{loanId}/update-product` or `/api/loans/{loanId}/update-product`
  Future<Map<String, dynamic>> updateLoanProduct(
    String loanId, {
    required String loanProductId,
    required bool isIndexed,
    String stage = 'MEMBER_INDIVIDUAL',
  }) {
    final url = isIndexed
        ? "${Api.baseUrl}/api/disbursements/$loanId/update-product"
        : "${Api.loansUrl}/$loanId/update-product";

    final payload = <String, dynamic>{
      'loanProductId': loanProductId,
      if (isIndexed) 'stage': stage,
    };

    return _patchMap(url, payload);
  }

  /// `GET /api/geo/driving-distance?fromLat=&fromLng=&toLat=&toLng=` — road
  /// (driving) distance in meters, via the same OSRM-backed endpoint the web
  /// app's `useDrivingDistance` hook and Create Center's "KM From Branch"
  /// use. Falls back to straight-line server-side if OSRM is unreachable, so
  /// this always returns *some* value the software would agree with, unlike
  /// a client-computed haversine estimate.
  Future<double?> getDrivingDistanceMeters({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
  }) async {
    final data = await _getMap(
      "${Api.geoDrivingDistanceUrl}?fromLat=$fromLat&fromLng=$fromLng&toLat=$toLat&toLng=$toLng",
    );
    final km = data['distanceKm'];
    if (km == null) return null;
    final kmVal = km is num ? km.toDouble() : double.tryParse('$km');
    return kmVal == null ? null : kmVal * 1000;
  }

  /// `GET /api/storage/signed-url?key=` — resolves a private-bucket object
  /// key into a viewable signed URL.
  Future<String?> getSignedUrl(String key) async {
    final token = await _authToken();
    _client.timeout = const Duration(seconds: 15);
    final response = await _client.get(
      "${Api.signedUrlUrl}?key=${Uri.encodeQueryComponent(key)}",
      headers: _authHeaders(token),
    );
    final data = _unwrap(response);
    return data is Map ? data['url']?.toString() : null;
  }
}
