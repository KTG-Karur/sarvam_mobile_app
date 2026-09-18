import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/admin_api_service.dart';

/// GL account model from `/api/masters/gl`.
class AdminGlAccount {
  AdminGlAccount.fromJson(Map<String, dynamic> json)
    : glId = '${json['glId'] ?? ''}',
      glName = '${json['glName'] ?? ''}',
      glType = '${json['glType'] ?? ''}',
      description = '${json['description'] ?? ''}',
      isActive = json['isActive'] != false;

  final String glId;
  final String glName;
  final String glType;
  final String description;
  final bool isActive;
}

/// Funder model from `/api/masters/funder`.
class AdminFunder {
  AdminFunder.fromJson(Map<String, dynamic> json)
    : funderId = '${json['funderId'] ?? ''}',
      funderName = '${json['funderName'] ?? ''}',
      principalGLId = '${json['principalGLId'] ?? ''}',
      interestGLId = '${json['interestGLId'] ?? ''}',
      interestPercent = json['interestPercent'] is num
          ? (json['interestPercent'] as num).toDouble()
          : (double.tryParse('${json['interestPercent'] ?? ''}') ?? 0),
      tdsPercent = json['tdsPercent'] is num
          ? (json['tdsPercent'] as num).toDouble()
          : (double.tryParse('${json['tdsPercent'] ?? ''}') ?? 0),
      isActive = json['isActive'] != false,
      principalGL = (json['principalGL'] is Map)
          ? Map<String, dynamic>.from(json['principalGL'] as Map)
          : {},
      interestGL = (json['interestGL'] is Map)
          ? Map<String, dynamic>.from(json['interestGL'] as Map)
          : {};

  final String funderId;
  final String funderName;
  final String principalGLId;
  final String interestGLId;
  final double interestPercent;
  final double tdsPercent;
  final bool isActive;
  final Map<String, dynamic> principalGL;
  final Map<String, dynamic> interestGL;
}

/// Loan Product model from `/api/products`.
class AdminLoanProduct {
  AdminLoanProduct.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      productName = '${json['productName'] ?? json['name'] ?? ''}',
      productCode = '${json['productCode'] ?? json['code'] ?? ''}',
      loanProductTypeName = '${json['loanProductTypeName'] ?? json['typeName'] ?? 'Micro Finance'}',
      minAmount = (json['minAmount'] as num?)?.toDouble() ?? 5000.0,
      maxAmount = (json['maxAmount'] as num?)?.toDouble() ?? 100000.0,
      interestRate = (json['interestRate'] as num?)?.toDouble() ?? 18.0,
      tenureMonths = json['tenureMonths'] as int? ?? 12,
      isActive = json['isActive'] != false;

  final String id;
  final String productName;
  final String productCode;
  final String loanProductTypeName;
  final double minAmount;
  final double maxAmount;
  final double interestRate;
  final int tenureMonths;
  final bool isActive;
}

/// Loan Purpose model from `/api/loan-purposes`.
class AdminLoanPurpose {
  AdminLoanPurpose.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      purposeName = '${json['purposeName'] ?? json['name'] ?? ''}',
      purposeCode = '${json['purposeCode'] ?? json['code'] ?? ''}',
      category = '${json['category'] ?? json['purposeTypeName'] ?? 'General'}',
      isActive = json['isActive'] != false;

  final String id;
  final String purposeName;
  final String purposeCode;
  final String category;
  final bool isActive;
}

/// Economic Activity model from `/api/economic-activities`.
class AdminEconomicActivity {
  AdminEconomicActivity.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      activityName = '${json['activityName'] ?? json['name'] ?? ''}',
      activityCode = '${json['activityCode'] ?? json['code'] ?? ''}',
      activityType = '${json['activityTypeName'] ?? json['type'] ?? 'Trade & Services'}',
      isActive = json['isActive'] != false;

  final String id;
  final String activityName;
  final String activityCode;
  final String activityType;
  final bool isActive;
}

/// Meeting Place model from `/api/masters/meeting-place`.
class AdminMeetingPlace {
  AdminMeetingPlace.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      placeName = '${json['placeName'] ?? json['name'] ?? ''}',
      landmark = '${json['landmark'] ?? ''}',
      villageName = '${json['villageName'] ?? json['village'] ?? ''}',
      isActive = json['isActive'] != false;

  final String id;
  final String placeName;
  final String landmark;
  final String villageName;
  final bool isActive;
}

/// Backs the Admin -> Masters screens.
class AdminMasterController extends GetxController {
  final ApiClient _connect = ApiClient();
  final AdminApiService _adminApiService = AdminApiService();

  final RxBool isLoading = false.obs;
  final RxBool isSaving = false.obs;

  final RxList<AdminGlAccount> glAccounts = <AdminGlAccount>[].obs;
  final RxList<AdminFunder> funders = <AdminFunder>[].obs;
  final RxList<AdminLoanProduct> loanProducts = <AdminLoanProduct>[].obs;
  final RxList<AdminLoanPurpose> loanPurposes = <AdminLoanPurpose>[].obs;
  final RxList<AdminEconomicActivity> economicActivities = <AdminEconomicActivity>[].obs;
  final RxList<AdminMeetingPlace> meetingPlaces = <AdminMeetingPlace>[].obs;

  Future<void> loadGlAccounts() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.glUrl);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          glAccounts.assignAll(
            (body['data'] as List).whereType<Map>().map(
              (g) => AdminGlAccount.fromJson(Map<String, dynamic>.from(g)),
            ),
          );
          return;
        }
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to load GL accounts.',
      );
    } catch (e) {
      _showError(0, 'Request Error: $e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<String?> createGlAccount(Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.glUrl, payload);
      if (response.statusCode == 200 || response.statusCode == 201) {
        if (response.body != null && response.body['success'] == true) {
          await loadGlAccounts();
          return null;
        }
        return response.body?['message'] ?? 'Failed to create GL account.';
      }
      return response.body?['message'] ??
          'Failed to create GL account (${response.statusCode}).';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  Future<void> loadFunders() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.fundersUrl);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true && body['data'] is List) {
          funders.assignAll(
            (body['data'] as List).whereType<Map>().map(
              (f) => AdminFunder.fromJson(Map<String, dynamic>.from(f)),
            ),
          );
          return;
        }
      }
      _showError(
        response.statusCode,
        response.body?['message'] ?? 'Failed to load funders.',
      );
    } catch (e) {
      _showError(0, 'Request Error: $e');
    } finally {
      isLoading.value = false;
    }
  }

  Future<String?> createFunder(Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.fundersUrl, payload);
      if (response.statusCode == 200 || response.statusCode == 201) {
        if (response.body != null && response.body['success'] == true) {
          await loadFunders();
          return null;
        }
        return response.body?['message'] ?? 'Failed to create funder.';
      }
      return response.body?['message'] ??
          'Failed to create funder (${response.statusCode}).';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }

  // ── Loan Products Master ──────────────────────────────────────────────────
  Future<void> loadLoanProducts() async {
    try {
      isLoading.value = true;
      final response = await _adminApiService.getLoanProducts();
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        if (data is List) {
          loanProducts.assignAll(
            data.whereType<Map>().map((p) => AdminLoanProduct.fromJson(Map<String, dynamic>.from(p))),
          );
          return;
        }
      }
    } catch (e) {
      debugPrint("Error loading loan products: $e");
    } finally {
      isLoading.value = false;
    }
  }

  // ── Loan Purposes Master ──────────────────────────────────────────────────
  Future<void> loadLoanPurposes() async {
    try {
      isLoading.value = true;
      final response = await _adminApiService.getLoanPurposes();
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        if (data is List) {
          loanPurposes.assignAll(
            data.whereType<Map>().map((p) => AdminLoanPurpose.fromJson(Map<String, dynamic>.from(p))),
          );
          return;
        }
      }
    } catch (e) {
      debugPrint("Error loading loan purposes: $e");
    } finally {
      isLoading.value = false;
    }
  }

  // ── Economic Activities Master ────────────────────────────────────────────
  Future<void> loadEconomicActivities() async {
    try {
      isLoading.value = true;
      final response = await _adminApiService.getEconomicActivities();
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        if (data is List) {
          economicActivities.assignAll(
            data.whereType<Map>().map((a) => AdminEconomicActivity.fromJson(Map<String, dynamic>.from(a))),
          );
          return;
        }
      }
    } catch (e) {
      debugPrint("Error loading economic activities: $e");
    } finally {
      isLoading.value = false;
    }
  }

  // ── Meeting Places Master ─────────────────────────────────────────────────
  Future<void> loadMeetingPlaces() async {
    try {
      isLoading.value = true;
      final response = await _adminApiService.getMeetingPlaces();
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        if (data is List) {
          meetingPlaces.assignAll(
            data.whereType<Map>().map((m) => AdminMeetingPlace.fromJson(Map<String, dynamic>.from(m))),
          );
          return;
        }
      }
    } catch (e) {
      debugPrint("Error loading meeting places: $e");
    } finally {
      isLoading.value = false;
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
}
