import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/api_client.dart';

/// Backs the BM/AM "correct a collection" screens. Unlike a normal amount
/// edit, the backend only supports *reversing* (voiding) an already-approved
/// collection so it can be recollected — see reverseTransactions(). This is
/// restricted server-side to ADMIN/AREA_MANAGER/BRANCH_MANAGER.
class CollectionReversalController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;

  final RxList<dynamic> centers = <dynamic>[].obs;
  final RxList<dynamic> clients = <dynamic>[].obs;

  final RxList<dynamic> batches = <dynamic>[].obs;
  final RxString batchesCenterName = ''.obs;
  final RxString batchesCenterCode = ''.obs;

  final RxMap<String, dynamic> batchDetail = <String, dynamic>{}.obs;

  final RxList<dynamic> nonDemandCollections = <dynamic>[].obs;

  /// Loads centers for a given branch (used to populate the center picker
  /// on the entry screen — same endpoint/params FDO's collection screens use).
  Future<bool> getCenters(String branchId) async {
    try {
      isLoading.value = true;
      centers.clear();

      final url =
          "${Api.centersUrl}?branchId=$branchId&includeInactive=false&status=APPROVED";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          centers.assignAll(body['data']);
          return true;
        }
      }
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Loads clients for a given center (used by the single-collection screen
  /// to pick whose non-demand collections to review).
  Future<bool> getClients(String centerId) async {
    try {
      isLoading.value = true;
      clients.clear();

      final url =
          "${Api.clientsUrl}?centerId=$centerId&includeInactive=false&pageSize=1000";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        final data = body?['data'];
        if (body != null && body['success'] == true && data != null && data['clients'] is List) {
          clients.assignAll(data['clients']);
          return true;
        }
      }
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Lists reversible collection batches for a center+date. [type] is
  /// 'demand' or 'arrear'. Both backend endpoints are read-only queries but
  /// are (unusually) exposed over PATCH rather than GET.
  Future<bool> getBatches({
    required String type,
    required String centerId,
    required String date,
  }) async {
    try {
      isLoading.value = true;
      batches.clear();

      final baseUrl =
          type == 'arrear' ? Api.arrearCollectionUrl : Api.demandCollectionUrl;
      final url = "$baseUrl?centerId=$centerId&date=$date";
      debugPrint("Request PATCH URL: $url");

      final response = await _connect.patch(url, null);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          final data = body['data'];
          if (data != null && data['batches'] is List) {
            batches.assignAll(data['batches']);
            batchesCenterName.value = "${data['centerName'] ?? ''}";
            batchesCenterCode.value = "${data['centerCode'] ?? ''}";
            return true;
          }
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to load collection batches.');
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Fetches full detail for one collection batch — the meeting photo,
  /// current denomination breakdown, and every transaction in it — needed
  /// before a BM/AM can pick what to reverse.
  Future<bool> getBatchDetail({required String collectionBatchId}) async {
    try {
      isLoading.value = true;
      batchDetail.clear();

      final url = "${Api.reverseMeetingUrl}?collectionBatchId=$collectionBatchId";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] != null) {
          batchDetail.assignAll(Map<String, dynamic>.from(body['data']));
          return true;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to load batch details.');
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Fetches a client's reversible "Non Demand Collection" transactions —
  /// the ad-hoc single-collection flow, which has no meeting/denomination.
  Future<bool> getNonDemandCollections({required String clientId}) async {
    try {
      isLoading.value = true;
      nonDemandCollections.clear();

      final url = "${Api.nonDemandCollectionUrl}?clientId=$clientId";
      debugPrint("Request GET URL: $url");

      final response = await _connect.get(url);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        // Unlike demand/arrear, this endpoint's `data` IS the list directly
        // (not wrapped in a `{collections: [...]}` object).
        if (body != null && body['success'] == true && body['data'] is List) {
          nonDemandCollections.assignAll(body['data']);
          return true;
        }
      }

      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to load collection history.');
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Reverses (voids) one or more already-approved collection transactions.
  /// Pass either [transactionId] (single, non-demand flow) or
  /// [transactionIds] (batch flow, always as a list even for one row).
  /// [denomination] is only meaningful — and only accepted by the backend —
  /// when every reversed transaction shares one collectionBatchId.
  Future<bool> reverseTransactions({
    List<String>? transactionIds,
    String? transactionId,
    String? remarks,
    Map<String, dynamic>? denomination,
  }) async {
    try {
      isLoading.value = true;

      final body = <String, dynamic>{
        if (transactionId != null) 'transactionId': transactionId,
        if (transactionIds != null) 'transactionIds': transactionIds,
        if (remarks != null && remarks.isNotEmpty) 'remarks': remarks,
        if (denomination != null) 'denomination': denomination,
      };

      debugPrint("Request POST URL: ${Api.reverseCollectionUrl}");
      debugPrint("Request Body: $body");

      final response = await _connect.post(Api.reverseCollectionUrl, body);

      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Status Text: ${response.statusText}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resBody = response.body;
        if (resBody != null && resBody['success'] == true) {
          Get.snackbar(
            'Success',
            "${resBody['message'] ?? 'Transaction(s) reversed successfully'}",
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.green,
            colorText: Colors.white,
          );
          return true;
        }
      }

      // Surface the backend's exact message (e.g. the DENOM_MISMATCH totals,
      // or the EOD/role-guard reason) rather than a generic string — the
      // user needs those specifics to correct their input.
      final errorMsg =
          response.body?['error'] ??
          response.body?['message'] ??
          (response.statusCode == null
              ? 'Network error: ${response.statusText ?? "Could not reach the server. Check your internet connection."}'
              : 'Failed to reverse the transaction(s).');
      Get.snackbar(
        'Error ${response.statusCode}',
        errorMsg,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } catch (e) {
      debugPrint("Request Error: $e");
      Get.snackbar(
        'Request Error',
        e.toString(),
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /// Returns the branch(es) the current user may act on. BM: just their own
  /// (no extra call needed). AM: every branch in their `assignedBranchIds`,
  /// filtered client-side since GET /api/branches isn't role-filtered.
  Future<List<Map<String, String>>> getBranchesForCurrentUser() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('role') ?? '').trim();
    final rbacRoleName = (prefs.getString('rbacRoleName') ?? '').trim();
    final primaryBranch = {
      'id': prefs.getString('branchId') ?? '',
      'name': prefs.getString('branchName') ?? '',
      'code': prefs.getString('branchCode') ?? '',
    };

    final isAM = RoleScope.isAreaManager(role) || RoleScope.isAreaManager(rbacRoleName);
    if (!isAM) {
      return primaryBranch['id']!.isNotEmpty ? [primaryBranch] : [];
    }

    final assignedBranchIds = List<String>.from(
      prefs.getStringList('assignedBranchIds') ?? [],
    );
    if (primaryBranch['id']!.isNotEmpty &&
        !assignedBranchIds.contains(primaryBranch['id'])) {
      assignedBranchIds.add(primaryBranch['id']!);
    }

    if (assignedBranchIds.isEmpty) {
      return primaryBranch['id']!.isNotEmpty ? [primaryBranch] : [];
    }

    try {
      final response = await _connect.get(Api.branchesUrl);
      debugPrint("Request GET URL: ${Api.branchesUrl}");
      debugPrint("Response Status Code: ${response.statusCode}");
      debugPrint("Response Body: ${response.body}");

      if (response.statusCode == 200) {
        final body = response.body;
        final data = body?['data'];
        final List<dynamic> allBranches = data is List
            ? data
            : (data != null && data['branches'] is List
                  ? data['branches']
                  : const []);

        final filtered = allBranches
            .whereType<Map>()
            .where((b) => assignedBranchIds.contains("${b['id']}"))
            .map(
              (b) => {
                'id': "${b['id'] ?? ''}",
                'name': "${b['name'] ?? ''}",
                'code': "${b['code'] ?? ''}",
              },
            )
            .toList();

        if (filtered.isNotEmpty) return filtered;
      }
    } catch (e) {
      debugPrint("Request Error (getBranchesForCurrentUser): $e");
    }

    return primaryBranch['id']!.isNotEmpty ? [primaryBranch] : [];
  }
}
