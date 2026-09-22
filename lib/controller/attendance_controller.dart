import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class AttendanceController extends GetxController {
  final ApiClient _connect = ApiClient();

  final RxBool isLoading = false.obs;
  final RxMap<String, dynamic> summary = <String, dynamic>{}.obs;
  final RxList<dynamic> ledgerRecords = <dynamic>[].obs;

  Future<void> fetchSummary({int? month, int? year, String? fromDate, String? tillDate}) async {
    try {
      isLoading.value = true;
      final url = Api.attendanceSummaryUrl(
        month: month,
        year: year,
        fromDate: fromDate,
        tillDate: tillDate,
      );
      final response = await _connect.get(url);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          summary.value = body['data']['summary'] ?? {};
        }
      }
    } catch (e) {
      debugPrint("Error fetching attendance summary: $e");
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> fetchLedger({String? fromDate, String? tillDate}) async {
    try {
      isLoading.value = true;
      final url = Api.attendanceLedgerUrl(fromDate: fromDate, tillDate: tillDate);
      final response = await _connect.get(url);
      if (response.statusCode == 200) {
        final body = response.body;
        if (body != null && body['success'] == true) {
          ledgerRecords.assignAll(body['data']['records'] ?? []);
        }
      }
    } catch (e) {
      debugPrint("Error fetching attendance ledger: $e");
    } finally {
      isLoading.value = false;
    }
  }

  String formatDate(DateTime date) {
    return DateFormat('yyyy-MM-dd').format(date);
  }
}
