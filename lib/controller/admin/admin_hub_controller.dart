import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Region model from `/api/regions`.
class RegionModel {
  RegionModel.fromJson(Map<String, dynamic> json)
      : id = '${json['id'] ?? ''}',
        name = '${json['name'] ?? ''}',
        code = '${json['code'] ?? ''}',
        isActive = json['isActive'] != false,
        divisionsCount = (json['_count'] is Map && json['_count']['divisions'] != null)
            ? (json['_count']['divisions'] as num).toInt()
            : 0;

  final String id;
  final String name;
  final String code;
  final bool isActive;
  final int divisionsCount;
}

/// Division model from `/api/divisions`.
class DivisionModel {
  DivisionModel.fromJson(Map<String, dynamic> json)
      : id = '${json['id'] ?? ''}',
        name = '${json['name'] ?? ''}',
        code = '${json['code'] ?? ''}',
        regionId = '${json['regionId'] ?? ''}',
        regionName = (json['region'] is Map) ? '${json['region']['name'] ?? ''}' : '',
        regionCode = (json['region'] is Map) ? '${json['region']['code'] ?? ''}' : '',
        isActive = json['isActive'] != false,
        areasCount = (json['_count'] is Map && json['_count']['areas'] != null)
            ? (json['_count']['areas'] as num).toInt()
            : 0;

  final String id;
  final String name;
  final String code;
  final String regionId;
  final String regionName;
  final String regionCode;
  final bool isActive;
  final int areasCount;
}

/// Area model from `/api/areas`.
class AreaModel {
  AreaModel.fromJson(Map<String, dynamic> json)
      : id = '${json['id'] ?? ''}',
        name = '${json['name'] ?? ''}',
        code = '${json['code'] ?? ''}',
        divisionId = '${json['divisionId'] ?? ''}',
        divisionName = (json['division'] is Map) ? '${json['division']['name'] ?? ''}' : '',
        divisionCode = (json['division'] is Map) ? '${json['division']['code'] ?? ''}' : '',
        isActive = json['isActive'] != false,
        branchesCount = (json['_count'] is Map && json['_count']['branches'] != null)
            ? (json['_count']['branches'] as num).toInt()
            : 0;

  final String id;
  final String name;
  final String code;
  final String divisionId;
  final String divisionName;
  final String divisionCode;
  final bool isActive;
  final int branchesCount;
}

/// Branch model from `/api/branches`.
class BranchModel {
  BranchModel.fromJson(Map<String, dynamic> json)
      : id = '${json['id'] ?? ''}',
        name = '${json['name'] ?? json['branchName'] ?? ''}',
        code = '${json['code'] ?? json['branchCode'] ?? ''}',
        address = '${json['address'] ?? ''}',
        isHeadOffice = json['isHeadOffice'] == true,
        isActive = json['isActive'] != false,
        areaId = json['areaId'] != null ? '${json['areaId']}' : null,
        areaName = (json['area'] is Map) ? '${json['area']['name'] ?? ''}' : '';

  final String id;
  final String name;
  final String code;
  final String address;
  final bool isHeadOffice;
  final bool isActive;
  final String? areaId;
  final String areaName;
}

/// Product model for mapping.
class BranchProductModel {
  BranchProductModel({
    required this.id,
    required this.productId,
    required this.productName,
    required this.productCode,
    required this.frequency,
    required this.loanAmount,
    required this.totalDues,
    required this.interest,
    this.isAccessible = false,
  });

  factory BranchProductModel.fromJson(Map<String, dynamic> json, {bool isAccessible = false}) {
    return BranchProductModel(
      id: '${json['id'] ?? ''}',
      productId: '${json['productId'] ?? json['id'] ?? ''}',
      productName: '${json['productName'] ?? json['name'] ?? ''}',
      productCode: '${json['productCode'] ?? json['code'] ?? ''}',
      frequency: '${json['frequency'] ?? json['loanProductTypeName'] ?? 'WEEKLY'}',
      loanAmount: (json['loanAmount'] as num?)?.toDouble() ??
          (json['maxAmount'] as num?)?.toDouble() ??
          50000.0,
      totalDues: (json['totalDues'] as num?)?.toInt() ??
          (json['tenureMonths'] as num?)?.toInt() ??
          52,
      interest: (json['interest'] as num?)?.toDouble() ??
          (json['interestRate'] as num?)?.toDouble() ??
          5000.0,
      isAccessible: isAccessible,
    );
  }

  final String id;
  final String productId;
  final String productName;
  final String productCode;
  final String frequency;
  final double loanAmount;
  final int totalDues;
  final double interest;
  bool isAccessible;
}

/// Branch Lock record model from `/api/branches/lock`.
class BranchLockModel {
  BranchLockModel.fromJson(Map<String, dynamic> json)
      : id = '${json['id'] ?? ''}',
        branchId = '${json['branchId'] ?? ''}',
        branchCode = '${json['branchCode'] ?? ''}',
        branchName = '${json['branchName'] ?? ''}',
        currentWorkingDate = '${json['currentWorkingDate'] ?? ''}',
        effectiveWindowStartAt = '${json['effectiveWindowStartAt'] ?? ''}',
        effectiveWindowEndAt = '${json['effectiveWindowEndAt'] ?? ''}',
        manualOverrideUntil = json['manualOverrideUntil'] != null ? '${json['manualOverrideUntil']}' : null,
        manualOverrideReason = json['manualOverrideReason'] != null ? '${json['manualOverrideReason']}' : null,
        isManuallyExtended = json['isManuallyExtended'] == true,
        writableNow = json['writableNow'] == true;

  final String id;
  final String branchId;
  final String branchCode;
  final String branchName;
  final String currentWorkingDate;
  final String effectiveWindowStartAt;
  final String effectiveWindowEndAt;
  final String? manualOverrideUntil;
  final String? manualOverrideReason;
  final bool isManuallyExtended;
  final bool writableNow;
}

/// Main controller backing Hub Management, Product Map, and Extend Branch Lock screens.
class AdminHubController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isSaving = false.obs;

  // Lists
  final RxList<RegionModel> regions = <RegionModel>[].obs;
  final RxList<DivisionModel> divisions = <DivisionModel>[].obs;
  final RxList<AreaModel> areas = <AreaModel>[].obs;
  final RxList<BranchModel> branches = <BranchModel>[].obs;
  final RxList<BranchProductModel> products = <BranchProductModel>[].obs;
  final RxMap<String, bool> productMappings = <String, bool>{}.obs;
  final RxList<BranchLockModel> branchLocks = <BranchLockModel>[].obs;

  // ------------------ REGIONS ------------------
  Future<void> loadRegions() async {
    try {
      isLoading.value = true;
      final response = await _connect.get('${Api.regionsUrl}?includeInactive=true');
      if (response.body != null) {
        final body = response.body;
        List rawList = [];
        if (body is List) {
          rawList = body;
        } else if (body is Map && body['data'] is List) {
          rawList = body['data'] as List;
        } else if (body is Map && body['regions'] is List) {
          rawList = body['regions'] as List;
        }
        if (rawList.isNotEmpty || (body is Map && body['success'] == true)) {
          regions.assignAll(
            rawList.whereType<Map>().map(
                  (r) => RegionModel.fromJson(Map<String, dynamic>.from(r)),
                ),
          );
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load regions: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> createRegion(String name, String code) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.regionsUrl, {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
      });
      if (response.statusCode == 200 || response.statusCode == 201 || (response.body != null && response.body['success'] == true)) {
        if (response.body != null && response.body['data'] is Map) {
          final newReg = RegionModel.fromJson(Map<String, dynamic>.from(response.body['data']));
          if (!regions.any((r) => r.id == newReg.id)) {
            regions.insert(0, newReg);
          }
        }
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Region created successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadRegions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to create region';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to create region: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> updateRegion(String id, String name, String code) async {
    try {
      isSaving.value = true;
      final response = await _connect.put('${Api.regionsUrl}/$id', {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
      });
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Region updated successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadRegions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to update region';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to update region: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ DIVISIONS ------------------
  Future<void> loadDivisions() async {
    try {
      isLoading.value = true;
      final response = await _connect.get('${Api.divisionsUrl}?includeInactive=true');
      if (response.body != null) {
        final body = response.body;
        List rawList = [];
        if (body is List) {
          rawList = body;
        } else if (body is Map && body['data'] is List) {
          rawList = body['data'] as List;
        } else if (body is Map && body['divisions'] is List) {
          rawList = body['divisions'] as List;
        }
        if (rawList.isNotEmpty || (body is Map && body['success'] == true)) {
          divisions.assignAll(
            rawList.whereType<Map>().map(
                  (d) => DivisionModel.fromJson(Map<String, dynamic>.from(d)),
                ),
          );
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load divisions: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> createDivision(String name, String code, String regionId) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.divisionsUrl, {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
        'regionId': regionId,
      });
      if (response.statusCode == 200 || response.statusCode == 201 || (response.body != null && response.body['success'] == true)) {
        if (response.body != null && response.body['data'] is Map) {
          final newDiv = DivisionModel.fromJson(Map<String, dynamic>.from(response.body['data']));
          if (!divisions.any((d) => d.id == newDiv.id)) {
            divisions.insert(0, newDiv);
          }
        }
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Division created successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadDivisions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to create division';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to create division: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> updateDivision(String id, String name, String code, String regionId) async {
    try {
      isSaving.value = true;
      final response = await _connect.put('${Api.divisionsUrl}/$id', {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
        'regionId': regionId,
      });
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Division updated successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadDivisions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to update division';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to update division: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ AREAS ------------------
  Future<void> loadAreas() async {
    try {
      isLoading.value = true;
      final response = await _connect.get('${Api.areasUrl}?includeInactive=true');
      if (response.body != null) {
        final body = response.body;
        List rawList = [];
        if (body is List) {
          rawList = body;
        } else if (body is Map && body['data'] is List) {
          rawList = body['data'] as List;
        } else if (body is Map && body['areas'] is List) {
          rawList = body['areas'] as List;
        }
        if (rawList.isNotEmpty || (body is Map && body['success'] == true)) {
          areas.assignAll(
            rawList.whereType<Map>().map(
                  (a) => AreaModel.fromJson(Map<String, dynamic>.from(a)),
                ),
          );
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load areas: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> createArea(String name, String code, String divisionId) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.areasUrl, {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
        'divisionId': divisionId,
      });
      if (response.statusCode == 200 || response.statusCode == 201 || (response.body != null && response.body['success'] == true)) {
        if (response.body != null && response.body['data'] is Map) {
          final newArea = AreaModel.fromJson(Map<String, dynamic>.from(response.body['data']));
          if (!areas.any((a) => a.id == newArea.id)) {
            areas.insert(0, newArea);
          }
        }
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Area created successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadAreas();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to create area';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to create area: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> updateArea(String id, String name, String code, String divisionId) async {
    try {
      isSaving.value = true;
      final response = await _connect.put('${Api.areasUrl}/$id', {
        'name': name.trim(),
        'code': code.trim().toUpperCase(),
        'divisionId': divisionId,
      });
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Area updated successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadAreas();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to update area';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to update area: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ BRANCHES ------------------
  Future<void> loadBranches() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.branchesUrl);
      if (response.body != null) {
        final body = response.body;
        List rawList = [];
        if (body is List) {
          rawList = body;
        } else if (body is Map && body['data'] is List) {
          rawList = body['data'] as List;
        } else if (body is Map && body['branches'] is List) {
          rawList = body['branches'] as List;
        }
        if (rawList.isNotEmpty || (body is Map && body['success'] == true)) {
          branches.assignAll(
            rawList.whereType<Map>().map(
                  (b) => BranchModel.fromJson(Map<String, dynamic>.from(b)),
                ),
          );
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load branches: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> createBranch(Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.post(Api.branchesUrl, payload);
      if (response.statusCode == 200 || response.statusCode == 201 || (response.body != null && response.body['success'] == true)) {
        if (response.body != null && response.body['data'] is Map) {
          final newBr = BranchModel.fromJson(Map<String, dynamic>.from(response.body['data']));
          if (!branches.any((b) => b.id == newBr.id)) {
            branches.insert(0, newBr);
          }
        }
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Branch created successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadBranches();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to create branch';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to create branch: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> updateBranch(String id, Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.put('${Api.branchesUrl}/$id', payload);
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        if (Get.isDialogOpen ?? false) {
          Get.back();
        }
        Get.snackbar('Success', 'Branch updated successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadBranches();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to update branch';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to update branch: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ DELETE METHODS ------------------
  Future<bool> deleteRegion(String id) async {
    try {
      isSaving.value = true;
      final response = await _connect.delete('${Api.regionsUrl}/$id');
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        regions.removeWhere((r) => r.id == id);
        Get.snackbar('Success', 'Region deleted successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadRegions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to delete region';
        Get.snackbar('Cannot Delete Region', msg, backgroundColor: Colors.red, colorText: Colors.white, duration: const Duration(seconds: 4));
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to delete region: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> deleteDivision(String id) async {
    try {
      isSaving.value = true;
      final response = await _connect.delete('${Api.divisionsUrl}/$id');
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        divisions.removeWhere((d) => d.id == id);
        Get.snackbar('Success', 'Division deleted successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadDivisions();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to delete division';
        Get.snackbar('Cannot Delete Division', msg, backgroundColor: Colors.red, colorText: Colors.white, duration: const Duration(seconds: 4));
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to delete division: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> deleteArea(String id) async {
    try {
      isSaving.value = true;
      final response = await _connect.delete('${Api.areasUrl}/$id');
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        areas.removeWhere((a) => a.id == id);
        Get.snackbar('Success', 'Area deleted successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadAreas();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to delete area';
        Get.snackbar('Cannot Delete Area', msg, backgroundColor: Colors.red, colorText: Colors.white, duration: const Duration(seconds: 4));
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to delete area: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  Future<bool> deleteBranch(String id) async {
    try {
      isSaving.value = true;
      final response = await _connect.delete('${Api.branchesUrl}/$id');
      if (response.statusCode == 200 || (response.body != null && response.body['success'] == true)) {
        branches.removeWhere((b) => b.id == id);
        Get.snackbar('Success', 'Branch deleted successfully', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        await loadBranches();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to delete branch';
        Get.snackbar('Cannot Delete Branch', msg, backgroundColor: Colors.red, colorText: Colors.white, duration: const Duration(seconds: 4));
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to delete branch: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  /// Calculates next auto-incremented numeric branch code (e.g. "38")
  String generateNextBranchCode() {
    int maxNum = 0;
    for (var b in branches) {
      final code = b.code.trim();
      if (RegExp(r'^\d+$').hasMatch(code)) {
        final n = int.tryParse(code) ?? 0;
        if (n > maxNum) maxNum = n;
      }
    }
    return (maxNum + 1).toString();
  }

  // ------------------ PRODUCT MAPPINGS ------------------
  final RxMap<String, bool> originalMappings = <String, bool>{}.obs;

  bool get isAllSelected {
    if (products.isEmpty) return false;
    return products.every((p) => productMappings[p.productId] == true);
  }

  void toggleAllProducts(bool value) {
    final Map<String, bool> newMappings = {};
    for (var p in products) {
      p.isAccessible = value;
      newMappings[p.productId] = value;
    }
    productMappings.assignAll(newMappings);
  }

  bool get hasChanges {
    for (var key in productMappings.keys) {
      if (productMappings[key] != originalMappings[key]) return true;
    }
    return false;
  }

  void resetProductMappings() {
    final Map<String, bool> resetState = {};
    for (var p in products) {
      final orig = originalMappings[p.productId] ?? false;
      p.isAccessible = orig;
      resetState[p.productId] = orig;
    }
    productMappings.assignAll(resetState);
    Get.snackbar(
      'Reset Successful',
      'Reverted to previous saved configuration.',
      backgroundColor: const Color(0xFF0D6842),
      colorText: Colors.white,
    );
  }

  Future<void> loadProductsAndMappings(String branchId) async {
    try {
      isLoading.value = true;
      // Fetch all products
      final prodRes = await _connect.get(Api.productsUrl);
      if (prodRes.statusCode != 200 || prodRes.body == null || prodRes.body['success'] != true) {
        Get.snackbar('Error', 'Failed to fetch loan products', backgroundColor: Colors.red, colorText: Colors.white);
        return;
      }
      final rawProds = (prodRes.body['data'] as List).whereType<Map>();
      final prodList = rawProds.map((p) => BranchProductModel.fromJson(Map<String, dynamic>.from(p))).toList();

      // Fetch branch product mappings
      final mapRes = await _connect.get('${Api.branchProductMappingUrl}?branchId=$branchId');
      final Map<String, bool> mappingState = {};

      for (var p in prodList) {
        mappingState[p.productId] = false;
      }

      if (mapRes.statusCode == 200 && mapRes.body != null && mapRes.body['success'] == true) {
        final rawMappings = (mapRes.body['data'] as List).whereType<Map>();
        for (var m in rawMappings) {
          final pid = '${m['productId']}';
          final acc = m['isAccessible'] == true;
          mappingState[pid] = acc;
        }
      }

      for (var p in prodList) {
        p.isAccessible = mappingState[p.productId] ?? false;
      }

      products.assignAll(prodList);
      productMappings.assignAll(mappingState);
      originalMappings.assignAll(Map.from(mappingState));
    } catch (e) {
      Get.snackbar('Error', 'Failed to load product mappings: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> saveProductMappings(String branchId) async {
    try {
      isSaving.value = true;
      final payloadList = products.map((p) => {
        'productId': p.productId,
        'productName': p.productName,
        'frequency': p.frequency,
        'loanAmount': p.loanAmount,
        'totalDues': p.totalDues,
        'interest': p.interest,
        'isAccessible': productMappings[p.productId] ?? false,
      }).toList();

      final response = await _connect.post(Api.branchProductMappingUrl, {
        'branchId': branchId,
        'productMappings': payloadList,
      });

      if (response.statusCode == 200 && response.body != null && response.body['success'] == true) {
        originalMappings.assignAll(Map.from(productMappings));
        Get.snackbar('Mapping Updated', 'Branch product access mapped successfully.', backgroundColor: const Color(0xFF0D6842), colorText: Colors.white);
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to update mappings';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to save product mappings: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ BRANCH LOCK EXTENSION ------------------
  Future<void> loadBranchLocks() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.branchLockUrl);
      if (response.statusCode == 200 && response.body != null) {
        final body = response.body;
        if (body['success'] == true && body['data'] is List) {
          branchLocks.assignAll(
            (body['data'] as List).whereType<Map>().map(
                  (l) => BranchLockModel.fromJson(Map<String, dynamic>.from(l)),
                ),
          );
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load branch locks: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> extendBranchLock(String branchId, String overrideUntilIso, String? reason) async {
    try {
      isSaving.value = true;
      final bodyData = <String, dynamic>{
        'branchId': branchId,
        'overrideUntil': overrideUntilIso,
      };
      if (reason != null && reason.trim().isNotEmpty) {
        bodyData['reason'] = reason.trim();
      }

      final response = await _connect.post(Api.branchLockUrl, bodyData);

      if (response.statusCode == 200 && response.body != null && response.body['success'] == true) {
        if (Get.isBottomSheetOpen ?? false) Get.back();
        Get.snackbar(
          'Success',
          'Branch lock extended successfully',
          backgroundColor: const Color(0xFF0D6842),
          colorText: Colors.white,
          snackPosition: SnackPosition.TOP,
          margin: const EdgeInsets.all(16),
          borderRadius: 12,
          duration: const Duration(seconds: 3),
        );
        await loadBranchLocks();
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to extend branch lock';
        Get.snackbar(
          'Error',
          msg,
          backgroundColor: Colors.red,
          colorText: Colors.white,
          snackPosition: SnackPosition.TOP,
          margin: const EdgeInsets.all(16),
          borderRadius: 12,
        );
        return false;
      }
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to extend branch lock: $e',
        backgroundColor: Colors.red,
        colorText: Colors.white,
        snackPosition: SnackPosition.TOP,
        margin: const EdgeInsets.all(16),
        borderRadius: 12,
      );
      return false;
    } finally {
      isSaving.value = false;
    }
  }

  // ------------------ GROUP ASSIGNMENT SETTINGS ------------------
  final RxInt maxMembersPerGroup = 5.obs;

  Future<void> loadGroupAssignmentSettings() async {
    try {
      isLoading.value = true;
      final response = await _connect.get(Api.groupAssignmentSettingsUrl);
      if (response.statusCode == 200 && response.body != null) {
        final body = response.body;
        if (body['success'] == true && body['data'] is Map) {
          final val = (body['data']['maxMembersPerGroup'] as num?)?.toInt();
          if (val != null) {
            maxMembersPerGroup.value = val;
          }
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load settings: $e', backgroundColor: Colors.red, colorText: Colors.white);
    } finally {
      isLoading.value = false;
    }
  }

  Future<bool> saveGroupAssignmentSettings(int maxMembers) async {
    try {
      isSaving.value = true;
      final response = await _connect.put(Api.groupAssignmentSettingsUrl, {
        'maxMembersPerGroup': maxMembers,
      });

      if (response.statusCode == 200 && response.body != null && response.body['success'] == true) {
        maxMembersPerGroup.value = maxMembers;
        Get.snackbar(
          'Saved',
          'Maximum members per group is now $maxMembers.',
          backgroundColor: const Color(0xFF0D6842),
          colorText: Colors.white,
        );
        return true;
      } else {
        final msg = response.body?['error'] ?? response.body?['message'] ?? 'Failed to save settings';
        Get.snackbar('Error', msg, backgroundColor: Colors.red, colorText: Colors.white);
        return false;
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to save settings: $e', backgroundColor: Colors.red, colorText: Colors.white);
      return false;
    } finally {
      isSaving.value = false;
    }
  }
}
