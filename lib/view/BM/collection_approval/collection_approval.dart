import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/view/AM/foreclosure_approval/foreclosure_approval.dart';

const _green = Color(0xFF00843D);
const _darkGreen = Color(0xFF075E2E);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE1EEE6);
const _bg = Color(0xFFF7FBF8);

/// Complete BM/AM Collection Approval screen — feature-identical with web app's
/// `CollectionApprovalClient.tsx`. Supports Demand, Advance, Arrear, Gold Loan &
/// Pre-Close modes with Date/Branch/Center/FDO filtering and instant approvals.
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

  final RxList<dynamic> _branches = <dynamic>[].obs;
  final RxList<dynamic> _centers = <dynamic>[].obs;
  final RxList<dynamic> _officers = <dynamic>[].obs;

  final RxString _selectedBranchId = ''.obs;
  final RxString _selectedCenterId = ''.obs;
  final RxString _selectedOfficerId = ''.obs;
  DateTime _collectionDate = DateTime.now();

  final RxList<Map<String, dynamic>> _rows = <Map<String, dynamic>>[].obs;
  final RxSet<String> _approvedIds = <String>{}.obs;

  String _userRole = '';
  String _searchQuery = '';

  late TabController _tabController;
  final List<String> _modeTabs = [
    'DEMAND',
    'ADVANCE',
    'ARREAR',
    'GOLD_LOAN',
    'PRE_CLOSE',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _modeTabs.length, vsync: this);
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

      // Fetch branches if Admin / Area Manager
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
        final cData = cRes.body['data'];
        _centers.assignAll(cData is List ? cData : <dynamic>[]);
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

        final List<Map<String, dynamic>> parsedRows = rawRows
            .map((r) => r is Map ? Map<String, dynamic>.from(r) : <String, dynamic>{})
            .where((m) => m.isNotEmpty)
            .toList();

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
    if (modeTab == 'DEMAND') {
      return _rows.where((r) => r['mode'] == 'DEMAND' && r['isGoldLoan'] != true).length;
    } else if (modeTab == 'ADVANCE') {
      return _rows.where((r) => r['mode'] == 'ADVANCE' && r['isGoldLoan'] != true).length;
    } else if (modeTab == 'ARREAR') {
      return _rows.where((r) => r['mode'] == 'ARREAR' && r['isGoldLoan'] != true).length;
    } else if (modeTab == 'GOLD_LOAN') {
      return _rows.where((r) => r['isGoldLoan'] == true).length;
    }
    return 0;
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
                    _buildTabContent('GOLD_LOAN'),
                    _buildPreCloseTabContent(),
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
                  child: Obx(() {
                    return Container(
                      padding: EdgeInsets.symmetric(horizontal: 8.w),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF4FAF6),
                        border: Border.all(color: _border),
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedBranchId.value.isEmpty ? null : _selectedBranchId.value,
                          isExpanded: true,
                          hint: Text('Select Branch', style: TextStyle(fontSize: 11.sp)),
                          items: _branches.map((b) {
                            final bId = b['id']?.toString() ?? '';
                            final name = b['name']?.toString() ?? '';
                            final code = b['code']?.toString() ?? '';
                            return DropdownMenuItem<String>(
                              value: bId,
                              child: Text(code.isNotEmpty ? '$code - $name' : name, style: TextStyle(fontSize: 11.sp), overflow: TextOverflow.ellipsis),
                            );
                          }).toList(),
                          onChanged: (val) async {
                            if (val != null) {
                              _selectedBranchId.value = val;
                              await _loadBranchLookups();
                              await _fetchRows();
                            }
                          },
                        ),
                      ),
                    );
                  }),
                ),
              ],
            ],
          ),
          SizedBox(height: 8.h),
          Row(
            children: [
              Expanded(
                child: Obx(() {
                  return Container(
                    padding: EdgeInsets.symmetric(horizontal: 8.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF4FAF6),
                      border: Border.all(color: _border),
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedOfficerId.value.isEmpty ? 'ALL' : _selectedOfficerId.value,
                        isExpanded: true,
                        items: [
                          DropdownMenuItem(value: 'ALL', child: Text('All Officers (FDO)', style: TextStyle(fontSize: 11.sp))),
                          ..._officers.map((o) {
                            final id = o['id']?.toString() ?? '';
                            final name = '${o['firstName'] ?? ''} ${o['lastName'] ?? ''}'.trim();
                            return DropdownMenuItem<String>(
                              value: id,
                              child: Text(name, style: TextStyle(fontSize: 11.sp), overflow: TextOverflow.ellipsis),
                            );
                          }),
                        ],
                        onChanged: (val) async {
                          _selectedOfficerId.value = (val == 'ALL' || val == null) ? '' : val;
                          await _fetchRows();
                        },
                      ),
                    ),
                  );
                }),
              ),
              SizedBox(width: 8.w),
              Expanded(
                child: Obx(() {
                  return Container(
                    padding: EdgeInsets.symmetric(horizontal: 8.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF4FAF6),
                      border: Border.all(color: _border),
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        value: _selectedCenterId.value.isEmpty ? 'ALL' : _selectedCenterId.value,
                        isExpanded: true,
                        items: [
                          DropdownMenuItem(value: 'ALL', child: Text('All Centers', style: TextStyle(fontSize: 11.sp))),
                          ..._centers.map((c) {
                            final id = c['id']?.toString() ?? '';
                            final name = c['name']?.toString() ?? '';
                            final code = c['code']?.toString() ?? '';
                            return DropdownMenuItem<String>(
                              value: id,
                              child: Text(code.isNotEmpty ? '$code - $name' : name, style: TextStyle(fontSize: 11.sp), overflow: TextOverflow.ellipsis),
                            );
                          }),
                        ],
                        onChanged: (val) async {
                          _selectedCenterId.value = (val == 'ALL' || val == null) ? '' : val;
                          await _fetchRows();
                        },
                      ),
                    ),
                  );
                }),
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
            Tab(text: 'Gold Loan (${_countForTab('GOLD_LOAN')})'),
            const Tab(text: 'Pre-Close'),
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

      return Column(
        children: [
          Container(
            padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 8.h),
            color: const Color(0xFFEBF7F0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Total Collection: ₹${totalAmount.toStringAsFixed(2)} (${rows.length} rows)',
                    style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w800, color: _darkGreen),
                  ),
                ),
                SizedBox(
                  width: 140.w,
                  height: 32.h,
                  child: TextField(
                    onChanged: (val) => setState(() => _searchQuery = val),
                    style: TextStyle(fontSize: 10.5.sp),
                    decoration: InputDecoration(
                      hintText: 'Search...',
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 6.h),
                      prefixIcon: Icon(Icons.search, size: 14.sp, color: _muted),
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
}
