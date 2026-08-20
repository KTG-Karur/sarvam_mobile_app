import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class AdminApiService {
  final ApiClient _connect = ApiClient();

  // ── Loan Products & Product Types ──────────────────────────────────────────
  Future<Response> getLoanProductTypes() async {
    return await _connect.get(Api.loanProductTypesUrl);
  }

  Future<Response> getLoanProducts() async {
    return await _connect.get(Api.productsUrl);
  }

  Future<Response> createLoanProduct(Map<String, dynamic> payload) async {
    return await _connect.post(Api.productsUrl, payload);
  }

  // ── Loan Purposes & Purpose Types ──────────────────────────────────────────
  Future<Response> getLoanPurposeTypes() async {
    return await _connect.get(Api.loanPurposeTypesUrl);
  }

  Future<Response> getLoanPurposes() async {
    return await _connect.get(Api.loanPurposesUrl);
  }

  Future<Response> createLoanPurpose(Map<String, dynamic> payload) async {
    return await _connect.post(Api.loanPurposesUrl, payload);
  }

  // ── Economic Activities ──────────────────────────────────────────────────
  Future<Response> getEconomicActivityTypes() async {
    return await _connect.get(Api.economicActivityTypesUrl);
  }

  Future<Response> getEconomicActivities() async {
    return await _connect.get(Api.economicActivitiesUrl);
  }

  Future<Response> createEconomicActivity(Map<String, dynamic> payload) async {
    return await _connect.post(Api.economicActivitiesUrl, payload);
  }

  // ── Meeting Places & Territory ───────────────────────────────────────────
  Future<Response> getMeetingPlaces() async {
    return await _connect.get("${Api.baseUrl}/api/masters/meeting-place");
  }

  Future<Response> createMeetingPlace(Map<String, dynamic> payload) async {
    return await _connect.post("${Api.baseUrl}/api/masters/meeting-place", payload);
  }

  // ── Financial Accounts ───────────────────────────────────────────────────
  Future<Response> getAccountsLedger() async {
    return await _connect.get("${Api.baseUrl}/api/accounts/ledger");
  }

  Future<Response> getSelfAccounts() async {
    return await _connect.get("${Api.baseUrl}/api/accounts/self-accounts");
  }

  // ── Admin Reports & Dashboard ────────────────────────────────────────────
  Future<Response> getAdminDashboardStats() async {
    return await _connect.get(Api.dashboardStatsUrl);
  }

  Future<Response> getMISReportsSummary() async {
    return await _connect.get("${Api.baseUrl}/api/reports/summary");
  }
}
