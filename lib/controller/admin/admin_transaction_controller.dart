import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class FinancialVoucher {
  FinancialVoucher.fromJson(Map<String, dynamic> json)
    : id = '${json['id'] ?? ''}',
      voucherNo = '${json['voucherNo'] ?? json['number'] ?? 'VCH-001'}',
      voucherType = '${json['voucherType'] ?? json['type'] ?? 'Cash Receipt'}',
      amount = (json['amount'] as num?)?.toDouble() ?? 0.0,
      narration = '${json['narration'] ?? json['description'] ?? ''}',
      date = '${json['date'] ?? json['createdAt'] ?? ''}',
      status = '${json['status'] ?? 'Approved'}';

  final String id;
  final String voucherNo;
  final String voucherType;
  final double amount;
  final String narration;
  final String date;
  final String status;
}

class AdminTransactionController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxBool isSaving = false.obs;
  final RxList<FinancialVoucher> vouchers = <FinancialVoucher>[].obs;

  @override
  void onInit() {
    super.onInit();
    loadVouchers();
  }

  Future<void> loadVouchers() async {
    try {
      isLoading.value = true;
      final response = await _connect.get("${Api.baseUrl}/api/transactions");

      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;
        if (data is List) {
          vouchers.assignAll(
            data.whereType<Map>().map((v) => FinancialVoucher.fromJson(Map<String, dynamic>.from(v))),
          );
          return;
        }
      }
    } catch (e) {
      debugPrint("Error loading financial vouchers: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<String?> createVoucher(Map<String, dynamic> payload) async {
    try {
      isSaving.value = true;
      final response = await _connect.post("${Api.baseUrl}/api/transactions", payload);

      if (response.statusCode == 200 || response.statusCode == 201) {
        await loadVouchers();
        return null;
      }
      return response.body?['message'] ?? 'Failed to create financial voucher.';
    } catch (e) {
      return 'Request Error: $e';
    } finally {
      isSaving.value = false;
    }
  }
}
