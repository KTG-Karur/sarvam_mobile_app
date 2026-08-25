import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/view/AM/foreclosure_approval/foreclosure_approval.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';

const _green = Color(0xFF00843D);
const _darkGreen = Color(0xFF075E2E);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE1EEE6);
const _bg = Color(0xFFF7FBF8);

/// Complete BM/AM Collection Approval screen — feature-identical with web app's
/// `CollectionApprovalClient.tsx`. Supports Demand, Advance, Arrear, Gold Loan,
/// Pre-Close, Close Loans & Allocate for EOD modes with Date/Branch/Center/FDO
/// filtering, denomination summaries, search, and instant single/bulk approvals.
class CollectionApproval extends StatefulWidget {
  const CollectionApproval({super.key});

  @override
  State<CollectionApproval> createState() => _CollectionApprovalState();
}

class _CollectionApprovalState extends State<CollectionApproval>
    with SingleTickerProviderStateMixin {
  final ApiClient _client = ApiClient();

  final RxBool _isLoading = false.obs;
  final RxBool _isLoadingFilters = false.obs;
  final RxBool _isSubmitting = false.obs;
  final RxBool _isLoadingEodAllocation = false.obs;
  // Which single funder-group (or 'LOAN_ADVANCE') is currently posting — used
  // both to disable every allocate button while any one is in flight (mirrors
  // the web's `disabled={!!processingKey}`) and to show the spinner on only
  // that one button (`processingKey === mergedKey`).
  final Rxn<String> _processingAllocationKey = Rxn<String>();

  final RxList<dynamic> _branches = <dynamic>[].obs;
  final RxList<dynamic> _centers = <dynamic>[].obs;
  final RxList<dynamic> _officers = <dynamic>[].obs;

  final RxString _selectedBranchId = ''.obs;
  final RxString _selectedCenterId = ''.obs;
  final RxString _selectedOfficerId = ''.obs;
  DateTime _collectionDate = DateTime.now();

  final RxList<Map<String, dynamic>> _rows = <Map<String, dynamic>>[].obs;
  final RxList<Map<String, dynamic>> _denominationByCenter = <Map<String, dynamic>>[].obs;
  final RxSet<String> _approvedIds = <String>{}.obs;

  // EOD Allocation State — mirrors the web's `AllocateForEodTab.tsx`: one
  // merged group per funder (+ Gold/Normal split), built client-side by
  // grouping the API's separate demandRows/advanceRows/arrearRows/
  // preclosureRows/writeoffRows the same way `buildFunderGroups` does, plus
  // the standalone (non-funder) Loan Advance bucket.
  final RxList<Map<String, dynamic>> _funderAllocations = <Map<String, dynamic>>[].obs;
  final Rxn<Map<String, dynamic>> _loanAdvanceAllocation = Rxn<Map<String, dynamic>>();

  String _userRole = '';
  String _searchQuery = '';
  bool _showDenominationSummary = false;

  late TabController _tabController;
  final List<String> _modeTabs = [
    'DEMAND',
    'ADVANCE',
    'ARREAR',
    'PRE_CLOSE',
    'CLOSE_LOANS',
    'GOLD_LOAN',
    'ALLOCATE_EOD',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _modeTabs.length, vsync: this);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging && _modeTabs[_tabController.index] == 'ALLOCATE_EOD') {
        _fetchEodAllocations();
      }
    });
    _bootstrap();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    _isLoadingFilters.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      _userRole = prefs.getString('userRole')?.toUpperCase() ?? 'BRANCH_MANAGER';
      final savedBranchId = prefs.getString('branchId') ?? '';
      _selectedBranchId.value = savedBranchId;

      final token = prefs.getString('accessToken') ?? '';
      final headers = {'Authorization': 'Bearer $token'};

      // Fetch branches if Admin or Area Manager
      if (_userRole == 'ADMIN' || _userRole == 'AREA_MANAGER') {
        final bRes = await _client.get(
          '${Api.baseUrl}/api/branches',
          headers: headers,
        );
        if (bRes.statusCode == 200 && bRes.body != null) {
          final data = bRes.body['data'];
          if (data is List) {
            _branches.assignAll(data);
            if (savedBranchId.isNotEmpty &&
                data.any((b) => b['id']?.toString() == savedBranchId)) {
              _selectedBranchId.value = savedBranchId;
            } else if (data.isNotEmpty) {
              _selectedBranchId.value = data[0]['id']?.toString() ?? '';
            }
          }
        }
      }

      await _loadBranchLookups();
      await _fetchRows();
    } catch (e) {
      debugPrint('Failed to bootstrap Collection Approval: $e');
    } finally {
      _isLoadingFilters.value = false;
    }
  }

  Future<void> _loadBranchLookups() async {
    final branchId = _selectedBranchId.value;
    if (branchId.isEmpty) return;

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final headers = {'Authorization': 'Bearer $token'};

      _selectedCenterId.value = '';
      _selectedOfficerId.value = '';

      final eodRes = await _client.get(
        '${Api.baseUrl}/api/utilities/eod-process?branchId=$branchId',
        headers: headers,
      );
      if (eodRes.statusCode == 200 && eodRes.body != null) {
        final eodData = eodRes.body['data'] ?? eodRes.body;
        final ymd = eodData['workingDateYmd']?.toString();
        if (ymd != null && RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(ymd)) {
          _collectionDate = DateTime.parse(ymd);
        }
      }

      final cRes = await _client.get(
        '${Api.baseUrl}/api/centers?branchId=$branchId&includeInactive=false&status=APPROVED',
        headers: headers,
      );
      if (cRes.statusCode == 200 && cRes.body != null) {
        final cData = cRes.body['data'] ?? cRes.body;
        if (cData is List) {
          _centers.assignAll(cData);
        } else if (cData is Map && cData['centers'] is List) {
          _centers.assignAll(cData['centers']);
        } else {
          _centers.clear();
        }
      }

      final uRes = await _client.get(
        '${Api.baseUrl}/api/users?role=FDO&branchId=$branchId&pageSize=100',
        headers: headers,
      );
      if (uRes.statusCode == 200 && uRes.body != null) {
        final uData = uRes.body['data'];
        if (uData is Map && uData['users'] is List) {
          _officers.assignAll(uData['users']);
        } else if (uData is List) {
          _officers.assignAll(uData);
        }
      }
    } catch (e) {
      debugPrint('Failed to load centers/officers: $e');
    }
  }

  Future<void> _fetchRows() async {
    final branchId = _selectedBranchId.value;
    if (branchId.isEmpty) return;

    _isLoading.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final formattedDate = DateFormat('yyyy-MM-dd').format(_collectionDate);

      final queryParams = <String, String>{
        'branchId': branchId,
        'date': formattedDate,
        'status': 'ALL',
      };
      if (_selectedCenterId.value.isNotEmpty) {
        queryParams['centerId'] = _selectedCenterId.value;
      }
      if (_selectedOfficerId.value.isNotEmpty) {
        queryParams['collectedById'] = _selectedOfficerId.value;
      }

      final uri = Uri.parse('${Api.baseUrl}/api/collections/approve')
          .replace(queryParameters: queryParams);

      final response = await _client.get(
        uri.toString(),
        headers: {'Authorization': 'Bearer $token'},
      );

      if (response.statusCode == 200 && response.body != null) {
        final bodyData = response.body['data'];
        List<dynamic> rawRows = [];

        if (bodyData is Map && bodyData['rows'] is List) {
          rawRows = bodyData['rows'];
        } else if (bodyData is List) {
          rawRows = bodyData;
        }

        if (bodyData is Map && bodyData['denominationByCenter'] is List) {
          _denominationByCenter.assignAll(
            (bodyData['denominationByCenter'] as List)
                .map((d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{})
                .toList(),
          );
        } else {
          _denominationByCenter.clear();
        }

        final List<Map<String, dynamic>> parsedRows = rawRows
            .map((r) => r is Map ? Map<String, dynamic>.from(r) : <String, dynamic>{})
            .where((m) => m.isNotEmpty)
            .toList();

        // Ensure all centers present in current collection rows exist in _centers list
        for (final r in parsedRows) {
          final cName = r['centerName']?.toString() ?? r['center']?['name']?.toString() ?? '';
          final cCode = r['centerCode']?.toString() ?? r['center']?['code']?.toString() ?? '';
          final cId = r['centerId']?.toString() ?? r['center']?['id']?.toString() ?? '';
          if (cId.isNotEmpty && !_centers.any((c) => c['id']?.toString() == cId)) {
            _centers.add({'id': cId, 'name': cName, 'code': cCode});
          }
        }

        for (final d in _denominationByCenter) {
          final cName = d['centerName']?.toString() ?? '';
          final cCode = d['centerCode']?.toString() ?? '';
          final cId = d['centerId']?.toString() ?? '';
          if (cId.isNotEmpty && !_centers.any((c) => c['id']?.toString() == cId)) {
            _centers.add({'id': cId, 'name': cName, 'code': cCode});
          }
        }

        // Ensure all officers present in current collection rows exist in _officers list
        for (final r in parsedRows) {
          final oName = r['collectedByName']?.toString() ?? r['collectedBy']?['firstName']?.toString() ?? '';
          final oId = r['collectedById']?.toString() ?? r['collectedBy']?['id']?.toString() ?? '';
          if (oId.isNotEmpty && !_officers.any((o) => o['id']?.toString() == oId)) {
            final parts = oName.split(' ');
            final fName = parts.isNotEmpty ? parts.first : oName;
            final lName = parts.length > 1 ? parts.sublist(1).join(' ') : '';
            _officers.add({'id': oId, 'firstName': fName, 'lastName': lName});
          }
        }

        _rows.assignAll(parsedRows);
        _approvedIds.clear();
      } else {
        final err = response.body?['error'] ?? response.body?['message'] ?? 'Failed to load collections';
        Get.snackbar('Notice', '$err', backgroundColor: Colors.orange, colorText: Colors.white);
        _rows.clear();
      }
    } catch (e) {
      debugPrint('Failed to fetch pending collection rows: $e');
      Get.snackbar('Error', 'Could not connect to server: $e', backgroundColor: Colors.redAccent, colorText: Colors.white);
      _rows.clear();
    } finally {
      _isLoading.value = false;
    }
  }

  Future<void> _approveRow(String transactionId) async {
    if (transactionId.isEmpty) return;

    _isSubmitting.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';

      final response = await _client.post(
        '${Api.baseUrl}/api/collections/approve',
        {
          'transactionId': transactionId,
          'action': 'APPROVE',
        },
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        _approvedIds.add(transactionId);
        Get.snackbar(
          'Collection Approved',
          'Collection transaction approved successfully.',
          backgroundColor: _green,
          colorText: Colors.white,
        );
      } else {
        final err = response.body?['error'] ?? response.body?['message'] ?? 'Approval failed';
        Get.snackbar('Error', '$err', backgroundColor: Colors.redAccent, colorText: Colors.white);
      }
    } catch (e) {
      Get.snackbar('Error', 'Action failed: $e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _isSubmitting.value = false;
    }
  }

  Future<void> _approveAllPendingForTab(String modeTab) async {
    final pendingRows = _filteredRowsForTab(modeTab)
        .where((r) => r['status']?.toString().toUpperCase() != 'APPROVED' && !_approvedIds.contains(r['transactionId']?.toString() ?? r['id']?.toString()))
        .toList();

    if (pendingRows.isEmpty) {
      Get.snackbar('No Pending Rows', 'All items in this tab are already approved.', backgroundColor: Colors.orange, colorText: Colors.white);
      return;
    }

    _isSubmitting.value = true;
    try {
      int successCount = 0;
      for (final r in pendingRows) {
        final txId = r['transactionId']?.toString() ?? r['id']?.toString() ?? '';
        if (txId.isNotEmpty) {
          final prefs = await SharedPreferences.getInstance();
          final token = prefs.getString('accessToken') ?? '';
          final response = await _client.post(
            '${Api.baseUrl}/api/collections/approve',
            {'transactionId': txId, 'action': 'APPROVE'},
            headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
          );
          if (response.statusCode == 200 || response.statusCode == 201) {
            _approvedIds.add(txId);
            successCount++;
          }
        }
      }
      Get.snackbar(
        'Bulk Approval Complete',
        'Approved $successCount collection transaction(s).',
        backgroundColor: _green,
        colorText: Colors.white,
      );
    } catch (e) {
      Get.snackbar('Bulk Approval Error', '$e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _isSubmitting.value = false;
    }
  }

  void _showRevertDialog(String transactionId) {
    final remarksCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        title: Text('Revert Collection Entry', style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Enter reason for reverting this collection back to the FDO:', style: TextStyle(fontSize: 11.5.sp, color: _muted)),
            SizedBox(height: 10.h),
            TextField(
              controller: remarksCtrl,
              maxLines: 3,
              style: TextStyle(fontSize: 12.sp),
              decoration: InputDecoration(
                hintText: 'Type remarks...',
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8.r)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.redAccent),
            onPressed: () async {
              final remarks = remarksCtrl.text.trim();
              if (remarks.isEmpty) {
                Get.snackbar('Remark Required', 'Please enter a reason for reverting.', backgroundColor: Colors.orange, colorText: Colors.white);
                return;
              }
              Navigator.pop(ctx);
              await _revertRow(transactionId, remarks);
            },
            child: const Text('Revert Entry'),
          ),
        ],
      ),
    );
  }

  Future<void> _revertRow(String transactionId, String remarks) async {
    _isSubmitting.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';

      final response = await _client.post(
        '${Api.baseUrl}/api/collections/approve',
        {
          'transactionId': transactionId,
          'action': 'REJECT',
          'remarks': remarks,
        },
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (response.statusCode == 200 || response.statusCode == 201) {
        Get.snackbar(
          'Reverted',
          'Collection entry reverted back to FDO.',
          backgroundColor: Colors.orange,
          colorText: Colors.white,
        );
        await _fetchRows();
      } else {
        final err = response.body?['error'] ?? response.body?['message'] ?? 'Revert failed';
        Get.snackbar('Error', '$err', backgroundColor: Colors.redAccent, colorText: Colors.white);
      }
    } catch (e) {
      Get.snackbar('Error', 'Action failed: $e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _isSubmitting.value = false;
    }
  }

  /// `${funderId ?? 'OWN'}:${isGoldLoan ? 'GOLD' : 'NORMAL'}` — must match the
  /// grouping key `buildFunderGroups()` uses on the web app so a funder that
  /// has both gold and normal loans shows as two independently-allocatable
  /// groups, not merged into one.
  String _funderGroupKey(dynamic funderId, bool isGoldLoan) =>
      '${(funderId?.toString().isNotEmpty ?? false) ? funderId : 'OWN'}:${isGoldLoan ? 'GOLD' : 'NORMAL'}';

  /// Client-side mirror of the web's `buildFunderGroups()` — merges the
  /// API's separately-returned demandRows/advanceRows/arrearRows/
  /// preclosureRows/writeoffRows into one card per funder(+gold-flag), each
  /// with a single "Allocate For EOD" action covering everything pending for
  /// that funder on this date, exactly like the software's per-funder cards
  /// (no "allocate everything for every funder" bulk action exists there).
  List<Map<String, dynamic>> _buildFunderGroups(Map<String, dynamic> data) {
    final groups = <String, Map<String, dynamic>>{};

    void mergeRows(dynamic rows, {required bool isClosure}) {
      if (rows is! List) return;
      for (final raw in rows) {
        if (raw is! Map) continue;
        final row = Map<String, dynamic>.from(raw);
        final funderId = row['funderId'];
        final isGoldLoan = row['isGoldLoan'] == true;
        final key = _funderGroupKey(funderId, isGoldLoan);
        final group = groups.putIfAbsent(
          key,
          () => {
            'funderId': funderId,
            'funderName': row['funderName']?.toString() ?? (funderId == null ? 'own fund' : 'Funder'),
            'isGoldLoan': isGoldLoan,
            'principalAmount': 0.0,
            'interestAmount': 0.0,
            'totalAmount': 0.0,
            'hasPending': false,
            'hasAnyAllocated': false,
            'overAllocated': false,
          },
        );

        final batches = row['batches'];
        if (batches is List) {
          for (final b in batches) {
            if (b is! Map) continue;
            final status = b['status']?.toString();
            if (status == 'PENDING') {
              group['hasPending'] = true;
              group['principalAmount'] = (group['principalAmount'] as double) + (double.tryParse('${b['principalAmount'] ?? 0}') ?? 0);
              group['interestAmount'] = (group['interestAmount'] as double) + (double.tryParse('${b['interestAmount'] ?? 0}') ?? 0);
              group['totalAmount'] = (group['totalAmount'] as double) + (double.tryParse('${b['totalAmount'] ?? 0}') ?? 0);
            } else if (status == 'ALLOCATED') {
              group['hasAnyAllocated'] = true;
            }
          }
        }

        // Pre-Closure/Loan Closing rows carry no overAllocated flag (see
        // ClosureAllocationRow on the backend) — only Demand/Advance/Arrear do.
        if (!isClosure && row['overAllocated'] == true) {
          group['overAllocated'] = true;
        }
      }
    }

    mergeRows(data['demandRows'], isClosure: false);
    mergeRows(data['advanceRows'], isClosure: false);
    mergeRows(data['arrearRows'], isClosure: false);
    mergeRows(data['preclosureRows'], isClosure: true);
    mergeRows(data['writeoffRows'], isClosure: true);

    return groups.values.toList();
  }

  Future<void> _fetchEodAllocations() async {
    final branchId = _selectedBranchId.value;
    if (branchId.isEmpty) return;

    _isLoadingEodAllocation.value = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final dateStr = DateFormat('yyyy-MM-dd').format(_collectionDate);

      final res = await _client.get(
        '${Api.eodAllocationUrl}?branchId=$branchId&date=$dateStr',
        headers: {'Authorization': 'Bearer $token'},
      );

      if (res.statusCode == 200 && res.body != null && res.body['data'] is Map) {
        final data = Map<String, dynamic>.from(res.body['data']);
        _funderAllocations.assignAll(_buildFunderGroups(data));
        _loanAdvanceAllocation.value = data['loanAdvance'] is Map
            ? Map<String, dynamic>.from(data['loanAdvance'])
            : null;
      } else {
        _funderAllocations.clear();
        _loanAdvanceAllocation.value = null;
      }
    } catch (e) {
      debugPrint('Failed to load EOD allocations: $e');
      _funderAllocations.clear();
      _loanAdvanceAllocation.value = null;
    } finally {
      _isLoadingEodAllocation.value = false;
    }
  }

  /// Allocates one funder(+gold-flag) group's entire pending balance across
  /// Demand/Advance/Arrear/Pre-Closure/Loan Closing in a single merged
  /// voucher — mirrors the web's `handleAllocateMerged` (`mergedFunderAllocation:
  /// true`). There is no equivalent "allocate every funder at once" call on
  /// the backend; each funder must be posted separately, same as software.
  Future<void> _allocateFunderGroup(dynamic funderId, bool isGoldLoan) async {
    final branchId = _selectedBranchId.value;
    if (branchId.isEmpty) return;

    final key = 'MERGED:${_funderGroupKey(funderId, isGoldLoan)}';
    _processingAllocationKey.value = key;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final dateStr = DateFormat('yyyy-MM-dd').format(_collectionDate);

      final res = await _client.post(
        Api.eodAllocationUrl,
        {
          'branchId': branchId,
          'date': dateStr,
          'funderId': funderId,
          'isGoldLoan': isGoldLoan,
          'mergedFunderAllocation': true,
        },
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (res.statusCode == 200 || res.statusCode == 201) {
        final msg = res.body?['message']?.toString() ?? 'Allocated to EOD successfully.';
        Get.snackbar('Allocated', msg, backgroundColor: _green, colorText: Colors.white);
        await _fetchEodAllocations();
      } else {
        final err = res.body?['error'] ?? res.body?['message'] ?? 'Allocation failed';
        Get.snackbar('Allocation Failed', '$err', backgroundColor: Colors.redAccent, colorText: Colors.white);
      }
    } catch (e) {
      Get.snackbar('Error', '$e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _processingAllocationKey.value = null;
    }
  }

  /// Loan Advance is not funder-specific — it's the client's own advance
  /// payment, posted branch/date-wide into a single shared ledger, so it
  /// gets its own bucket and endpoint entirely separate from any funder
  /// card (mirrors the web's `handleAllocateLoanAdvance`).
  Future<void> _allocateLoanAdvance() async {
    final branchId = _selectedBranchId.value;
    if (branchId.isEmpty) return;

    const key = 'LOAN_ADVANCE';
    _processingAllocationKey.value = key;
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final dateStr = DateFormat('yyyy-MM-dd').format(_collectionDate);

      final res = await _client.post(
        Api.eodAllocationLoanAdvanceUrl,
        {'branchId': branchId, 'date': dateStr},
        headers: {
          'Authorization': 'Bearer $token',
          'Content-Type': 'application/json',
        },
      );

      if (res.statusCode == 200 || res.statusCode == 201) {
        final msg = res.body?['message']?.toString() ?? 'Loan Advance allocated to EOD successfully.';
        Get.snackbar('Allocated', msg, backgroundColor: _green, colorText: Colors.white);
        await _fetchEodAllocations();
      } else {
        final err = res.body?['error'] ?? res.body?['message'] ?? 'Allocation failed';
        Get.snackbar('Allocation Failed', '$err', backgroundColor: Colors.redAccent, colorText: Colors.white);
      }
    } catch (e) {
      Get.snackbar('Error', '$e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      _processingAllocationKey.value = null;
    }
  }

  List<Map<String, dynamic>> _filteredRowsForTab(String modeTab) {
    List<Map<String, dynamic>> baseList = [];
    if (modeTab == 'DEMAND') {
      baseList = _rows.where((r) => r['mode'] == 'DEMAND' && r['isGoldLoan'] != true).toList();
    } else if (modeTab == 'ADVANCE') {
      baseList = _rows.where((r) => r['mode'] == 'ADVANCE' && r['isGoldLoan'] != true).toList();
    } else if (modeTab == 'ARREAR') {
      baseList = _rows.where((r) => r['mode'] == 'ARREAR' && r['isGoldLoan'] != true).toList();
    } else if (modeTab == 'GOLD_LOAN') {
      baseList = _rows.where((r) => r['isGoldLoan'] == true).toList();
    }

    if (_selectedCenterId.value.isNotEmpty) {
      baseList = baseList.where((r) {
        final cId = r['centerId']?.toString() ?? r['center']?['id']?.toString() ?? '';
        return cId == _selectedCenterId.value;
      }).toList();
    }

    if (_selectedOfficerId.value.isNotEmpty) {
      baseList = baseList.where((r) {
        final oId = r['collectedById']?.toString() ?? r['collectedBy']?['id']?.toString() ?? '';
        return oId == _selectedOfficerId.value;
      }).toList();
    }

    if (_searchQuery.trim().isEmpty) return baseList;
    final q = _searchQuery.trim().toLowerCase();
    return baseList.where((r) {
      final name = (r['clientName'] ?? '').toString().toLowerCase();
      final code = (r['clientCode'] ?? '').toString().toLowerCase();
      final loanNo = (r['loanNumber'] ?? '').toString().toLowerCase();
      return name.contains(q) || code.contains(q) || loanNo.contains(q);
    }).toList();
  }

  int _countForTab(String modeTab) {
    return _filteredRowsForTab(modeTab).length;
  }

  @override
  Widget build(BuildContext context) {
    final isAdminOrAM = _userRole == 'ADMIN' || _userRole == 'AREA_MANAGER';

    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: _bg,
        appBar: AppBar(
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: _green,
          foregroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.arrow_back, color: Colors.white),
          ),
          title: Text(
            'Collection Approval',
            style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800, color: Colors.white),
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh, color: Colors.white),
              onPressed: () async {
                await _loadBranchLookups();
                await _fetchRows();
                if (_modeTabs[_tabController.index] == 'ALLOCATE_EOD') {
                  await _fetchEodAllocations();
                }
              },
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              _buildFilterCard(isAdminOrAM),
              _buildTabBar(),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildTabContent('DEMAND'),
                    _buildTabContent('ADVANCE'),
                    _buildTabContent('ARREAR'),
                    _buildPreCloseTabContent(),
                    _buildCloseLoansTabContent(),
                    _buildTabContent('GOLD_LOAN'),
                    _buildAllocateEodTabContent(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterCard(bool isAdminOrAM) {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 10.h),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: InkWell(
                  onTap: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: _collectionDate,
                      firstDate: DateTime(2024),
                      lastDate: DateTime(2030),
                    );
                    if (picked != null) {
                      setState(() {
                        _collectionDate = picked;
                      });
                      await _fetchRows();
                    }
                  },
                  borderRadius: BorderRadius.circular(8.r),
                  child: Container(
                    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF4FAF6),
                      border: Border.all(color: _border),
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.calendar_today_outlined, size: 14.sp, color: _green),
                        SizedBox(width: 6.w),
                        Text(
                          DateFormat('dd-MM-yyyy').format(_collectionDate),
                          style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _darkText),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (isAdminOrAM) ...[
                SizedBox(width: 8.w),
                Expanded(
                  child: Obx(
                    () => IdDropdown(
                      label: 'Branch',
                      value: _selectedBranchId.value.isEmpty ? null : _selectedBranchId.value,
                      items: _branches.toList(),
                      labelBuilder: (items, id) {
                        final match = items.firstWhere(
                          (b) => b['id']?.toString() == id,
                          orElse: () => null,
                        );
                        if (match is! Map) return id;
                        final code = match['code']?.toString() ?? '';
                        final name = match['name']?.toString() ?? id;
                        return code.isNotEmpty ? '$code - $name' : name;
                      },
                      onChanged: (val) async {
                        if (val != null) {
                          _selectedBranchId.value = val;
                          await _loadBranchLookups();
                          await _fetchRows();
                        }
                      },
                    ),
                  ),
                ),
              ],
            ],
          ),
          SizedBox(height: 8.h),
          Row(
            children: [
              Expanded(
                child: Obx(
                  () => IdDropdown(
                    label: 'Officer',
                    value: _selectedOfficerId.value.isEmpty ? 'ALL' : _selectedOfficerId.value,
                    items: _officers.toList(),
                    extraOptions: const {'ALL': 'All Officers (FDO)'},
                    labelBuilder: (items, id) {
                      final match = items.firstWhere(
                        (o) => o['id']?.toString() == id,
                        orElse: () => null,
                      );
                      if (match is! Map) return id;
                      final firstName = match['firstName']?.toString() ?? '';
                      final lastName = match['lastName']?.toString() ?? '';
                      final fullName = '$firstName $lastName'.trim();
                      return fullName.isNotEmpty ? fullName : id;
                    },
                    onChanged: (val) async {
                      _selectedOfficerId.value = (val == 'ALL' || val == null) ? '' : val;
                      await _fetchRows();
                    },
                  ),
                ),
              ),
              SizedBox(width: 8.w),
              Expanded(
                child: Obx(
                  () => IdDropdown(
                    label: 'Center',
                    value: _selectedCenterId.value.isEmpty ? 'ALL' : _selectedCenterId.value,
                    items: _centers.toList(),
                    extraOptions: const {'ALL': 'All Centers'},
                    labelBuilder: (items, id) {
                      final match = items.firstWhere(
                        (c) => c['id']?.toString() == id,
                        orElse: () => null,
                      );
                      if (match is! Map) return id;
                      final code = match['code']?.toString() ?? '';
                      final name = match['name']?.toString() ?? id;
                      return code.isNotEmpty ? '$code - $name' : name;
                    },
                    onChanged: (val) async {
                      _selectedCenterId.value = (val == 'ALL' || val == null) ? '' : val;
                      await _fetchRows();
                    },
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      color: Colors.white,
      child: Obx(() {
        return TabBar(
          controller: _tabController,
          isScrollable: true,
          labelColor: _green,
          unselectedLabelColor: _muted,
          indicatorColor: _green,
          indicatorWeight: 3,
          labelStyle: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.bold),
          unselectedLabelStyle: TextStyle(fontSize: 11.sp),
          tabs: [
            Tab(text: 'Demand (${_countForTab('DEMAND')})'),
            Tab(text: 'Advance (${_countForTab('ADVANCE')})'),
            Tab(text: 'Arrear (${_countForTab('ARREAR')})'),
            const Tab(text: 'Pre-Close'),
            const Tab(text: 'Close Loans'),
            Tab(text: 'Gold Loan (${_countForTab('GOLD_LOAN')})'),
            const Tab(text: 'Allocate for EOD'),
          ],
        );
      }),
    );
  }

  Widget _buildTabContent(String modeTab) {
    return Obx(() {
      if (_isLoading.value) {
        return const Center(child: CircularProgressIndicator(color: _green));
      }

      final rows = _filteredRowsForTab(modeTab);
      final totalAmount = rows.fold<double>(
        0.0,
        (s, r) => s + (double.tryParse('${r['totalAmount'] ?? r['amount']}') ?? 0.0),
      );

      final pendingCount = rows.where((r) => r['status']?.toString().toUpperCase() != 'APPROVED' && !_approvedIds.contains(r['transactionId']?.toString() ?? r['id']?.toString())).length;

      return Column(
        children: [
          // Header summary with Search & Bulk Approve
          Container(
            padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 8.h),
            color: const Color(0xFFEBF7F0),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Total: ₹${totalAmount.toStringAsFixed(2)} (${rows.length} rows)',
                        style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w800, color: _darkGreen),
                      ),
                    ),
                    if (pendingCount > 0)
                      ElevatedButton.icon(
                        onPressed: _isSubmitting.value ? null : () => _approveAllPendingForTab(modeTab),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          foregroundColor: Colors.white,
                          padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6.r)),
                        ),
                        icon: const Icon(Icons.done_all_rounded, size: 14),
                        label: Text('Approve All ($pendingCount)', style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.bold)),
                      ),
                  ],
                ),
                SizedBox(height: 6.h),
                SizedBox(
                  height: 34.h,
                  child: TextField(
                    onChanged: (val) => setState(() => _searchQuery = val),
                    style: TextStyle(fontSize: 11.sp),
                    decoration: InputDecoration(
                      hintText: 'Search by Client Name, Code, or Loan No...',
                      hintStyle: TextStyle(fontSize: 10.5.sp, color: _muted),
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
                      prefixIcon: Icon(Icons.search, size: 15.sp, color: _muted),
                      filled: true,
                      fillColor: Colors.white,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(6.r),
                        borderSide: const BorderSide(color: _border),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Collapsible Denomination Breakdown Card
          if (_denominationByCenter.isNotEmpty) ...[
            InkWell(
              onTap: () => setState(() => _showDenominationSummary = !_showDenominationSummary),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 6.h),
                color: const Color(0xFFF1F5F9),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Center Cash & Denomination Breakdown (${_denominationByCenter.length} Centers)',
                      style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.bold, color: _darkText),
                    ),
                    Icon(_showDenominationSummary ? Icons.expand_less : Icons.expand_more, size: 18.sp, color: _muted),
                  ],
                ),
              ),
            ),
            if (_showDenominationSummary)
              Container(
                constraints: BoxConstraints(maxHeight: 120.h),
                color: Colors.white,
                child: ListView.separated(
                  padding: EdgeInsets.all(8.w),
                  itemCount: _denominationByCenter.length,
                  separatorBuilder: (_, __) => Divider(height: 6.h),
                  itemBuilder: (_, index) {
                    final d = _denominationByCenter[index];
                    return Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('${d['centerCode'] ?? ''} - ${d['centerName'] ?? ''}', style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w700)),
                        Text('₹${(d['totalAmount'] ?? 0).toString()}', style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w800, color: _green)),
                      ],
                    );
                  },
                ),
              ),
          ],
          Expanded(
            child: rows.isEmpty
                ? Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.inbox_outlined, size: 42.sp, color: _muted),
                        SizedBox(height: 8.h),
                        Text(
                          'No collections found for $modeTab mode.',
                          style: TextStyle(fontSize: 12.5.sp, color: _muted),
                        ),
                      ],
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _fetchRows,
                    color: _green,
                    child: ListView.separated(
                      padding: EdgeInsets.all(12.w),
                      itemCount: rows.length,
                      separatorBuilder: (_, __) => SizedBox(height: 10.h),
                      itemBuilder: (context, index) => _buildRowCard(rows[index]),
                    ),
                  ),
          ),
        ],
      );
    });
  }

  Widget _buildRowCard(Map<String, dynamic> r) {
    final txId = r['transactionId']?.toString() ?? r['id']?.toString() ?? '';
    final clientName = r['clientName']?.toString() ?? 'Client';
    final clientCode = r['clientCode']?.toString() ?? '';
    final loanNumber = r['loanNumber']?.toString() ?? '';
    final centerName = r['centerName']?.toString() ?? r['center']?['name'] ?? '';
    final centerCode = r['centerCode']?.toString() ?? r['center']?['code'] ?? '';
    final fdoName = r['collectedByName']?.toString() ?? r['collectedBy']?['firstName'] ?? 'FDO';
    final isGold = r['isGoldLoan'] == true;
    final totalAmount = double.tryParse('${r['totalAmount'] ?? r['amount']}') ?? 0.0;
    final principal = double.tryParse('${r['principalAmount']}') ?? 0.0;
    final interest = double.tryParse('${r['interestAmount']}') ?? 0.0;
    final loanAdv = double.tryParse('${r['loanAdvanceAmount']}') ?? 0.0;

    final status = (r['status']?.toString() ?? 'PENDING').toUpperCase();
    final isApproved = status == 'APPROVED' || _approvedIds.contains(txId);

    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: isApproved ? const Color(0xFFA7F3D0) : _border),
        borderRadius: BorderRadius.circular(10.r),
        boxShadow: const [
          BoxShadow(color: Color(0x06000000), blurRadius: 6, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      clientName,
                      style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w800, color: _darkText),
                    ),
                    Text(
                      '$clientCode  •  $loanNumber',
                      style: TextStyle(fontSize: 10.5.sp, color: _muted),
                    ),
                  ],
                ),
              ),
              if (isGold) ...[
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                  margin: EdgeInsets.only(right: 6.w),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(4.r),
                  ),
                  child: Text('GOLD LOAN', style: TextStyle(fontSize: 8.5.sp, fontWeight: FontWeight.bold, color: const Color(0xFFB45309))),
                ),
              ],
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                decoration: BoxDecoration(
                  color: isApproved ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(6.r),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (isApproved)
                      Icon(Icons.check_circle, size: 12.sp, color: _green),
                    if (isApproved) SizedBox(width: 4.w),
                    Text(
                      isApproved ? 'APPROVED' : 'PENDING',
                      style: TextStyle(
                        fontSize: 9.5.sp,
                        fontWeight: FontWeight.bold,
                        color: isApproved ? _green : const Color(0xFFB45309),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Text(
            '${centerCode.isNotEmpty ? "$centerCode - " : ""}$centerName  •  FDO: $fdoName',
            style: TextStyle(fontSize: 10.sp, color: const Color(0xFF475569)),
          ),
          Divider(height: 14.h, color: _border),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _metricCol('Collected', '₹${totalAmount.toStringAsFixed(2)}', isBold: true),
              _metricCol('Principal', '₹${principal.toStringAsFixed(2)}'),
              _metricCol('Interest', '₹${interest.toStringAsFixed(2)}'),
              _metricCol('Adv. Coll.', '₹${loanAdv.toStringAsFixed(2)}'),
            ],
          ),
          if (!isApproved) ...[
            SizedBox(height: 10.h),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _isSubmitting.value ? null : () => _showRevertDialog(txId),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.redAccent,
                      side: const BorderSide(color: Colors.redAccent),
                      padding: EdgeInsets.symmetric(vertical: 8.h),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6.r)),
                    ),
                    icon: const Icon(Icons.undo_rounded, size: 14),
                    label: Text('Revert', style: TextStyle(fontSize: 11.sp)),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _isSubmitting.value ? null : () => _approveRow(txId),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 8.h),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6.r)),
                    ),
                    icon: const Icon(Icons.check_circle_rounded, size: 14),
                    label: Text('Approve', style: TextStyle(fontSize: 11.sp)),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _metricCol(String label, String value, {bool isBold = false}) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 9.sp, color: _muted)),
          SizedBox(height: 2.h),
          Text(
            value,
            style: TextStyle(
              fontSize: 11.sp,
              fontWeight: isBold ? FontWeight.w800 : FontWeight.w600,
              color: isBold ? _green : _darkText,
            ),
          ),
        ],
      );

  Widget _buildPreCloseTabContent() {
    return Container(
      padding: EdgeInsets.all(20.w),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.gavel_rounded, size: 48.sp, color: _green),
          SizedBox(height: 12.h),
          Text(
            'Foreclosure Approval',
            style: TextStyle(fontSize: 15.sp, fontWeight: FontWeight.bold, color: _darkText),
          ),
          SizedBox(height: 6.h),
          Text(
            'Review and approve loan pre-closure & early settlement requests.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 16.h),
          ElevatedButton.icon(
            style: ElevatedButton.styleFrom(
              backgroundColor: _green,
              foregroundColor: Colors.white,
              padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 10.h),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
            ),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ForeclosureApproval()),
            ),
            icon: const Icon(Icons.open_in_new_rounded, size: 16),
            label: const Text('Open Foreclosure Approval'),
          ),
        ],
      ),
    );
  }

  Widget _buildCloseLoansTabContent() {
    final isAdmin = _userRole == 'ADMIN';
    return Container(
      padding: EdgeInsets.all(20.w),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.shield_outlined, size: 48.sp, color: isAdmin ? _green : _muted),
          SizedBox(height: 12.h),
          Text(
            'Close Loans / Write-off',
            style: TextStyle(fontSize: 15.sp, fontWeight: FontWeight.bold, color: _darkText),
          ),
          SizedBox(height: 6.h),
          Text(
            isAdmin
                ? 'Review and execute write-off or manual loan closure actions.'
                : 'Only Admin can close or write off loans. This tab is view-only for your role.',
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
        ],
      ),
    );
  }

  /// (background, label, textColor) for a funder/Loan-Advance group's action
  /// slot — mirrors the web's three mutually-exclusive states: an active
  /// merged voucher already posted ("Revert EOD First"), over-posted vs.
  /// current approved total (same message — the guard is server-side and
  /// this app has no Allocation Revert screen to send the user to directly,
  /// so it just names the web page), or nothing pending at all.
  Widget _eodStatusBadge(String label, Color bg, Color fg) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6.r)),
    child: Text(label, style: TextStyle(fontSize: 10.sp, fontWeight: FontWeight.w700, color: fg)),
  );

  Widget _eodAllocateButton({
    required String processingKey,
    required VoidCallback onPressed,
  }) {
    return Obx(() {
      final anyProcessing = _processingAllocationKey.value != null;
      final isThisOne = _processingAllocationKey.value == processingKey;
      return ElevatedButton.icon(
        onPressed: anyProcessing ? null : onPressed,
        style: ElevatedButton.styleFrom(
          backgroundColor: _green,
          foregroundColor: Colors.white,
          padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
        ),
        icon: isThisOne
            ? SizedBox(width: 13.sp, height: 13.sp, child: const CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Icon(Icons.send_rounded, size: 15),
        label: Text('Allocate For EOD', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700)),
      );
    });
  }

  Widget _buildAllocateEodTabContent() {
    return Obx(() {
      if (_isLoadingEodAllocation.value) {
        return const Center(child: CircularProgressIndicator(color: _green));
      }

      final loanAdvance = _loanAdvanceAllocation.value;
      final loanAdvancePending = (double.tryParse('${loanAdvance?['pendingAmount'] ?? 0}') ?? 0) > 0.01;
      final loanAdvanceOverAllocated = loanAdvance?['overAllocated'] == true;
      final loanAdvancePosted = (double.tryParse('${loanAdvance?['postedAmount'] ?? 0}') ?? 0) > 0.01;

      return RefreshIndicator(
        color: _green,
        onRefresh: _fetchEodAllocations,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: EdgeInsets.all(14.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF8E6),
                  border: Border.all(color: const Color(0xFFFFE0B2)),
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Text(
                  'Allocate for EOD should be done after all collections are done and approved. '
                  'Each funder is posted separately — there is no single action that allocates '
                  'every funder at once.',
                  style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFF9A6B00)),
                ),
              ),
              SizedBox(height: 12.h),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Allocate Approved Collections for EOD',
                    style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.bold, color: _darkText),
                  ),
                  IconButton(
                    icon: const Icon(Icons.refresh, size: 18),
                    onPressed: _fetchEodAllocations,
                  ),
                ],
              ),
              SizedBox(height: 10.h),

              // Loan Advance — not funder-specific, one branch/date-wide bucket
              // with its own action, entirely separate from the funder cards below.
              if (loanAdvance != null && (loanAdvancePending || loanAdvancePosted)) ...[
                Container(
                  width: double.infinity,
                  padding: EdgeInsets.all(12.w),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: _border),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Loan Advance', style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w800, color: _darkText)),
                          if (loanAdvanceOverAllocated)
                            _eodStatusBadge('Revert EOD First', const Color(0xFFFDECEC), Colors.red)
                          else if (!loanAdvancePending)
                            _eodStatusBadge('Allocated', const Color(0xFFDCFCE7), const Color(0xFF15803D))
                          else
                            _eodAllocateButton(processingKey: 'LOAN_ADVANCE', onPressed: _allocateLoanAdvance),
                        ],
                      ),
                      SizedBox(height: 4.h),
                      Text(
                        'Not funder-specific — client\'s own advance payment, posted to the shared Loan Advance ledger.',
                        style: TextStyle(fontSize: 10.sp, color: _muted),
                      ),
                      if (loanAdvancePending) ...[
                        SizedBox(height: 6.h),
                        Text(
                          'Pending: ₹${(double.tryParse('${loanAdvance['pendingAmount'] ?? 0}') ?? 0).toStringAsFixed(2)}',
                          style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText),
                        ),
                      ],
                    ],
                  ),
                ),
                SizedBox(height: 10.h),
              ],

              if (_funderAllocations.isEmpty && loanAdvance == null)
                Center(
                  child: Padding(
                    padding: EdgeInsets.all(24.w),
                    child: Text(
                      'No approved collections to allocate for this date.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 11.5.sp, color: _muted),
                    ),
                  ),
                )
              else
                ListView.separated(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  itemCount: _funderAllocations.length,
                  separatorBuilder: (_, __) => SizedBox(height: 10.h),
                  itemBuilder: (_, index) {
                    final f = _funderAllocations[index];
                    final fName = f['funderName']?.toString() ?? 'Funder';
                    final fId = f['funderId'];
                    final isGoldLoan = f['isGoldLoan'] == true;
                    final hasPending = f['hasPending'] == true;
                    final hasAnyAllocated = f['hasAnyAllocated'] == true;
                    final overAllocated = f['overAllocated'] == true;
                    final totalAmt = f['totalAmount'] as double? ?? 0.0;
                    final principal = f['principalAmount'] as double? ?? 0.0;
                    final interest = f['interestAmount'] as double? ?? 0.0;
                    final processingKey = 'MERGED:${_funderGroupKey(fId, isGoldLoan)}';

                    return Container(
                      padding: EdgeInsets.all(12.w),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        border: Border.all(color: _border),
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Wrap(
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  spacing: 6.w,
                                  children: [
                                    Text('Funder: $fName', style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w800, color: _darkText)),
                                    if (isGoldLoan)
                                      Container(
                                        padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFFEF3C7),
                                          borderRadius: BorderRadius.circular(10.r),
                                        ),
                                        child: Text('GOLD', style: TextStyle(fontSize: 8.5.sp, fontWeight: FontWeight.w800, color: const Color(0xFF92400E))),
                                      ),
                                  ],
                                ),
                              ),
                              if (hasPending)
                                (overAllocated || hasAnyAllocated)
                                    ? _eodStatusBadge('Revert EOD First', const Color(0xFFFDECEC), Colors.red)
                                    : _eodAllocateButton(
                                        processingKey: processingKey,
                                        onPressed: () => _allocateFunderGroup(fId, isGoldLoan),
                                      )
                              else
                                _eodStatusBadge('Allocated', const Color(0xFFDCFCE7), const Color(0xFF15803D)),
                            ],
                          ),
                          SizedBox(height: 6.h),
                          Text(
                            hasPending
                                ? 'Pending: ₹${totalAmt.toStringAsFixed(2)}  (Prin: ₹${principal.toStringAsFixed(2)}, Int: ₹${interest.toStringAsFixed(2)})'
                                : 'Nothing pending for this funder on this date.',
                            style: TextStyle(fontSize: 10.5.sp, color: _muted),
                          ),
                          if (overAllocated) ...[
                            SizedBox(height: 6.h),
                            Text(
                              'GL posting for this funder/date is higher than the current approved total — most '
                              'likely a collection was reverted after allocation. Revert the EOD allocation for '
                              'this funder/date (web: Admin → EOD Allocation Revert) before allocating again.',
                              style: TextStyle(fontSize: 9.5.sp, color: Colors.red),
                            ),
                          ],
                        ],
                      ),
                    );
                  },
                ),
            ],
          ),
        ),
      );
    });
  }
}
