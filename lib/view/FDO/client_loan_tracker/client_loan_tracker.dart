import 'dart:async';

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

/// One row of `/api/loans/renewal-tracker` — a renewal loan application.
class RenewalTrackerItem {
  RenewalTrackerItem({
    required this.id,
    required this.loanNumber,
    required this.amount,
    required this.renewalApprovalStatus,
    required this.disbursementStatus,
    required this.clientDisplayId,
    required this.clientName,
    this.disbursedAt,
    this.createdAt,
    this.mobileNumber,
    this.centerName,
    this.branchName,
    this.productName,
    this.fdoName,
    this.recheck,
    this.rejection,
  });

  final String id;
  final String loanNumber;
  final num amount;
  final String renewalApprovalStatus;
  final String disbursementStatus;
  final String clientDisplayId;
  final String clientName;
  final dynamic disbursedAt;
  final dynamic createdAt;
  final String? mobileNumber;
  final String? centerName;
  final String? branchName;
  final String? productName;
  final String? fdoName;

  /// `{documentOnly, by, remarks}` while the renewal is in recheck.
  final Map<String, dynamic>? recheck;

  /// `{stageName, by, at, remarks}` when the renewal was rejected.
  final Map<String, dynamic>? rejection;

  factory RenewalTrackerItem.fromJson(Map<String, dynamic> j) {
    Map<String, dynamic>? asMap(dynamic v) =>
        v is Map ? Map<String, dynamic>.from(v) : null;
    String? str(dynamic v) {
      final t = v?.toString();
      return t == null || t.isEmpty || t == 'null' ? null : t;
    }

    return RenewalTrackerItem(
      id: '${j['id'] ?? ''}',
      loanNumber: '${j['loanNumber'] ?? '—'}',
      amount: j['amount'] is num
          ? j['amount'] as num
          : num.tryParse('${j['amount']}') ?? 0,
      renewalApprovalStatus: '${j['renewalApprovalStatus'] ?? ''}',
      disbursementStatus: '${j['disbursementStatus'] ?? ''}',
      clientDisplayId: '${j['clientDisplayId'] ?? '—'}',
      clientName: '${j['clientName'] ?? ''}',
      disbursedAt: j['disbursedAt'],
      createdAt: j['createdAt'],
      mobileNumber: str(j['mobileNumber']),
      centerName: str(j['centerName']),
      branchName: str(j['branchName']),
      productName: str(j['productName']),
      fdoName: str(j['fdoName']),
      recheck: asMap(j['recheck']),
      rejection: asMap(j['rejection']),
    );
  }
}

class _ClientLoanTrackerState extends State<ClientLoanTracker> {
  static const _pageSize = 20;

  /// Top tabs, as on the web: All, Draft, New Loan and Renewal Loan. Label → the server `tab` value, which is also its `tabCounts` key.
  static const _topTabKeys = {
    'All': 'all',
    'Draft': 'pending',
    'New Loan': 'new_loan',
    'Renewal Loan': 'renewal',
  };

  /// New Loan chips that are their own member list on the server; every other
  /// chip is an approval stage (the server's `approvalFilter`).
  static const _listChipTabs = {
    'recheck',
    'pre_disbursement',
    'disbursed',
    'rejected',
  };

  /// What a row is labelled when it comes from a specific server tab.
  static const _rowStatusByTab = {
    'pending': 'Draft',
    'yet_to_approve': 'Approval Queue',
    'pre_disbursement': 'Pre Disbursement',
    'disbursed': 'Disbursed',
    'recheck': 'Recheck',
    'rejected': 'Rejected',
  };

  List<LoanTrackerItem> _items = [];
  final ApiClient _apiClient = ApiClient();
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;

  bool _isLoading = false;
  bool _isLoadingMore = false;
  int _page = 1;
  int _totalPages = 1;
  int _total = 0;
  int _requestId = 0; // discards responses from superseded requests
  Map<String, int> _tabCounts = {};

  // Approval workflow configured on the server (in order): each entry has
  // roleSlug, stageName, pendingStatus and retakeStatus. Empty until the first
  // response arrives, or when no custom workflow is configured.
  List<Map<String, dynamic>> _workflowStages = [];
  Map<String, int> _stageCounts = {}; // 'stage:<roleSlug>' / 'admin' → waiting
  bool _isFdo = false;
  // False until the first response says which stages are configured, so the
  // chip row doesn't flash the default BM / AM / QC names first.
  bool _stagesLoaded = false;

  // Renewal Loan tab: its own list, stage chip, stages and counts (the
  // renewal tracker is a separate API).
  List<RenewalTrackerItem> _renewalItems = [];
  String _renewalChip = 'all';
  List<Map<String, dynamic>> _renewalStages = []; // {roleSlug, stageName}
  Map<String, int> _renewalCounts = {}; // 'all', 'stage:<slug>', 'admin', ...
  bool _renewalStagesLoaded = false;

  bool get _isRenewalTab => _selectedStatus == 'Renewal Loan';

  // Filter options (loaded once): branches the user may filter by, and the
  // centers they can see. Each is a map with at least `id` and `name`.
  List<Map<String, dynamic>> _branches = [];
  List<Map<String, dynamic>> _centers = [];

  String _selectedStatus = 'All';
  String _selectedBranchId = ''; // '' = all branches
  String _selectedCenterId = ''; // '' = all centers
  String _newLoanChip = 'all'; // New Loan chip: a stage key or a list tab
  String _searchQuery = '';
  DateTime? _fromDate;
  DateTime? _toDate;

  /// The server tab behind the current top tab + New Loan chip.
  String get _activeTabKey {
    if (_selectedStatus != 'New Loan') return _topTabKeys[_selectedStatus] ?? 'all';
    if (_newLoanChip == 'all') return 'new_loan';
    if (_listChipTabs.contains(_newLoanChip)) return _newLoanChip;
    return 'yet_to_approve';
  }

  String get _listTitle {
    final hasChips = _selectedStatus == 'New Loan' || _isRenewalTab;
    if (!hasChips || _activeChipKey == 'all') return _selectedStatus;
    for (final chip in _queueChips) {
      if (chip.key == _activeChipKey) return '$_selectedStatus • ${chip.label}';
    }
    return _selectedStatus;
  }

  bool get _hasActiveFilters =>
      _fromDate != null ||
      _toDate != null ||
      _searchQuery.isNotEmpty ||
      _selectedBranchId.isNotEmpty ||
      _selectedCenterId.isNotEmpty;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _init();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _scrollController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _init() async {
    await _loadFilterOptions();
    if (!mounted) return;
    await _loadTracker();
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    if (pos.pixels >= pos.maxScrollExtent - 300) {
      _loadTracker(loadMore: true);
    }
  }

  List<Map<String, dynamic>> _asMapList(dynamic raw) {
    final list = raw is Map && raw['centers'] is List ? raw['centers'] : raw;
    if (list is! List) return [];
    return list
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
  }

  /// Loads the branch and center options the same way the web tracker does:
  /// an Area Manager's list comes from their assigned branches, everyone else
  /// from the permitted-branches list. The server clamps whatever branch or
  /// center is requested to what the caller is allowed to see.
  Future<void> _loadFilterOptions() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final role = prefs.getString('role') ?? '';
      final rbacRoleName = prefs.getString('rbacRoleName') ?? '';
      final userId = prefs.getString('userId') ?? '';
      final isAM =
          RoleScope.isAreaManager(role) || RoleScope.isAreaManager(rbacRoleName);
      // Only an FDO can fix and resubmit a recheck, as on the web.
      _isFdo = RoleScope.resolve(role, rbacRoleName) == AppRole.fdo;

      final branchFuture = isAM
          ? _apiClient.get('${Api.baseUrl}/api/area-manager-branches?userId=$userId')
          : _apiClient.get('${Api.branchesUrl}?permitted=hoWide');
      final centerFuture = _apiClient.get('${Api.centersUrl}?includeInactive=false');
      final results = await Future.wait([branchFuture, centerFuture]);

      final branchBody = results[0].body;
      if (branchBody is Map && branchBody['success'] == true) {
        var list = _asMapList(branchBody['data']);
        if (isAM) {
          // Rows look like { branch: { id, name, code } }.
          list = list
              .map((e) => e['branch'])
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        }
        _branches = list;
      }

      final centerBody = results[1].body;
      if (centerBody is Map && centerBody['success'] == true) {
        _centers = _asMapList(centerBody['data']);
      }

      // A user with exactly one branch has nothing to choose — pre-select it.
      if (_branches.length == 1) {
        _selectedBranchId = '${_branches.first['id']}';
      }
      if (mounted) setState(() {});
    } catch (_) {
      // Filters are optional — the list still loads without them.
    }
  }

  /// Centers shown in the center dropdown: only those of the chosen branch.
  List<Map<String, dynamic>> get _visibleCenters => _selectedBranchId.isEmpty
      ? _centers
      : _centers.where((c) => '${c['branchId']}' == _selectedBranchId).toList();

  String _ymd(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  /// Renewal Loan tab: one page of `/api/loans/renewal-tracker` for the current
  /// stage chip and filters. Mirrors [_loadTracker]'s paging.
  Future<void> _loadRenewals({bool loadMore = false}) async {
    if (loadMore && (_isLoading || _isLoadingMore || _page >= _totalPages)) {
      return;
    }
    final requestId = ++_requestId;
    final nextPage = loadMore ? _page + 1 : 1;
    setState(() {
      if (loadMore) {
        _isLoadingMore = true;
      } else {
        _isLoading = true;
        _isLoadingMore = false;
        _renewalItems = [];
      }
    });

    try {
      final params = <String, String>{
        'stage': _renewalChip,
        'page': '$nextPage',
        'pageSize': '$_pageSize',
      };
      if (_searchQuery.trim().isNotEmpty) params['search'] = _searchQuery.trim();
      if (_fromDate != null) params['dateFrom'] = _ymd(_fromDate!);
      if (_toDate != null) params['dateTo'] = _ymd(_toDate!);
      if (_selectedBranchId.isNotEmpty) params['branchId'] = _selectedBranchId;
      if (_selectedCenterId.isNotEmpty) params['centerId'] = _selectedCenterId;

      final url = Uri.parse('${Api.baseUrl}/api/loans/renewal-tracker')
          .replace(queryParameters: params)
          .toString();
      final response = await _apiClient.get(url);
      if (!mounted) return;

      final body = response.body;
      final data = body is Map && body['success'] == true && body['data'] is Map
          ? Map<String, dynamic>.from(body['data'] as Map)
          : null;

      // The configured stages don't depend on the chip or filters — keep them
      // even from a superseded response (same reason as the member tracker).
      final stages = data?['stages'];
      if (stages is List) {
        setState(() {
          _renewalStages = stages
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _renewalStagesLoaded = true;
        });
      }
      if (requestId != _requestId) return;

      if (data == null || data['items'] is! List) {
        if (!loadMore) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Unable to load renewal loans.')),
          );
        }
        return;
      }

      final loaded = (data['items'] as List)
          .whereType<Map>()
          .map((e) => RenewalTrackerItem.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      final counts = data['stageCounts'];
      final pagination = data['pagination'];
      setState(() {
        _renewalItems = loadMore ? [..._renewalItems, ...loaded] : loaded;
        if (counts is Map) {
          _renewalCounts = {
            for (final e in counts.entries)
              '${e.key}': (e.value is num) ? (e.value as num).toInt() : 0,
          };
        }
        if (pagination is Map) {
          _page = (pagination['page'] as num?)?.toInt() ?? nextPage;
          _totalPages = (pagination['totalPages'] as num?)?.toInt() ?? 1;
          _total = (pagination['total'] as num?)?.toInt() ?? loaded.length;
        }
      });
    } catch (_) {
      if (mounted && requestId == _requestId && !loadMore) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Unable to load renewal loans.')),
        );
      }
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _isLoading = false;
          _isLoadingMore = false;
          _renewalStagesLoaded = true;
        });
      }
    }
  }

  /// Fetches one page for the current tab and filters from the server.
  /// [loadMore] appends the next page; otherwise the list restarts at page 1.
  Future<void> _loadTracker({bool loadMore = false}) async {
    if (_isRenewalTab) return _loadRenewals(loadMore: loadMore);
    if (loadMore && (_isLoading || _isLoadingMore || _page >= _totalPages)) {
      return;
    }
    final requestId = ++_requestId;
    final nextPage = loadMore ? _page + 1 : 1;
    setState(() {
      if (loadMore) {
        _isLoadingMore = true;
      } else {
        _isLoading = true;
        _isLoadingMore = false;
        _items = [];
      }
    });

    try {
      final tabKey = _activeTabKey;
      final params = <String, String>{
        'tab': tabKey,
        'page': '$nextPage',
        'pageSize': '$_pageSize',
      };
      if (tabKey == 'yet_to_approve') {
        params['approvalFilter'] = _newLoanChip;
      }
      if (_searchQuery.trim().isNotEmpty) params['search'] = _searchQuery.trim();
      if (_fromDate != null) params['dateFrom'] = _ymd(_fromDate!);
      if (_toDate != null) params['dateTo'] = _ymd(_toDate!);
      if (_selectedBranchId.isNotEmpty) params['branchId'] = _selectedBranchId;
      if (_selectedCenterId.isNotEmpty) params['centerId'] = _selectedCenterId;

      final url = Uri.parse(Api.clientLoanTrackerUrl)
          .replace(queryParameters: params)
          .toString();
      final response = await _apiClient.get(url);
      if (!mounted) return;

      final body = response.body;
      final data = body is Map && body['success'] == true && body['data'] is Map
          ? Map<String, dynamic>.from(body['data'] as Map)
          : null;

      // The configured workflow stages don't depend on the tab or filters, so
      // keep them even if a newer request has superseded this one — otherwise
      // a quick tab switch right after opening would discard the first
      // response and leave the stage chips on their defaults.
      final stages = data?['workflowStages'];
      if (stages is List) {
        setState(() {
          _workflowStages = stages
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
          _stagesLoaded = true;
        });
      }
      if (requestId != _requestId) return;

      if (data == null || data['clients'] is! List) {
        if (!loadMore) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Unable to load the client loan tracker.'),
            ),
          );
        }
        return;
      }

      final stageCounts = data['stageCounts'];
      if (stageCounts is Map) {
        _stageCounts = {
          for (final e in stageCounts.entries)
            '${e.key}': (e.value is num) ? (e.value as num).toInt() : 0,
        };
      }

      final loaded = (data['clients'] as List).whereType<Map>().map((client) {
        final item = _trackerItemFromApi(Map<String, dynamic>.from(client));
        // Inside a specific tab every row belongs to that tab by definition
        // (the server already filtered), so label it accordingly — e.g. the
        // Recheck tab also holds approved clients with a flagged document.
        final forced = _rowStatusByTab[tabKey];
        if (forced != null) item.status = forced;
        return item;
      }).toList();

      final counts = data['tabCounts'];
      final pagination = data['pagination'];
      setState(() {
        _items = loadMore ? [..._items, ...loaded] : loaded;
        if (counts is Map) {
          _tabCounts = {
            for (final e in counts.entries)
              '${e.key}': (e.value is num) ? (e.value as num).toInt() : 0,
          };
        }
        if (pagination is Map) {
          _page = (pagination['page'] as num?)?.toInt() ?? nextPage;
          _totalPages = (pagination['totalPages'] as num?)?.toInt() ?? 1;
          _total = (pagination['total'] as num?)?.toInt() ?? loaded.length;
        }
      });
    } catch (_) {
      if (mounted && requestId == _requestId && !loadMore) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Unable to load the client loan tracker.'),
          ),
        );
      }
    } finally {
      if (mounted && requestId == _requestId) {
        setState(() {
          _isLoading = false;
          _isLoadingMore = false;
          // Even if the call failed, stop waiting and use the default chips.
          _stagesLoaded = true;
        });
      }
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
      recheckAction: 'Resolve',
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
    if (approvalStatus == 'REJECTED') {
      return 'Rejected';
    }
    if (approvalStatus.contains('RETAKE')) {
      return 'Recheck';
    }
    return 'Approval Queue';
  }

  String _approvalLabel(String status) {
    // A configured workflow names its own stages — use those when the status
    // belongs to one of them.
    for (final st in _workflowStages) {
      if (status == '${st['pendingStatus']}' ||
          status == '${st['retakeStatus']}') {
        return '${st['stageName']}';
      }
    }
    if (status == 'SUBMITTED' && _workflowStages.isNotEmpty) {
      return '${_workflowStages.first['stageName']}';
    }
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

    if (date == null || !mounted) {
      return;
    }

    setState(() {
      if (isFrom) {
        _fromDate = date;
      } else {
        _toDate = date;
      }
    });
    _loadTracker();
  }

  void _onSearchChanged(String value) {
    _searchQuery = value;
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) _loadTracker();
    });
    setState(() {});
  }

  void _selectStatus(String status) {
    if (_selectedStatus == status) return;
    setState(() {
      _selectedStatus = status;
      _newLoanChip = 'all';
      _renewalChip = 'all';
    });
    _loadTracker();
  }

  void _selectChip(String stage) {
    if (_activeChipKey == stage) return;
    setState(() {
      if (_isRenewalTab) {
        _renewalChip = stage;
      } else {
        _newLoanChip = stage;
      }
    });
    _loadTracker();
  }

  void _selectBranch(String branchId) {
    setState(() {
      _selectedBranchId = branchId;
      _selectedCenterId = ''; // a center belongs to one branch
    });
    _loadTracker();
  }

  void _selectCenter(String centerId) {
    setState(() => _selectedCenterId = centerId);
    _loadTracker();
  }

  /// Resets every filter and reloads. A user with a single branch keeps it
  /// selected, since there is nothing else for them to pick.
  Future<void> _refresh() async {
    _searchDebounce?.cancel();
    _searchController.clear();
    setState(() {
      _searchQuery = '';
      _selectedStatus = 'All';
      _selectedBranchId =
          _branches.length == 1 ? '${_branches.first['id']}' : '';
      _selectedCenterId = '';
      _newLoanChip = 'all';
      _renewalChip = 'all';
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
                final before = _items.length;
                _items.removeWhere((item) => item.clientId == clientId);
                if (_items.length < before) {
                  _total = (_total - 1).clamp(0, _total);
                  for (final key in const ['pending', 'all']) {
                    final c = _tabCounts[key];
                    if (c != null && c > 0) _tabCounts[key] = c - 1;
                  }
                }
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
                  controller: _scrollController,
                  padding: EdgeInsets.symmetric(horizontal: 16.w),
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  children: [
                    SizedBox(height: 16.h),

                    // Horizontal Status Row with counts
                    _buildStatusFilterRow(),

                    // New Loan's sub-tabs sit directly under the top tabs
                    if (_selectedStatus == 'New Loan' || _isRenewalTab) ...[
                      SizedBox(height: 12.h),
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

                    SizedBox(height: 16.h),

                    // Filter options card
                    _buildFiltersCard(),


                    SizedBox(height: 18.h),

                    // List Section Title
                    Row(
                      children: [
                        Expanded(
                          child: Row(
                            children: [
                              Icon(
                                Icons.list_alt_rounded,
                                size: 16.sp,
                                color: const Color(0xFF0C5F34),
                              ),
                              SizedBox(width: 6.w),
                              Expanded(
                                child: Text(
                                  '$_listTitle ($_total records)',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(
                                    fontSize: 14.sp,
                                    fontWeight: FontWeight.bold,
                                    color: const Color(0xFF0F172A),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_hasActiveFilters) ...[
                          SizedBox(width: 8.w),
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
                      ],
                    ),
                    SizedBox(height: 12.h),

                    // Dynamic cards listing
                    if (_isLoading && (_isRenewalTab ? _renewalItems : _items).isEmpty)
                      const Padding(
                        padding: EdgeInsets.symmetric(vertical: 48),
                        child: Center(
                          child: CircularProgressIndicator(
                            color: Color(0xFF0C5F34),
                          ),
                        ),
                      )
                    else if ((_isRenewalTab ? _renewalItems : _items).isEmpty)
                      _buildEmptyState()
                    else ...[
                      if (_isRenewalTab)
                        ..._renewalItems.map(_buildRenewalCard)
                      else
                        ..._items.map(_buildTrackerCard),
                      if (_isLoadingMore)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 16),
                          child: Center(
                            child: CircularProgressIndicator(
                              color: Color(0xFF0C5F34),
                            ),
                          ),
                        ),
                    ],

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
    'New Loan': Icons.person_add_alt_1_rounded,
    'Renewal Loan': Icons.autorenew_rounded,
  };

  Widget _buildStatusFilterRow() {
    // Counts come from the server (they cover every page, not just the rows
    // loaded so far, and don't change when you switch tabs).
    final statusCounts = {
      for (final entry in _topTabKeys.entries)
        entry.key: entry.value == 'renewal'
            ? (_renewalCounts['all'] ?? 0)
            : (_tabCounts[entry.value] ?? 0),
    };

    final statusColors = {
      'All': const Color(0xFF0C5F34),
      'Draft': Colors.grey.shade700,
      'New Loan': Colors.orange.shade700,
      'Renewal Loan': Colors.cyan.shade700,
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
            onTap: () => _selectStatus(status),
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

  /// New Loan chips, in the web's order: All Stages → each approval stage
  /// (the server's configured workflow, or BM / AM / QC / Admin when none is
  /// configured) → Admin → Recheck → Pre-Disbursement → Disbursed → Rejected.
  /// `key` is the server's `approvalFilter` value, or a list tab's name.
  String get _activeChipKey => _isRenewalTab ? _renewalChip : _newLoanChip;

  bool get _chipsReady => _isRenewalTab ? _renewalStagesLoaded : _stagesLoaded;

  List<({String key, String label})> get _queueChips {
    if (_isRenewalTab) {
      // Renewal chain: the server always names its stages (it falls back to
      // BM → AM → QC itself when no workflow is configured).
      return [
        (key: 'all', label: 'All Stages'),
        for (final st in _renewalStages)
          (key: 'stage:${st['roleSlug']}', label: '${st['stageName']}'),
        (key: 'admin', label: 'Admin Approval'),
        (key: 'recheck', label: 'Recheck'),
        (key: 'pre_disbursement', label: 'Pre-Disbursement'),
        (key: 'disbursed', label: 'Disbursed'),
        (key: 'rejected', label: 'Rejected'),
      ];
    }
    const listChips = [
      (key: 'recheck', label: 'Recheck'),
      (key: 'pre_disbursement', label: 'Pre-Disbursement'),
      (key: 'disbursed', label: 'Disbursed'),
      (key: 'rejected', label: 'Rejected'),
    ];
    if (_workflowStages.isEmpty) {
      return const [
        (key: 'all', label: 'All Stages'),
        (key: 'bm', label: 'BM Approval'),
        (key: 'am', label: 'AM Approval'),
        (key: 'qc', label: 'QC Verification'),
        (key: 'admin', label: 'Admin Approval'),
        ...listChips,
      ];
    }
    return [
      (key: 'all', label: 'All Stages'),
      for (final st in _workflowStages)
        (key: 'stage:${st['roleSlug']}', label: '${st['stageName']}'),
      (key: 'admin', label: 'Admin Approval'),
      ...listChips,
    ];
  }

  Widget _buildQueueSubFilter() {
    // Placeholder pills until we know which stages are configured.
    if (!_chipsReady) {
      return Container(
        margin: EdgeInsets.symmetric(vertical: 8.h),
        height: 32.h,
        child: ListView(
          scrollDirection: Axis.horizontal,
          physics: const NeverScrollableScrollPhysics(),
          children: [
            for (final w in const [80.0, 110.0, 120.0])
              Container(
                width: w.w,
                margin: EdgeInsets.only(right: 8.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFE5F7EA),
                  borderRadius: BorderRadius.circular(20.r),
                ),
              ),
          ],
        ),
      );
    }
    final chips = _queueChips;

    return Container(
      margin: EdgeInsets.symmetric(vertical: 8.h),
      height: 32.h,
      child: ListView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        children: chips.map((chip) {
          final isSelected = _activeChipKey == chip.key;
          final int? count = _isRenewalTab
              ? (chip.key == 'all' ? null : _renewalCounts[chip.key])
              : (_listChipTabs.contains(chip.key)
                    ? _tabCounts[chip.key]
                    : _stageCounts[chip.key]);
          return GestureDetector(
            onTap: () => _selectChip(chip.key),
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
                  count == null ? chip.label : '${chip.label} ($count)',
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
            controller: _searchController,
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
            onChanged: _onSearchChanged,
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
          _filterDropdown(
            icon: Icons.location_city,
            allLabel: 'All Branches',
            value: _selectedBranchId,
            options: _branches,
            onChanged: _selectBranch,
          ),
          SizedBox(height: 12.h),

          // Center select (only the chosen branch's centers)
          _filterDropdown(
            icon: Icons.account_balance,
            allLabel: 'All Centers',
            value: _selectedCenterId,
            options: _visibleCenters,
            onChanged: _selectCenter,
          ),
        ],
      ),
    );
  }

  /// A filter dropdown with an "All ..." entry first. Options are maps with
  /// `id` and `name`.
  Widget _filterDropdown({
    required IconData icon,
    required String allLabel,
    required String value,
    required List<Map<String, dynamic>> options,
    required ValueChanged<String> onChanged,
  }) {
    final ids = options.map((o) => '${o['id']}').toSet();
    final current = ids.contains(value) ? value : '';
    return DropdownButtonFormField<String>(
      key: ValueKey('$allLabel-$current-${options.length}'),
      isExpanded: true,
      initialValue: current,
      style: TextStyle(fontSize: 14.sp, color: Colors.black),
      decoration: InputDecoration(
        prefixIcon: Icon(icon, color: const Color(0xFF729A7D)),
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
      items: [
        DropdownMenuItem(value: '', child: Text(allLabel)),
        ...options.map(
          (o) => DropdownMenuItem(
            value: '${o['id']}',
            child: Text(
              '${o['name'] ?? o['code'] ?? o['id']}',
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ],
      onChanged: (v) {
        if (v != null) onChanged(v);
      },
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
        case 'Admin Approval':
          return (
            color: Colors.deepPurple.shade400,
            bg: Colors.deepPurple.shade50,
            label: 'ADMIN APPROVAL',
          );
        default:
          // A custom workflow stage — use its own name.
          return (
            color: Colors.indigo.shade600,
            bg: Colors.indigo.shade50,
            label: item.queueStage.toUpperCase(),
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
      case 'Rejected':
        return (
          color: Colors.red.shade900,
          bg: Colors.red.shade50,
          label: 'REJECTED',
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
    final isRejected = item.status == 'Rejected';
    final isMoneyStage =
        item.status == 'Pre Disbursement' || item.status == 'Disbursed';

    return Container(
      margin: EdgeInsets.only(bottom: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: (isRecheck || isRejected)
              ? Colors.red.shade100
              : const Color(0xFFE2E8F0),
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
                      if (_isFdo)
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
                ] else if (isRejected) ...[
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
                          ? 'No reason provided.'
                          : item.remarks,
                      style: TextStyle(
                        fontSize: 11.5.sp,
                        color: Colors.red.shade900,
                        height: 1.3,
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Rejected at ${item.recheckStage}'
                    '${item.requestedBy.isEmpty ? '' : ' by ${item.requestedBy}'}',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      color: const Color(0xFF64748B),
                    ),
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

  // Renewal approval status → label + color, matching the web's
  // RENEWAL_STATUS_CONFIG.
  static const _renewalStatusLabels = {
    'SUBMITTED': ('Submitted', Colors.amber),
    'PENDING_BM_REVIEW': ('Pending BM', Colors.green),
    'BM_RETAKE_REQUIRED': ('BM Retake', Colors.orange),
    'PENDING_AM_REVIEW': ('Pending AM', Colors.blue),
    'AM_RETAKE_REQUIRED': ('AM Retake', Colors.pink),
    'PENDING_QC_VERIFICATION': ('Pending QC', Colors.teal),
    'QC_VERIFICATION_RETAKE_REQUIRED': ('QC Retake', Colors.cyan),
    'PENDING_FINAL_REVIEW': ('Pending Admin', Colors.deepPurple),
    'FINAL_RETAKE_REQUIRED': ('Admin Retake', Colors.purple),
    'PENDING_LEVEL_1': ('Level 1 Pending', Colors.green),
    'LEVEL_1_RETAKE_REQUIRED': ('L1 Retake', Colors.orange),
    'PENDING_LEVEL_2': ('Level 2 Pending', Colors.blue),
    'LEVEL_2_RETAKE_REQUIRED': ('L2 Retake', Colors.pink),
    'PENDING_LEVEL_3': ('Level 3 Pending', Colors.teal),
    'LEVEL_3_RETAKE_REQUIRED': ('L3 Retake', Colors.cyan),
    'PENDING_LEVEL_4': ('Level 4 Pending', Colors.deepPurple),
    'LEVEL_4_RETAKE_REQUIRED': ('L4 Retake', Colors.purple),
    'APPROVED': ('Approved', Colors.green),
    'REJECTED': ('Rejected', Colors.red),
  };

  // Disbursement status → label + color (web's DISB_STATUS_CONFIG).
  static const _disbStatusLabels = {
    'PENDING_LEVEL1': ('Pending AM', Colors.orange),
    'APPROVED_LEVEL1': ('AM Approved', Colors.blue),
    'PENDING_LEVEL2': ('Pending BM', Colors.deepPurple),
    'APPROVED_LEVEL2': ('Ready to Disburse', Colors.green),
    'DISBURSED': ('Disbursed', Colors.teal),
    'REJECTED': ('Rejected', Colors.red),
  };

  /// The badge on a renewal card: the disbursement status on the
  /// Pre-Disbursement / Disbursed chips, "Image Recheck" when only a document
  /// was flagged, otherwise the approval status.
  ({String label, Color color, Color bg}) _renewalBadge(RenewalTrackerItem it) {
    ({String label, Color color, Color bg}) of(String label, MaterialColor c) =>
        (label: label, color: c.shade700, bg: c.shade50);

    if (_renewalChip == 'pre_disbursement' || _renewalChip == 'disbursed') {
      final cfg = _disbStatusLabels[it.disbursementStatus];
      return cfg == null
          ? of(it.disbursementStatus, Colors.grey)
          : of(cfg.$1, cfg.$2);
    }
    if (it.recheck?['documentOnly'] == true) {
      return of('Image Recheck', Colors.pink);
    }
    final cfg = _renewalStatusLabels[it.renewalApprovalStatus];
    return cfg == null
        ? of(it.renewalApprovalStatus, Colors.grey)
        : of(cfg.$1, cfg.$2);
  }

  /// A renewal loan application card — read-only, like the web's Renewal Loan
  /// tab: client, loan number and amount, stage badge, FDO, applied date, plus
  /// the recheck remarks / rejection details where they apply.
  Widget _buildRenewalCard(RenewalTrackerItem item) {
    final badge = _renewalBadge(item);
    final recheck = item.recheck;
    final rejection = item.rejection;
    final recheckBy = recheck?['by']?.toString();
    final recheckRemarks = recheck?['remarks']?.toString();
    final isRecheckChip = _renewalChip == 'recheck';
    final isRejected = rejection != null;

    return Container(
      margin: EdgeInsets.only(bottom: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(
          color: isRejected ? Colors.red.shade100 : const Color(0xFFE2E8F0),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Padding(
        padding: EdgeInsets.all(14.r),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _avatar(item.clientName, badge.color),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.clientName.isEmpty
                            ? item.clientDisplayId
                            : item.clientName,
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
                        item.clientDisplayId,
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
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    _badge(badge.label.toUpperCase(), badge.color, badge.bg),
                    if (recheckBy != null && recheckBy.isNotEmpty) ...[
                      SizedBox(height: 3.h),
                      Text(
                        'by $recheckBy',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF94A3B8),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
            SizedBox(height: 10.h),
            Wrap(
              spacing: 14.w,
              runSpacing: 6.h,
              children: [
                _metaChip(Icons.receipt_long_outlined, item.loanNumber),
                _metaChip(
                  Icons.currency_rupee_rounded,
                  _formatAmount('${item.amount}'),
                ),
                if (item.mobileNumber != null)
                  _metaChip(Icons.call_outlined, item.mobileNumber!),
                if (item.centerName != null)
                  _metaChip(Icons.apartment_outlined, item.centerName!),
                if (item.branchName != null)
                  _metaChip(Icons.account_tree_outlined, item.branchName!),
                if (item.productName != null)
                  _metaChip(Icons.inventory_2_outlined, item.productName!),
                if (item.fdoName != null)
                  _metaChip(Icons.badge_outlined, item.fdoName!),
              ],
            ),
            if (isRecheckChip &&
                recheckRemarks != null &&
                recheckRemarks.isNotEmpty) ...[
              SizedBox(height: 10.h),
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(10.r),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Text(
                  recheckRemarks,
                  style: TextStyle(
                    fontSize: 11.5.sp,
                    color: Colors.red.shade900,
                    height: 1.3,
                  ),
                ),
              ),
            ],
            if (isRejected) ...[
              SizedBox(height: 10.h),
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(10.r),
                decoration: BoxDecoration(
                  color: Colors.red.shade50,
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Rejected by ${rejection['stageName'] ?? 'Admin'}'
                      ' · ${rejection['by'] ?? '—'}'
                      ' · ${_displayDate(rejection['at'])}',
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w700,
                        color: Colors.red.shade900,
                      ),
                    ),
                    if ((rejection['remarks']?.toString() ?? '').isNotEmpty) ...[
                      SizedBox(height: 4.h),
                      Text(
                        '${rejection['remarks']}',
                        style: TextStyle(
                          fontSize: 11.5.sp,
                          color: Colors.red.shade900,
                          height: 1.3,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
            SizedBox(height: 8.h),
            Text(
              _renewalChip == 'disbursed'
                  ? 'Applied ${_displayDate(item.createdAt)}'
                        ' • Disbursed ${_displayDate(item.disbursedAt)}'
                  : 'Applied ${_displayDate(item.createdAt)}',
              style: TextStyle(
                fontSize: 10.5.sp,
                color: const Color(0xFF729A7D),
              ),
            ),
          ],
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
            _isRenewalTab
                ? 'No renewal loans match the selected filters.'
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
