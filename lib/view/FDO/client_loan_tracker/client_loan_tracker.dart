import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/fdo_recheck_dialog.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ClientLoanTracker extends StatefulWidget {
  const ClientLoanTracker({super.key});

  @override
  State<ClientLoanTracker> createState() => _ClientLoanTrackerState();
}

class LoanTrackerItem {
  final String clientId;
  final String name;
  final String mobile;
  final String center;
  final String branch;
  final String branchId;
  String
  status; // 'Draft', 'Approval Queue', 'Approved', 'Pre Disbursement', 'Disbursed', 'Recheck'
  final String enrolledOn;
  final String startedBy;
  final String draftDate;
  final String
  queueStage; // 'BM Approval', 'AM Approval', 'QC Approval', 'Admin Approval'
  final String waitingDays; // e.g. '23d ago'
  final String enrolledBy;
  final String loanNo;
  final String amount;
  final String disbStage;
  final String remarks;
  final String recheckStage;
  final String requestedBy;
  final String recheckAction;
  // Raw approval history for the detail trail
  final List<Map<String, dynamic>> approvalHistory;

  LoanTrackerItem({
    required this.clientId,
    required this.name,
    required this.mobile,
    required this.center,
    required this.branch,
    required this.branchId,
    required this.status,
    required this.enrolledOn,
    this.startedBy = "",
    this.draftDate = "",
    this.queueStage = "",
    this.waitingDays = "",
    this.enrolledBy = "",
    this.loanNo = "",
    this.amount = "",
    this.disbStage = "",
    this.remarks = "",
    this.recheckStage = "",
    this.requestedBy = "",
    this.recheckAction = "",
    this.approvalHistory = const [],
  });
}

class _ClientLoanTrackerState extends State<ClientLoanTracker> {
  late List<LoanTrackerItem> _items;
  final ApiClient _apiClient = ApiClient();
  bool _isLoading = false;

  final List<String> _branches = ['All Branches', 'Theni', 'Ooty', 'Madurai'];

  String _selectedStatus = 'All';
  String _selectedBranch = 'All Branches';
  String _selectedQueueStage = 'All Stages';
  String _searchQuery = '';
  DateTime? _fromDate;
  DateTime? _toDate;

  @override
  void initState() {
    super.initState();
    _items = [];
    _loadTracker();
  }

  Future<void> _loadTracker() async {
    setState(() => _isLoading = true);
    try {
      // Read branch info before calling the API so we can pass it as a filter
      // param — the server scopes its response to the supplied branchId,
      // mirroring the web app's behaviour.
      final prefs = await SharedPreferences.getInstance();
      final userBranchId = prefs.getString('branchId') ?? '';
      final role = prefs.getString('role') ?? '';
      final rbacRoleName = prefs.getString('rbacRoleName') ?? '';
      final assigned = prefs.getStringList('assignedBranchIds') ?? [];
      final isAM = RoleScope.isAreaManager(role) || RoleScope.isAreaManager(rbacRoleName);

      // Build query string: always fetch all statuses; filter by single branch
      // for single-branch roles (FDO/BM), but omit explicit branchId for AM
      // so backend returns all assigned branches.
      final branchParam = (!isAM && userBranchId.isNotEmpty)
          ? '&branchId=$userBranchId'
          : '';
      final response = await _apiClient.get(
        '${Api.clientLoanTrackerUrl}?tab=all&page=1&pageSize=200$branchParam',
      );
      final body = response.body;
      final rawClients =
          body is Map && body['success'] == true && body['data'] is Map
          ? body['data']['clients']
          : null;

      if (rawClients is List) {
        final loaded = rawClients
            .whereType<Map>()
            .map(
              (client) =>
                  _trackerItemFromApi(Map<String, dynamic>.from(client)),
            )
            .toList();

        // Client-side safety net: if the API didn't honour the branchId param
        // (e.g. older backend), filter locally so FDOs never see other branches.
        final filtered = userBranchId.isEmpty
            ? loaded
            : loaded.where((item) {
                if (isAM) return true;
                if (item.branchId.isEmpty) return false;
                if (item.branchId == userBranchId) return true;
                if (assigned.isNotEmpty && assigned.contains(item.branchId)) {
                  return true;
                }
                return false;
              }).toList();

        setState(() {
          _items = filtered;
          _branches
            ..clear()
            ..addAll([
              'All Branches',
              ..._items
                  .map((item) => item.branch)
                  .where((b) => b.isNotEmpty && b != '—')
                  .toSet(),
            ]);
          // Pre-select the user's own branch
          final branchName = prefs.getString('branchName') ?? '';
          if (branchName.isNotEmpty && _branches.contains(branchName)) {
            _selectedBranch = branchName;
          }
        });
      } else if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to load the client loan tracker.'),
          ),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to load the client loan tracker.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  LoanTrackerItem _trackerItemFromApi(Map<String, dynamic> client) {
    final approvalStatus = '${client['approvalStatus'] ?? ''}';
    final loans = client['loanApplications'] is List
        ? client['loanApplications'] as List
        : const [];
    final latestLoan = loans.isNotEmpty && loans.first is Map
        ? Map<String, dynamic>.from(loans.first as Map)
        : <String, dynamic>{};
    final disbursementStatus = '${latestLoan['disbursementStatus'] ?? ''}';
    final status = _statusFor(approvalStatus, disbursementStatus);

    final center = client['center'] is Map
        ? Map<String, dynamic>.from(client['center'] as Map)
        : <String, dynamic>{};
    final branch = center['branch'] is Map
        ? Map<String, dynamic>.from(center['branch'] as Map)
        : <String, dynamic>{};
    final enrolledBy = client['enrolledBy'] is Map
        ? Map<String, dynamic>.from(client['enrolledBy'] as Map)
        : <String, dynamic>{};

    // ── Approval history ─────────────────────────────────────────────────────
    final rawHistory = client['approvalHistory'] is List
        ? (client['approvalHistory'] as List)
              .whereType<Map>()
              .map((h) => Map<String, dynamic>.from(h))
              .toList()
        : <Map<String, dynamic>>[];

    // ── Task 5: real waiting days from createdAt ──────────────────────────────
    final waitingDays = _waitingSince(client['createdAt']);

    // ── Task 4: recheck requestedBy / recheckStage from history ──────────────
    // Look for the most recent RETAKE/REJECT action in the history to identify
    // who requested the recheck and at which stage.
    String recheckStage = _approvalLabel(approvalStatus);
    String requestedBy = '';
    for (final h in rawHistory.reversed) {
      final action = '${h['action'] ?? ''}';
      if (action.contains('RETAKE') || action.contains('REJECT')) {
        final performer = h['performedBy'] is Map
            ? Map<String, dynamic>.from(h['performedBy'] as Map)
            : <String, dynamic>{};
        requestedBy =
            '${performer['firstName'] ?? ''} ${performer['lastName'] ?? ''}'
                .trim();
        // Determine which stage made the request
        if (action.contains('AM') || action.contains('LEVEL_2')) {
          recheckStage = 'AM Approval';
        } else if (action.contains('QC') || action.contains('LEVEL_3')) {
          recheckStage = 'QC Approval';
        } else if (action.contains('FINAL') || action.contains('LEVEL_4')) {
          recheckStage = 'Admin Approval';
        } else {
          recheckStage = 'BM Approval';
        }
        break;
      }
    }

    final enrolledByName =
        '${enrolledBy['firstName'] ?? ''} ${enrolledBy['lastName'] ?? ''}'
            .trim();

    return LoanTrackerItem(
      clientId: '${client['clientId'] ?? client['id'] ?? '—'}',
      name: '${client['firstName'] ?? ''} ${client['lastName'] ?? ''}'.trim(),
      mobile: '${client['mobileNumber'] ?? '—'}',
      center: '${center['name'] ?? '—'}',
      branch: '${branch['name'] ?? '—'}',
      branchId: '${branch['id'] ?? ''}',
      status: status,
      enrolledOn: _displayDate(client['createdAt']),
      startedBy: enrolledByName,
      draftDate: _displayDate(client['createdAt']),
      queueStage: _approvalLabel(approvalStatus),
      waitingDays: waitingDays,
      enrolledBy: enrolledByName,
      loanNo: '${latestLoan['loanNumber'] ?? '—'}',
      amount: '${latestLoan['amount'] ?? '—'}',
      disbStage: disbursementStatus,
      remarks: '${client['rejectionReason'] ?? ''}',
      recheckStage: recheckStage,
      requestedBy: requestedBy,
      recheckAction: status == 'Recheck' ? 'Resolve' : '',
      approvalHistory: rawHistory,
    );
  }

  /// Returns a human-readable "Xd ago" / "Xh ago" string from an ISO date.
  String _waitingSince(dynamic value) {
    if (value == null) return '—';
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return '—';
    final diff = DateTime.now().difference(parsed);
    if (diff.inDays >= 1) return '${diff.inDays}d ago';
    if (diff.inHours >= 1) return '${diff.inHours}h ago';
    return '${diff.inMinutes}m ago';
  }

  String _statusFor(String approvalStatus, String disbursementStatus) {
    if (disbursementStatus == 'DISBURSED') {
      return 'Disbursed';
    }
    if (disbursementStatus.isNotEmpty && disbursementStatus != 'PENDING') {
      return 'Pre Disbursement';
    }
    if (approvalStatus == 'DRAFT') {
      return 'Draft';
    }
    if (approvalStatus == 'APPROVED') {
      return 'Approved';
    }
    if (approvalStatus.contains('RETAKE') ||
        approvalStatus.contains('REJECT')) {
      return 'Recheck';
    }
    return 'Approval Queue';
  }

  String _approvalLabel(String status) {
    if (status.contains('AM') || status.contains('LEVEL_2')) {
      return 'AM Approval';
    }
    if (status.contains('QC') || status.contains('LEVEL_3')) {
      return 'QC Approval';
    }
    if (status.contains('FINAL') || status.contains('LEVEL_4')) {
      return 'Admin Approval';
    }
    return 'BM Approval';
  }

  String _displayDate(dynamic value) {
    if (value == null) return '—';
    final parsed = DateTime.tryParse(value.toString());
    if (parsed == null) return value.toString();
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return '${parsed.day.toString().padLeft(2, '0')} ${months[parsed.month - 1]} ${parsed.year}';
  }

  /// Renders a loan/client amount with Indian digit grouping (₹40,000); falls
  /// back to the raw string when it isn't a plain number (e.g. the '—'
  /// placeholder).
  String _formatAmount(String raw) {
    final cleaned = raw.replaceAll(',', '').trim();
    final n = num.tryParse(cleaned);
    if (n == null) return raw;
    return NumberFormat('#,##,##0', 'en_IN').format(n);
  }

  DateTime? _parseEnrolledDate(String enrolledOn) {
    try {
      final parts = enrolledOn.split(' ');
      if (parts.length < 3) return null;
      final day = int.parse(parts[0]);
      final monthStr = parts[1];
      final year = int.parse(parts[2]);

      final months = {
        'Jan': 1,
        'Feb': 2,
        'Mar': 3,
        'Apr': 4,
        'May': 5,
        'Jun': 6,
        'Jul': 7,
        'Aug': 8,
        'Sep': 9,
        'Oct': 10,
        'Nov': 11,
        'Dec': 12,
      };

      final month = months[monthStr] ?? 1;
      return DateTime(year, month, day);
    } catch (_) {
      return null;
    }
  }

  List<LoanTrackerItem> get _filteredItems {
    return _items.where((item) {
      // 1. Status Filter
      final matchesStatus =
          _selectedStatus == 'All' ||
          item.status.toLowerCase() == _selectedStatus.toLowerCase();

      // 2. Queue Stage sub-filter (for Approval Queue tab)
      final matchesQueueStage =
          _selectedStatus != 'Approval Queue' ||
          _selectedQueueStage == 'All Stages' ||
          item.queueStage == _selectedQueueStage;

      // 3. Branch Filter
      final matchesBranch =
          _selectedBranch == 'All Branches' ||
          item.branch == _selectedBranch ||
          item.branch == '—'; // Always show drafts/unassigned

      // 4. Search Query
      final matchesSearch =
          _searchQuery.isEmpty ||
          item.clientId.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          item.name.toLowerCase().contains(_searchQuery.toLowerCase()) ||
          item.mobile.contains(_searchQuery);

      // 5. Date Range Filter
      bool matchesDate = true;
      final parsedDate = _parseEnrolledDate(item.enrolledOn);
      if (parsedDate != null) {
        if (_fromDate != null && parsedDate.isBefore(_fromDate!)) {
          matchesDate = false;
        }
        if (_toDate != null &&
            parsedDate.isAfter(_toDate!.add(const Duration(days: 1)))) {
          matchesDate = false;
        }
      }

      return matchesStatus &&
          matchesQueueStage &&
          matchesBranch &&
          matchesSearch &&
          matchesDate;
    }).toList();
  }

  Future<void> _pickDate(BuildContext context, bool isFrom) async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(primary: Color(0xFF0C5F34)),
          ),
          child: child!,
        );
      },
    );

    if (date == null) {
      return;
    }

    setState(() {
      if (isFrom) {
        _fromDate = date;
      } else {
        _toDate = date;
      }
    });
  }

  Future<void> _refresh() async {
    setState(() {
      _searchQuery = '';
      _selectedStatus = 'All';
      _selectedBranch = 'All Branches';
      _selectedQueueStage = 'All Stages';
      _fromDate = null;
      _toDate = null;
    });
    await _loadTracker();
  }

  void _deleteDraft(String clientId) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16.r),
        ),
        title: const Text('Delete Draft'),
        content: const Text(
          'Are you sure you want to delete this draft application?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.red.shade700,
            ),
            child: const Text('Delete', style: TextStyle(color: Colors.white)),
            onPressed: () {
              Navigator.pop(context);
              setState(() {
                _items.removeWhere((item) => item.clientId == clientId);
              });
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Draft deleted successfully')),
              );
            },
          ),
        ],
      ),
    );
  }

  /// Opens the real re-upload/resubmit flow (mirrors the web app's
  /// `FDORecheckDialog`): fetches the client's flagged KYC documents,
  /// lets the FDO replace each one via `.../documents/{id}/reupload`, and
  /// only then allows `FDO_RESUBMIT` via `.../action`. On success, reloads
  /// the tracker from the server so the item's real new status shows —
  /// nothing is guessed or set locally.
  Future<void> _openRecheckAction(LoanTrackerItem item) async {
    final resubmitted = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => FdoRecheckDialog(
        clientId: item.clientId,
        clientName: item.name,
        stageRemark: item.remarks,
      ),
    );
    if (resubmitted == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Application for ${item.name} resubmitted for review.'),
          backgroundColor: const Color(0xFF0C5F34),
          behavior: SnackBarBehavior.floating,
        ),
      );
      await _loadTracker();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            // Header block
            _buildHeader(),

            Expanded(
              child: RefreshIndicator(
                color: const Color(0xFF0C5F34),
                onRefresh: _refresh,
                child: ListView(
                  padding: EdgeInsets.symmetric(horizontal: 16.w),
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  children: [
                    SizedBox(height: 16.h),

                    // Horizontal Status Row with counts
                    _buildStatusFilterRow(),

                    SizedBox(height: 16.h),

                    // Filter options card
                    _buildFiltersCard(),

                    // Secondary filter for Approval Queue
                    if (_selectedStatus == 'Approval Queue') ...[
                      SizedBox(height: 8.h),
                      Text(
                        'FILTER BY APPROVAL STAGE:',
                        style: TextStyle(
                          fontSize: 10.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF4F765E),
                        ),
                      ),
                      _buildQueueSubFilter(),
                    ],

                    SizedBox(height: 18.h),

                    // List Section Title
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            Icon(
                              Icons.list_alt_rounded,
                              size: 16.sp,
                              color: const Color(0xFF0C5F34),
                            ),
                            SizedBox(width: 6.w),
                            Text(
                              '$_selectedStatus (${_filteredItems.length} records)',
                              style: TextStyle(
                                fontSize: 14.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF0F172A),
                              ),
                            ),
                          ],
                        ),
                        if (_fromDate != null ||
                            _toDate != null ||
                            _searchQuery.isNotEmpty)
                          GestureDetector(
                            onTap: _refresh,
                            child: Text(
                              'Clear Filters',
                              style: TextStyle(
                                fontSize: 11.sp,
                                color: Colors.red.shade700,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                      ],
                    ),
                    SizedBox(height: 12.h),

                    // Dynamic cards listing
                    if (_isLoading && _items.isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 48),
                        child: Center(
                          child: CircularProgressIndicator(
                            color: Color(0xFF0C5F34),
                          ),
                        ),
                      )
                    else if (_filteredItems.isEmpty)
                      _buildEmptyState()
                    else
                      ..._filteredItems.map(_buildTrackerCard),

                    SizedBox(height: 20.h),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.maybePop(context),
            child: Container(
              padding: EdgeInsets.all(6.r),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F2),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Icon(
                Icons.arrow_back,
                color: const Color(0xFF0C5F34),
                size: 20.sp,
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.r),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5F7EA),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Icon(
                    Icons.trending_up,
                    color: const Color(0xFF0C5F34),
                    size: 22.sp,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Client Loan Tracker',
                        style: TextStyle(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF0C5F34),
                        ),
                      ),
                      Text(
                        'Track customers across all stages',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF4F765E),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _refresh,
            icon: const Icon(Icons.refresh, color: Color(0xFF0C5F34)),
            style: IconButton.styleFrom(
              backgroundColor: const Color(0xFFE5F7EA),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(10.r),
              ),
            ),
          ),
        ],
      ),
    );
  }

  static const _statusIcons = {
    'All': Icons.grid_view_rounded,
    'Draft': Icons.edit_note_rounded,
    'Approval Queue': Icons.hourglass_top_rounded,
    'Approved': Icons.verified_rounded,
    'Pre Disbursement': Icons.pending_actions_rounded,
    'Disbursed': Icons.check_circle_rounded,
    'Recheck': Icons.error_outline_rounded,
  };

  Widget _buildStatusFilterRow() {
    final statusCounts = {
      'All': _items.length,
      'Draft': _items.where((i) => i.status == 'Draft').length,
      'Approval Queue': _items
          .where((i) => i.status == 'Approval Queue')
          .length,
      'Approved': _items.where((i) => i.status == 'Approved').length,
      'Pre Disbursement': _items
          .where((i) => i.status == 'Pre Disbursement')
          .length,
      'Disbursed': _items.where((i) => i.status == 'Disbursed').length,
      'Recheck': _items.where((i) => i.status == 'Recheck').length,
    };

    final statusColors = {
      'All': const Color(0xFF0C5F34),
      'Draft': Colors.grey.shade700,
      'Approval Queue': Colors.orange.shade800,
      'Approved': Colors.green.shade700,
      'Pre Disbursement': Colors.purple.shade700,
      'Disbursed': const Color(0xFF0D6842),
      'Recheck': Colors.red.shade700,
    };

    return SizedBox(
      height: 38.h,
      child: ListView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        children: statusCounts.entries.map((entry) {
          final status = entry.key;
          final count = entry.value;
          final isSelected = _selectedStatus == status;
          final color = statusColors[status] ?? const Color(0xFF0C5F34);

          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedStatus = status;
              });
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              margin: EdgeInsets.only(right: 8.w),
              padding: EdgeInsets.symmetric(horizontal: 12.w),
              decoration: BoxDecoration(
                color: isSelected ? color : Colors.white,
                borderRadius: BorderRadius.circular(10.r),
                border: Border.all(
                  color: isSelected ? color : const Color(0xFFD7E9DD),
                  width: 1,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    _statusIcons[status] ?? Icons.circle,
                    size: 13.sp,
                    color: isSelected ? Colors.white : color,
                  ),
                  SizedBox(width: 5.w),
                  Text(
                    status,
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: isSelected
                          ? FontWeight.bold
                          : FontWeight.normal,
                      color: isSelected
                          ? Colors.white
                          : const Color(0xFF4F765E),
                    ),
                  ),
                  SizedBox(width: 6.w),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 6.w,
                      vertical: 2.h,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.white24
                          : const Color(0xFFE5F7EA),
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                    child: Text(
                      '$count',
                      style: TextStyle(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.bold,
                        color: isSelected ? Colors.white : color,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildQueueSubFilter() {
    final stages = [
      'All Stages',
      'BM Approval',
      'AM Approval',
      'QC Approval',
      'Admin Approval',
    ];

    return Container(
      margin: EdgeInsets.symmetric(vertical: 8.h),
      height: 32.h,
      child: ListView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        children: stages.map((stage) {
          final isSelected = _selectedQueueStage == stage;
          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedQueueStage = stage;
              });
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              margin: EdgeInsets.only(right: 8.w),
              padding: EdgeInsets.symmetric(horizontal: 12.w),
              decoration: BoxDecoration(
                color: isSelected
                    ? const Color(0xFF0C5F34)
                    : const Color(0xFFE5F7EA),
                borderRadius: BorderRadius.circular(20.r),
              ),
              child: Center(
                child: Text(
                  stage,
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: isSelected
                        ? FontWeight.bold
                        : FontWeight.normal,
                    color: isSelected ? Colors.white : const Color(0xFF0C5F34),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildFiltersCard() {
    return Container(
      padding: EdgeInsets.all(14.r),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18.r),
        border: Border.all(color: const Color(0xFFD7E9DD)),
      ),
      child: Column(
        children: [
          // Search input
          TextField(
            style: TextStyle(fontSize: 14.sp),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search, color: Color(0xFF729A7D)),
              hintText: 'Client ID, name or mobile...',
              hintStyle: const TextStyle(color: Color(0xFF8FA88B)),
              filled: true,
              fillColor: const Color(0xFFF7FBF7),
              contentPadding: EdgeInsets.symmetric(vertical: 10.h),
              border: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
                borderRadius: BorderRadius.circular(12.r),
              ),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
                borderRadius: BorderRadius.circular(12.r),
              ),
            ),
            onChanged: (value) => setState(() => _searchQuery = value),
          ),
          SizedBox(height: 12.h),

          // Dates select row
          Row(
            children: [
              Expanded(
                child: _DateField(
                  label: 'From',
                  value: _fromDate,
                  onTap: () => _pickDate(context, true),
                ),
              ),
              SizedBox(width: 8.w),
              Expanded(
                child: _DateField(
                  label: 'To',
                  value: _toDate,
                  onTap: () => _pickDate(context, false),
                ),
              ),
            ],
          ),
          SizedBox(height: 12.h),

          // Branch select
          DropdownButtonFormField<String>(
            key: ValueKey(_selectedBranch),
            isExpanded: true,
            initialValue: _selectedBranch,
            style: TextStyle(fontSize: 14.sp, color: Colors.black),
            decoration: InputDecoration(
              prefixIcon: const Icon(
                Icons.location_city,
                color: Color(0xFF729A7D),
              ),
              filled: true,
              fillColor: const Color(0xFFF7FBF7),
              contentPadding: EdgeInsets.symmetric(vertical: 10.h),
              border: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
                borderRadius: BorderRadius.circular(12.r),
              ),
              enabledBorder: OutlineInputBorder(
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
                borderRadius: BorderRadius.circular(12.r),
              ),
            ),
            items: _branches
                .map(
                  (branch) =>
                      DropdownMenuItem(value: branch, child: Text(branch)),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) {
                setState(() => _selectedBranch = value);
              }
            },
          ),
        ],
      ),
    );
  }

  /// Resolves the badge label/colors for [item] — one place shared by the
  /// card list and (indirectly) the details sheet, so a status always reads
  /// the same color everywhere in the tracker.
  ({Color color, Color bg, String label}) _styleFor(LoanTrackerItem item) {
    if (item.status == 'Approval Queue') {
      switch (item.queueStage) {
        case 'BM Approval':
          return (
            color: const Color(0xFF025C27),
            bg: const Color(0xFFF0FAF4),
            label: 'BM APPROVAL',
          );
        case 'AM Approval':
          return (
            color: Colors.blue.shade700,
            bg: Colors.blue.shade50,
            label: 'AM APPROVAL',
          );
        case 'QC Approval':
          return (
            color: Colors.teal.shade700,
            bg: Colors.teal.shade50,
            label: 'QC APPROVAL',
          );
        default:
          return (
            color: Colors.deepPurple.shade400,
            bg: Colors.deepPurple.shade50,
            label: 'ADMIN APPROVAL',
          );
      }
    }
    switch (item.status) {
      case 'Draft':
        return (
          color: const Color(0xFF475569),
          bg: const Color(0xFFF1F5F9),
          label: 'DRAFT',
        );
      case 'Pre Disbursement':
        return (
          color: item.disbStage.contains('BM')
              ? Colors.blue.shade700
              : Colors.purple.shade700,
          bg: item.disbStage.contains('BM')
              ? Colors.blue.shade50
              : Colors.purple.shade50,
          label: item.disbStage.isEmpty
              ? 'PRE DISBURSEMENT'
              : item.disbStage.toUpperCase(),
        );
      case 'Disbursed':
        return (
          color: const Color(0xFF0D6842),
          bg: const Color(0xFFE8F5E9),
          label: 'DISBURSED',
        );
      case 'Approved':
        return (
          color: const Color(0xFF15803D),
          bg: const Color(0xFFDCFCE7),
          label: 'APPROVED',
        );
      case 'Recheck':
        return (
          color: Colors.red.shade700,
          bg: Colors.red.shade50,
          label: 'RECHECK',
        );
      default:
        return (
          color: const Color(0xFF0C5F34),
          bg: const Color(0xFFE5F7EA),
          label: item.status.toUpperCase(),
        );
    }
  }

  /// One shared card layout for every status tab — avatar, name, client ID,
  /// a colored stage badge, icon-labeled meta info, and a status-specific
  /// footer (amount / waiting time / remarks / delete). Replaces what used
  /// to be six near-duplicate card builders so every tab reads consistently.
  Widget _buildTrackerCard(LoanTrackerItem item) {
    final style = _styleFor(item);
    final isDraft = item.status == 'Draft';
    final isRecheck = item.status == 'Recheck';
    final isMoneyStage =
        item.status == 'Pre Disbursement' || item.status == 'Disbursed';

    return Container(
      margin: EdgeInsets.only(bottom: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: isRecheck ? Colors.red.shade100 : const Color(0xFFE2E8F0),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16.r),
        child: InkWell(
          borderRadius: BorderRadius.circular(16.r),
          onTap: () => _showDetailsSheet(item),
          child: Padding(
            padding: EdgeInsets.all(14.r),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _avatar(item.name, style.color),
                    SizedBox(width: 10.w),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            item.name.isEmpty ? item.clientId : item.name,
                            style: TextStyle(
                              fontSize: 14.5.sp,
                              fontWeight: FontWeight.w800,
                              color: const Color(0xFF0F172A),
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          SizedBox(height: 2.h),
                          Text(
                            item.clientId,
                            style: TextStyle(
                              fontSize: 11.sp,
                              fontWeight: FontWeight.w700,
                              color: const Color(0xFF0C5F34),
                              letterSpacing: 0.2,
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(width: 6.w),
                    _badge(style.label, style.color, style.bg),
                  ],
                ),
                SizedBox(height: 10.h),
                Wrap(
                  spacing: 14.w,
                  runSpacing: 6.h,
                  children: [
                    if (item.mobile.isNotEmpty && item.mobile != '—')
                      _metaChip(Icons.call_outlined, item.mobile),
                    if (item.center.isNotEmpty && item.center != '—')
                      _metaChip(Icons.apartment_outlined, item.center),
                    if (item.branch.isNotEmpty && item.branch != '—')
                      _metaChip(Icons.account_tree_outlined, item.branch),
                  ],
                ),
                if (isDraft) ...[
                  SizedBox(height: 10.h),
                  _footerRow(
                    left:
                        'Started by ${item.startedBy.isEmpty ? '—' : item.startedBy}',
                    right: 'Draft • ${item.draftDate}',
                  ),
                  SizedBox(height: 6.h),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () => _deleteDraft(item.clientId),
                      icon: Icon(
                        Icons.delete_outline,
                        size: 16.sp,
                        color: Colors.red.shade600,
                      ),
                      label: Text(
                        'Delete Draft',
                        style: TextStyle(
                          fontSize: 11.sp,
                          color: Colors.red.shade600,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      style: TextButton.styleFrom(
                        padding: EdgeInsets.symmetric(horizontal: 6.w),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                  ),
                ] else if (item.status == 'Approval Queue') ...[
                  SizedBox(height: 10.h),
                  _footerRow(
                    left:
                        'Enrolled by ${item.enrolledBy.isEmpty ? '—' : item.enrolledBy}',
                    right:
                        'Waiting ${item.waitingDays.isEmpty ? '—' : item.waitingDays}',
                    rightAccent: true,
                  ),
                ] else if (isMoneyStage) ...[
                  SizedBox(height: 10.h),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (item.loanNo.isNotEmpty && item.loanNo != '—')
                              Text(
                                'Loan ${item.loanNo}',
                                style: TextStyle(
                                  fontSize: 11.sp,
                                  fontWeight: FontWeight.w700,
                                  color: const Color(0xFF0C5F34),
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            Text(
                              item.status == 'Disbursed'
                                  ? 'Disbursed ${item.enrolledOn}'
                                  : 'Enrolled ${item.enrolledOn}',
                              style: TextStyle(
                                fontSize: 10.5.sp,
                                color: const Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (item.amount.isNotEmpty && item.amount != '—')
                        Text(
                          '₹${_formatAmount(item.amount)}',
                          style: TextStyle(
                            fontSize: 17.sp,
                            fontWeight: FontWeight.w800,
                            color: const Color(0xFF0C5F34),
                          ),
                        ),
                    ],
                  ),
                ] else if (isRecheck) ...[
                  SizedBox(height: 10.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(10.r),
                    decoration: BoxDecoration(
                      color: Colors.red.shade50,
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    child: Text(
                      item.remarks.isEmpty
                          ? 'No remarks provided.'
                          : item.remarks,
                      style: TextStyle(
                        fontSize: 11.5.sp,
                        color: Colors.red.shade900,
                        height: 1.3,
                      ),
                    ),
                  ),
                  SizedBox(height: 10.h),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          'Requested by ${item.requestedBy.isEmpty ? '—' : item.requestedBy}',
                          style: TextStyle(
                            fontSize: 10.5.sp,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ),
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.orange.shade800,
                          elevation: 0,
                          padding: EdgeInsets.symmetric(
                            horizontal: 12.w,
                            vertical: 8.h,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8.r),
                          ),
                        ),
                        onPressed: () => _openRecheckAction(item),
                        child: Text(
                          item.recheckAction,
                          style: TextStyle(
                            fontSize: 10.5.sp,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ] else ...[
                  SizedBox(height: 8.h),
                  Text(
                    'Enrolled ${item.enrolledOn}',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      color: const Color(0xFF729A7D),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _avatar(String name, Color color) {
    final trimmed = name.trim();
    final initials = trimmed.isEmpty
        ? '?'
        : trimmed
              .split(RegExp(r'\s+'))
              .take(2)
              .map((w) => w[0])
              .join()
              .toUpperCase();
    return Container(
      width: 40.w,
      height: 40.w,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        shape: BoxShape.circle,
      ),
      child: Text(
        initials,
        style: TextStyle(
          fontSize: 13.sp,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
  }

  Widget _badge(String label, Color color, Color bg) => Container(
    padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
    constraints: BoxConstraints(maxWidth: 110.w),
    decoration: BoxDecoration(
      color: bg,
      borderRadius: BorderRadius.circular(6.r),
    ),
    child: Text(
      label,
      style: TextStyle(
        color: color,
        fontSize: 9.sp,
        fontWeight: FontWeight.bold,
      ),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      textAlign: TextAlign.right,
    ),
  );

  Widget _metaChip(IconData icon, String text) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 13.sp, color: const Color(0xFF8FA88B)),
      SizedBox(width: 4.w),
      ConstrainedBox(
        constraints: BoxConstraints(maxWidth: 150.w),
        child: Text(
          text,
          style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF475569)),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ],
  );

  Widget _footerRow({
    required String left,
    required String right,
    bool rightAccent = false,
  }) => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: [
      Expanded(
        child: Text(
          left,
          style: TextStyle(fontSize: 10.5.sp, color: const Color(0xFF729A7D)),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      SizedBox(width: 8.w),
      Container(
        padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 2.h),
        decoration: BoxDecoration(
          color: rightAccent ? Colors.amber.shade50 : const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(6.r),
        ),
        child: Text(
          right,
          style: TextStyle(
            fontSize: 10.sp,
            fontWeight: FontWeight.bold,
            color: rightAccent
                ? Colors.orange.shade900
                : const Color(0xFF475569),
          ),
        ),
      ),
    ],
  );

  Widget _buildEmptyState() {
    return Container(
      padding: EdgeInsets.symmetric(vertical: 40.h),
      alignment: Alignment.center,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.find_in_page_outlined,
            size: 48.sp,
            color: const Color(0xFF8FA88B),
          ),
          SizedBox(height: 12.h),
          Text(
            'No clients found',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF0F172A),
            ),
          ),
          SizedBox(height: 4.h),
          Text(
            _selectedStatus == 'Approved'
                ? 'No approved clients yet'
                : 'No records match the selected filters.',
            style: TextStyle(fontSize: 11.sp, color: const Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  void _showDetailsSheet(LoanTrackerItem item) {
    final style = _styleFor(item);
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.65,
          maxChildSize: 0.92,
          minChildSize: 0.45,
          expand: false,
          builder: (context, scrollController) {
            return SingleChildScrollView(
              controller: scrollController,
              padding: EdgeInsets.all(20.r),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Center(
                    child: Container(
                      width: 40.w,
                      height: 4.h,
                      decoration: BoxDecoration(
                        color: const Color(0xFFCBD5E1),
                        borderRadius: BorderRadius.circular(2.r),
                      ),
                    ),
                  ),
                  SizedBox(height: 18.h),
                  Row(
                    children: [
                      _avatar(item.name, style.color),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.name.isEmpty ? item.clientId : item.name,
                              style: TextStyle(
                                fontSize: 16.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF0F172A),
                              ),
                            ),
                            Text(
                              item.clientId,
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF0C5F34),
                              ),
                            ),
                          ],
                        ),
                      ),
                      _badge(style.label, style.color, style.bg),
                    ],
                  ),
                  SizedBox(height: 16.h),

                  // Detail summary card
                  Container(
                    padding: EdgeInsets.all(12.r),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(12.r),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (item.mobile.isNotEmpty && item.mobile != '—')
                          Padding(
                            padding: EdgeInsets.only(bottom: 4.h),
                            child: _metaChip(Icons.call_outlined, item.mobile),
                          ),
                        if (item.center.isNotEmpty && item.center != '—')
                          Padding(
                            padding: EdgeInsets.only(bottom: 4.h),
                            child: _metaChip(
                              Icons.apartment_outlined,
                              '${item.center}${item.branch.isNotEmpty && item.branch != '—' ? '  •  ${item.branch}' : ''}',
                            ),
                          ),
                        if (item.loanNo.isNotEmpty && item.loanNo != '—') ...[
                          const SizedBox(height: 8),
                          const Divider(height: 1),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Loan #: ${item.loanNo}',
                                style: TextStyle(
                                  fontSize: 12.sp,
                                  fontWeight: FontWeight.bold,
                                  color: const Color(0xFF0C5F34),
                                ),
                              ),
                              if (item.amount.isNotEmpty && item.amount != '—')
                                Text(
                                  'Amount: ₹${_formatAmount(item.amount)}',
                                  style: TextStyle(
                                    fontSize: 14.sp,
                                    fontWeight: FontWeight.bold,
                                    color: const Color(0xFF0C5F34),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                  SizedBox(height: 20.h),

                  // Approval trail section
                  Text(
                    'APPROVAL TRAIL',
                    style: TextStyle(
                      fontSize: 10.sp,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF4F765E),
                      letterSpacing: 0.5,
                    ),
                  ),
                  SizedBox(height: 12.h),
                  _buildApprovalTrail(item),
                  SizedBox(height: 20.h),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// Builds the approval trail from the item's approvalHistory list, mirroring
  /// the web app's `buildCycleTrail` logic. Each history entry becomes a
  /// completed node; the current pending stage is appended as the last node.
  Widget _buildApprovalTrail(LoanTrackerItem item) {
    // Derive trail nodes
    final nodes = _buildTrailNodes(item);

    if (nodes.isEmpty) {
      return Text(
        'No approval history yet.',
        style: TextStyle(fontSize: 12.sp, color: const Color(0xFF94A3B8)),
      );
    }

    return Column(
      children: List.generate(nodes.length, (index) {
        final node = nodes[index];
        final isLast = index == nodes.length - 1;
        final isDone = node['done'] as bool;
        final isPending = !isDone;

        final Color circleColor;
        final Color textColor;
        final IconData icon;

        if (isPending) {
          circleColor = Colors.orange.shade700;
          textColor = Colors.orange.shade800;
          icon = Icons.hourglass_top_rounded;
        } else {
          circleColor = const Color(0xFF0C5F34);
          textColor = const Color(0xFF0C5F34);
          icon = Icons.check_circle_rounded;
        }

        final String label = node['label'] as String;
        final String? by = node['by'] as String?;
        final String? at = node['at'] as String?;
        final String? remarks = node['remarks'] as String?;

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Connector column
            Column(
              children: [
                Container(
                  width: 22.r,
                  height: 22.r,
                  decoration: BoxDecoration(
                    color: isPending ? Colors.white : circleColor,
                    shape: BoxShape.circle,
                    border: Border.all(color: circleColor, width: 2.r),
                  ),
                  child: Center(
                    child: Icon(
                      icon,
                      color: isPending ? circleColor : Colors.white,
                      size: 11.sp,
                    ),
                  ),
                ),
                if (!isLast)
                  Container(
                    width: 2.w,
                    height: 36.h,
                    color: isDone
                        ? const Color(0xFF0C5F34)
                        : const Color(0xFFE2E8F0),
                  ),
              ],
            ),
            SizedBox(width: 12.w),
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(bottom: isLast ? 0 : 8.h),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w700,
                        color: textColor,
                      ),
                    ),
                    if (by != null && by.isNotEmpty) ...[
                      SizedBox(height: 2.h),
                      Text(
                        by,
                        style: TextStyle(
                          fontSize: 11.sp,
                          color: const Color(0xFF475569),
                        ),
                      ),
                    ],
                    if (at != null && at.isNotEmpty) ...[
                      SizedBox(height: 1.h),
                      Text(
                        at,
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF94A3B8),
                        ),
                      ),
                    ],
                    if (remarks != null && remarks.isNotEmpty) ...[
                      SizedBox(height: 4.h),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 4.h,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFFF7ED),
                          borderRadius: BorderRadius.circular(6.r),
                        ),
                        child: Text(
                          '"$remarks"',
                          style: TextStyle(
                            fontSize: 10.sp,
                            color: Colors.orange.shade900,
                            fontStyle: FontStyle.italic,
                          ),
                        ),
                      ),
                    ],
                    SizedBox(height: isLast ? 0 : 4.h),
                  ],
                ),
              ),
            ),
          ],
        );
      }),
    );
  }

  /// Mirrors the web app's `buildCycleTrail`. Returns a list of node maps with
  /// keys: label (String), by (String?), at (String?), remarks (String?), done (bool).
  List<Map<String, dynamic>> _buildTrailNodes(LoanTrackerItem item) {
    // ── Completed nodes from history ─────────────────────────────────────────
    final nodes = <Map<String, dynamic>>[
      {
        'label': 'FDO — Enrolled',
        'by': item.enrolledBy.isEmpty ? null : item.enrolledBy,
        'at': item.enrolledOn,
        'remarks': null,
        'done': true,
      },
    ];

    // Action → human label mapping (mirrors ACTION_META on the web)
    String actionToLabel(String action) {
      if (action.contains('BM_APPROVED') || action == 'LEVEL_1_APPROVED') {
        return 'BM — Approved';
      }
      if (action.contains('AM_APPROVED') || action == 'LEVEL_2_APPROVED') {
        return 'AM — Approved';
      }
      if (action.contains('QC_APPROVED') ||
          action.contains('QC_VERIFIED') ||
          action == 'LEVEL_3_APPROVED') {
        return 'QC — Verified';
      }
      if (action.contains('FINAL_APPROVED') || action == 'LEVEL_4_APPROVED') {
        return 'Admin — Approved';
      }
      if (action.contains('BM') && action.contains('RETAKE')) {
        return 'BM — Recheck';
      }
      if (action.contains('AM') && action.contains('RETAKE')) {
        return 'AM — Recheck';
      }
      if (action.contains('QC') && action.contains('RETAKE')) {
        return 'QC — Recheck';
      }
      if (action.contains('FINAL') && action.contains('RETAKE')) {
        return 'Admin — Recheck';
      }
      if (action.contains('BM') && action.contains('REJECT')) {
        return 'BM — Rejected';
      }
      if (action.contains('AM') && action.contains('REJECT')) {
        return 'AM — Rejected';
      }
      if (action.contains('QC') && action.contains('REJECT')) {
        return 'QC — Rejected';
      }
      if (action.contains('FINAL') && action.contains('REJECT')) {
        return 'Admin — Rejected';
      }
      if (action.contains('LEVEL_1')) {
        return 'BM — Review';
      }
      if (action.contains('LEVEL_2')) {
        return 'AM — Review';
      }
      if (action.contains('LEVEL_3')) {
        return 'QC — Review';
      }
      if (action.contains('LEVEL_4')) {
        return 'Admin — Review';
      }
      return action
          .replaceAll('_', ' ')
          .split(' ')
          .map(
            (w) => w.isEmpty
                ? w
                : '${w[0].toUpperCase()}${w.substring(1).toLowerCase()}',
          )
          .join(' ');
    }

    // Collapse duplicate consecutive labels (same stage, multiple docs) just
    // like the web app does.
    String? lastLabel;
    for (final h in item.approvalHistory) {
      final action = '${h['action'] ?? ''}';
      if (action == 'SUBMITTED') {
        continue;
      } // skip the initial submit event
      final label = actionToLabel(action);
      if (label == lastLabel) {
        continue;
      } // collapse duplicates
      lastLabel = label;

      final performer = h['performedBy'] is Map
          ? Map<String, dynamic>.from(h['performedBy'] as Map)
          : <String, dynamic>{};
      final byName =
          '${performer['firstName'] ?? ''} ${performer['lastName'] ?? ''}'
              .trim();

      nodes.add({
        'label': label,
        'by': byName.isEmpty ? null : byName,
        'at': _displayDate(h['createdAt']),
        'remarks': h['remarks']?.toString().isNotEmpty == true
            ? h['remarks'].toString()
            : null,
        'done': true,
      });
    }

    // ── Pending node (what the client is currently waiting on) ────────────────
    final pendingLabel = _pendingStageLabel(item.status, item.queueStage);
    if (pendingLabel != null) {
      // Don't duplicate if the last done node already shows this stage
      final lastDone = nodes.isNotEmpty ? nodes.last['label'] as String : '';
      if (!lastDone.startsWith(pendingLabel.split(' ')[0])) {
        nodes.add({
          'label': pendingLabel,
          'by': null,
          'at': null,
          'remarks': null,
          'done': false,
        });
      }
    }

    return nodes;
  }

  /// Returns the human-readable "waiting on" label for the trailing pending
  /// node, or null when the loan is fully resolved (approved / rejected).
  String? _pendingStageLabel(String status, String queueStage) {
    if (status == 'Approved' || status == 'Disbursed') return null;
    if (status == 'Draft') return 'Pending FDO Submission';
    if (status == 'Recheck') return 'Pending FDO — Re-upload & Resubmit';
    if (status == 'Pre Disbursement') return 'Pending Disbursement';
    // Approval Queue — use the current queue stage
    switch (queueStage) {
      case 'AM Approval':
        return 'Pending AM Approval';
      case 'QC Approval':
        return 'Pending QC Verification';
      case 'Admin Approval':
        return 'Pending Admin Approval';
      default:
        return 'Pending BM Approval';
    }
  }
}

class _DateField extends StatelessWidget {
  const _DateField({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final DateTime? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 12.h),
        decoration: BoxDecoration(
          color: const Color(0xFFF7FBF7),
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: const Color(0xFFE8F0EA)),
        ),
        child: Row(
          children: [
            Icon(
              Icons.calendar_today_outlined,
              size: 16.sp,
              color: const Color(0xFF729A7D),
            ),
            SizedBox(width: 8.w),
            Expanded(
              child: Text(
                value == null
                    ? 'dd-mm-yyyy'
                    : '${value!.day.toString().padLeft(2, '0')}-${value!.month.toString().padLeft(2, '0')}-${value!.year}',
                style: TextStyle(
                  fontSize: 12.sp,
                  color: const Color(0xFF8FA88B),
                ),
              ),
            ),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF3F6A54),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
