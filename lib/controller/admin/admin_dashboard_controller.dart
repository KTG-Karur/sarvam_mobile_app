import 'dart:async';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

class AdminDashboardController extends GetxController {
  final ApiClient _connect = ApiClient();
  Timer? _autoRefreshTimer;

  final RxBool isLoading = false.obs;
  final RxBool isRefreshing = false.obs;
  final RxString selectedRole = 'Admin'.obs; // Admin, AM, BM, FDO
  final RxString selectedRegion = 'All Regions'.obs;
  final RxString selectedBranch = 'All Branches'.obs;
  final RxString selectedFunder = 'All Funders'.obs;

  // 1. Targets
  final RxInt newMemberTarget = 0.obs;
  final RxInt renewalTarget = 0.obs;
  final RxInt totalEnrTarget = 0.obs;
  final RxDouble loanDisbmtTarget = 0.0.obs;

  // 2. Achievement
  final RxInt newMembersAchievement = 2.obs;
  final RxInt renewalsAchievement = 0.obs;
  final RxInt goldLoansAchievement = 0.obs;
  final RxDouble disbmtAmountAchievement = 0.0.obs;

  // 3. Operations
  final RxInt noOfCenters = 8.obs;
  final RxInt activeTotal = 9.obs;
  final RxInt activeMembers = 5.obs;
  final RxInt activeClients = 4.obs;
  final RxInt disbmtClients = 0.obs;
  final RxDouble disbmtClientsAmount = 0.0.obs;

  // 4. Gold Loan
  final RxInt goldClients = 0.obs;
  final RxDouble goldDisbmtAmt = 0.0.obs;
  final RxInt goldReturns = 0.obs;

  // 5. Collection & Portfolio OS
  final RxDouble collectionTargetPct = 100.0.obs;
  final RxDouble collectionActualPct = 25.84.obs;
  final RxDouble collectionDiffPct = (-74.16).obs;
  final RxDouble goldLoanCollPct = 25.84.obs;
  final RxDouble principalOs = 87100.0.obs;
  final RxDouble interestOs = 23900.0.obs;
  final RxDouble totalDemandAmount = 2200.0.obs;
  final RxDouble totalCollectedAmount = 568.0.obs;
  final RxDouble totalDisbursedAmount = 90000.0.obs;

  double get collectionPercentage {
    if (totalDemandAmount.value <= 0) return 0.0;
    final pct = (totalCollectedAmount.value / totalDemandAmount.value) * 100;
    return pct.clamp(0.0, 100.0);
  }

  // 6. Arrears & PAR
  final RxInt arrearClients = 1.obs;
  final RxDouble arrearPrincipal = 100.0.obs;
  final RxDouble arrearInterest = 0.0.obs;
  final RxDouble parPct = 11.1.obs;
  final RxInt totalArrearMembers = 1.obs;
  final RxInt totalMembersCount = 9.obs;

  // 7. Stat Cards Grid
  final RxInt totalGroups = 6.obs;
  final RxInt totalMembers = 9.obs;
  final RxInt rejectedMembers = 0.obs;
  final RxInt totalStaff = 5.obs;
  final RxInt totalFunders = 2.obs;
  final RxDouble loanDisbursementTotal = 90000.0.obs;
  final RxDouble outstandingBalanceTotal = 87100.0.obs;
  final RxInt highmarkChecked = 0.obs;
  final RxDouble highmarkBalance = 0.0.obs;

  // 8. Dynamic Tables Data
  final RxList<Map<String, dynamic>> demandCollectionRows = <Map<String, dynamic>>[].obs;
  final RxList<Map<String, dynamic>> loanIndexRows = <Map<String, dynamic>>[].obs;
  final RxList<Map<String, dynamic>> eodStatusRows = <Map<String, dynamic>>[].obs;
  final RxList<Map<String, dynamic>> officerLoanRows = <Map<String, dynamic>>[].obs;

  @override
  void onInit() {
    super.onInit();
    loadDashboardData();
    startAutoRefresh();
  }

  @override
  void onClose() {
    stopAutoRefresh();
    super.onClose();
  }

  /// Automatic Refresh setup (fetches live updates every 30 seconds)
  void startAutoRefresh({Duration interval = const Duration(seconds: 30)}) {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = Timer.periodic(interval, (_) {
      if (!isLoading.value && !isRefreshing.value) {
        loadDashboardData(isBackgroundRefresh: true);
      }
    });
  }

  void stopAutoRefresh() {
    _autoRefreshTimer?.cancel();
    _autoRefreshTimer = null;
  }

  /// Explicit Manual Reload / Refresh Function
  Future<void> reloadDashboard() async {
    await loadDashboardData(isBackgroundRefresh: false);
  }

  Future<void> loadDashboardData({
    String? fromDate,
    String? toDate,
    String? branchId,
    String? centerId,
    String? funderId,
    String? regionId,
    bool isBackgroundRefresh = false,
  }) async {
    try {
      if (!isBackgroundRefresh) {
        isLoading.value = true;
      } else {
        isRefreshing.value = true;
      }

      final queryParams = <String, String>{};
      if (fromDate != null && fromDate.isNotEmpty) queryParams['fromDate'] = fromDate;
      if (toDate != null && toDate.isNotEmpty) queryParams['toDate'] = toDate;
      if (branchId != null && branchId.isNotEmpty && branchId != 'All Branches') {
        queryParams['branchId'] = branchId;
      }
      if (centerId != null && centerId.isNotEmpty) queryParams['centerId'] = centerId;
      if (funderId != null && funderId.isNotEmpty && funderId != 'All Funders') {
        queryParams['funderId'] = funderId;
      }
      if (regionId != null && regionId.isNotEmpty && regionId != 'All Regions') {
        queryParams['regionId'] = regionId;
      }

      final uri = Uri.parse("${Api.baseUrl}/api/dashboard/v2").replace(
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );

      final response = await _connect.get(uri.toString());

      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'] ?? response.body;

        // 1. Stats Parsing
        if (data['stats'] != null) {
          final stats = data['stats'];
          noOfCenters.value = (stats['centers'] ?? stats['noOfCenters'] ?? noOfCenters.value) as int;
          totalGroups.value = (stats['groups'] ?? stats['totalGroups'] ?? totalGroups.value) as int;
          totalMembers.value = (stats['totalMembers'] ?? totalMembers.value) as int;
          activeMembers.value = (stats['activeMembers'] ?? activeMembers.value) as int;
          activeClients.value = (stats['activeMembers'] ?? activeClients.value) as int;
          rejectedMembers.value = (stats['rejectedMembers'] ?? rejectedMembers.value) as int;
          totalStaff.value = (stats['totalStaff'] ?? totalStaff.value) as int;
          totalFunders.value = (stats['totalFunders'] ?? totalFunders.value) as int;

          final disb = (stats['loanDisbursement'] ?? stats['totalDisbursement'] as num?)?.toDouble();
          if (disb != null) {
            loanDisbursementTotal.value = disb;
            totalDisbursedAmount.value = disb;
          }

          final os = (stats['outstandingBalance'] as num?)?.toDouble();
          if (os != null) {
            outstandingBalanceTotal.value = os;
            principalOs.value = os;
          }

          highmarkChecked.value = (stats['highmarkChecked'] ?? highmarkChecked.value) as int;
          highmarkBalance.value = (stats['highmarkBalance'] as num?)?.toDouble() ?? highmarkBalance.value;
        }

        // 2. Demand Collection Details Table
        if (data['demandCollection'] != null && data['demandCollection'] is List) {
          final List list = data['demandCollection'];
          if (list.isNotEmpty) {
            demandCollectionRows.assignAll(
              list.map((item) {
                final map = Map<String, dynamic>.from(item);
                map['groups'] = map['totalGroups'] ?? map['groups'] ?? 0;
                map['members'] = map['totalMembers'] ?? map['members'] ?? 0;
                map['totalDemand'] = map['demandTotal'] ?? map['totalDemand'] ?? 0;
                map['actualColl'] = map['collectionTotal'] ?? map['actualColl'] ?? 0;
                map['pDemand'] = map['demandPrincipal'] ?? map['pDemand'] ?? 0;
                map['iDemand'] = map['demandInterest'] ?? map['iDemand'] ?? 0;
                return map;
              }).toList(),
            );
          }
        }

        // 3. Loan Index Details Table
        if (data['loanIndexes'] != null && data['loanIndexes'] is List) {
          final List list = data['loanIndexes'];
          if (list.isNotEmpty) {
            loanIndexRows.assignAll(
              list.map((item) {
                final map = Map<String, dynamic>.from(item);
                map['date'] = map['disbursementDate'] ?? map['date'] ?? '';
                map['loanAmt'] = map['loanAmount'] ?? map['loanAmt'] ?? 0;
                map['members'] = "${map['disbursedCount'] ?? 0}/${map['membersCount'] ?? 0}";
                return map;
              }).toList(),
            );
          }
        }

        // 4. End of Day Status Table
        if (data['eodStatus'] != null && data['eodStatus'] is List) {
          final List list = data['eodStatus'];
          if (list.isNotEmpty) {
            eodStatusRows.assignAll(
              list.map((item) {
                final map = Map<String, dynamic>.from(item);
                map['eodStatus'] = map['status'] ?? map['eodStatus'] ?? '';
                map['manager'] = map['managerName'] ?? map['manager'] ?? '—';
                return map;
              }).toList(),
            );
          }
        }

        // 5. Officer Loan Details Table
        if (data['officerLoanDetails'] != null && data['officerLoanDetails'] is List) {
          final List list = data['officerLoanDetails'];
          if (list.isNotEmpty) {
            officerLoanRows.assignAll(
              list.map((item) {
                final map = Map<String, dynamic>.from(item);
                map['active'] = map['activeMembers'] ?? map['active'] ?? 0;
                map['publishedTotal'] = map['publishedTotal'] ?? map['publishedPrincipal'] ?? 0;
                map['olbTotal'] = map['olbTotal'] ?? map['olbPrincipal'] ?? 0;
                return map;
              }).toList(),
            );
          }
        }
      }
    } catch (e) {
      debugPrint("Error fetching dashboard stats: $e");
    } finally {
      isLoading.value = false;
      isRefreshing.value = false;
      _populateSampleTablesIfEmpty();
    }
  }

  void _populateSampleTablesIfEmpty() {
    if (demandCollectionRows.isEmpty) {
      demandCollectionRows.assignAll([
        {'date': '02 Aug', 'day': 'Mon', 'groups': 2, 'members': 2, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 0},
        {'date': '03 Aug', 'day': 'Tue', 'groups': 0, 'members': 0, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 0},
        {'date': '04 Aug', 'day': 'Wed', 'groups': 2, 'members': 2, 'pDemand': 1500, 'iDemand': 700, 'totalDemand': 2200, 'actualColl': 0, 'yetToCollect': 2200, 'arrearDue': 0},
        {'date': '05 Aug', 'day': 'Thu', 'groups': 0, 'members': 0, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 100},
        {'date': '06 Aug', 'day': 'Fri', 'groups': 0, 'members': 0, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 100},
        {'date': '07 Aug', 'day': 'Sat', 'groups': 0, 'members': 0, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 100},
        {'date': '08 Aug', 'day': 'Sun', 'groups': 0, 'members': 0, 'pDemand': 0, 'iDemand': 0, 'totalDemand': 0, 'actualColl': 0, 'yetToCollect': 0, 'arrearDue': 100},
      ]);
    }

    if (loanIndexRows.isEmpty) {
      loanIndexRows.assignAll([
        {'indexNo': '1-8-0001', 'date': '04 Aug 26', 'status': 'Pending', 'branch': '1 - Karur', 'center': '8 - coimbatore', 'loanAmt': 20000.0, 'principalPd': 0.0, 'interestPd': 0.0, 'members': '0/1'},
        {'indexNo': '1-7-0001', 'date': '01 Aug 26', 'status': 'Pending', 'branch': '1 - Karur', 'center': '7 - g BB', 'loanAmt': 45000.0, 'principalPd': 0.0, 'interestPd': 0.0, 'members': '0/1'},
        {'indexNo': '1-4-0002', 'date': '29 Jul 26', 'status': 'Pending', 'branch': '1 - Karur', 'center': '4 - Vaiyapurinagar', 'loanAmt': 30000.0, 'principalPd': 0.0, 'interestPd': 0.0, 'members': '0/1'},
        {'indexNo': '1-2-0001', 'date': '28 Jul 26', 'status': 'Fully Disbursed', 'branch': '1 - Karur', 'center': '2 - Sengunthapuram', 'loanAmt': 45000.0, 'principalPd': 45000.0, 'interestPd': 900.0, 'members': '1/1'},
        {'indexNo': '1-4-0001', 'date': '28 Jul 26', 'status': 'Fully Disbursed', 'branch': '1 - Karur', 'center': '4 - Vaiyapurinagar', 'loanAmt': 45000.0, 'principalPd': 45000.0, 'interestPd': 700.0, 'members': '1/1'},
      ]);
    }

    if (eodStatusRows.isEmpty) {
      eodStatusRows.assignAll([
        {'branch': '1 - Karur', 'eodDate': '29 Jul 2026', 'cashOpening': 3200.0, 'cashClosing': 73200.0, 'bankOpening': 0.0, 'bankClosing': 0.0, 'eodStatus': 'In Progress', 'manager': 'Anbalagan M'},
        {'branch': 'HO - Head Office', 'eodDate': '29 Jul 2026', 'cashOpening': 0.0, 'cashClosing': 0.0, 'bankOpening': 0.0, 'bankClosing': 0.0, 'eodStatus': 'Pending', 'manager': '—'},
      ]);
    }

    if (officerLoanRows.isEmpty) {
      officerLoanRows.assignAll([
        {'officerName': 'Mathi G', 'groups': 6, 'members': 9, 'active': 8, 'publishedP': 90000.0, 'publishedI': 1800.0, 'publishedTotal': 91800.0, 'olbP': 87100.0, 'olbI': 1600.0, 'olbTotal': 88700.0},
      ]);
    }
  }
}
