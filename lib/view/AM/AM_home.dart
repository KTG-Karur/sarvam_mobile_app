import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/controller/dashboard_controller.dart';
import 'package:sarvam/view/AM/am_reports_hub.dart';
import 'package:sarvam/view/AM/collection_view/collection_view_hub.dart';
import 'package:sarvam/view/AM/disbursement_approval/disbursement_approval.dart';
import 'package:sarvam/view/AM/foreclosure_approval/foreclosure_approval.dart';
import 'package:sarvam/view/AM/gold_return/gold_return_approval.dart';
import 'package:sarvam/view/ADMIN/users/user_list.dart';
import 'package:sarvam/view/BM/correct_collection_entry.dart';
import 'package:sarvam/view/BM/correct_single_collection.dart';
import 'package:sarvam/view/BM/centre_approval.dart';
import 'package:sarvam/view/BM/collection_approval/collection_approval.dart';
import 'package:sarvam/view/BM/member_approval.dart';
import 'package:sarvam/view/BM/member_individual/member_individual.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/client_loan_tracker.dart';
import 'package:sarvam/view/FDO/client_search_locate/client_search_locate.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/auth/role_home_router.dart';
import 'package:sarvam/widgets/punch_out_dialog.dart';

class _Metric {
  const _Metric(this.icon, this.label, this.value, [this.sub]);

  final IconData icon;
  final String label;
  final String value;
  final String? sub;
}

/// Area Manager portal — mirrors the Area Manager menu of the web
/// application. Only AM-scoped modules are exposed here; FDO data-entry and
/// BM-only screens are intentionally excluded. Module visibility is gated on
/// the resolved [AppRole] so a stale/other-role session never sees AM menus.
class AmHome extends StatefulWidget {
  const AmHome({super.key, this.isBranchManager = false});

  final bool isBranchManager;

  @override
  State<AmHome> createState() => _AmHomeState();
}

class _AmHomeState extends State<AmHome> with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  late final DashboardController _dashboardController;
  late final AnimationController _pageAnimationController;
  late final Animation<double> _pageFade;
  late final Animation<Offset> _pageSlide;

  int _tabIndex = 0;
  bool _roleChecked = false;
  AppRole _role = AppRole.unknown;

  @override
  void initState() {
    super.initState();
    _dashboardController = Get.isRegistered<DashboardController>()
        ? Get.find<DashboardController>()
        : Get.put(DashboardController());
    _pageAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );
    _pageFade = CurvedAnimation(
      parent: _pageAnimationController,
      curve: Curves.easeOut,
    );
    _pageSlide = Tween<Offset>(
      begin: const Offset(0, 0.04),
      end: Offset.zero,
    ).animate(_pageFade);
    _pageAnimationController.forward();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _dashboardController.getTaskDetails(),
    );
    _loadUserDetails();
    RoleScope.current().then((role) {
      if (!mounted) return;
      setState(() {
        _role = role;
        _roleChecked = true;
      });
    });
  }

  bool _punchedOutToday = false;
  bool _presentToday = false;
  bool _isWorkingDay = true;
  String? _attendanceStatus;

  Future<void> _loadUserDetails() async {
    final prefs = await SharedPreferences.getInstance();
    final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
    final localPunchIn = hasPunchedInToday(prefs);
    final localPunchOut = hasPunchedOutToday(prefs);

    if (serverInfo != null) {
      final bool isServerPunchedIn = serverInfo.present || serverInfo.punchedIn;
      final bool isServerPunchedOut = serverInfo.punchedOut;

      if (!isServerPunchedIn && !isServerPunchedOut) {
        await prefs.remove('lastPunchInDate');
        await prefs.remove('lastPunchInTime');
        await prefs.remove('lastPunchOutDate');
        await prefs.remove('lastPunchOutTime');
        await prefs.remove('lastPunchStatus');
      } else {
        if (isServerPunchedIn) {
          await prefs.setString('lastPunchInDate', todayDateKey());
        }
        if (isServerPunchedOut) {
          await prefs.setString('lastPunchOutDate', todayDateKey());
        }
        if (serverInfo.status != null) {
          await prefs.setString('lastPunchStatus', serverInfo.status!);
        }
      }
    }
    if (!mounted) return;
    setState(() {
      final bool isPunchedOut = (serverInfo != null) ? serverInfo.punchedOut : localPunchOut;
      final bool isPunchedIn = (serverInfo != null) ? (serverInfo.present || serverInfo.punchedIn) : localPunchIn;

      _punchedOutToday = isPunchedOut;
      _presentToday = isPunchedIn || isPunchedOut;
      _attendanceStatus = serverInfo?.status ?? prefs.getString('lastPunchStatus');
      _isWorkingDay = serverInfo?.isWorkingDay ?? true;
    });
  }

  String get _attendanceStatusText {
    if (!_isWorkingDay || _attendanceStatus == 'HOLIDAY') {
      return 'Holiday / Off';
    }
    if (_punchedOutToday) {
      if (_attendanceStatus == 'HALF_DAY') {
        return 'Half Day Present';
      }
      if (_attendanceStatus == 'FULL_DAY') {
        return 'Full Day Present';
      }
      return 'Shift Completed';
    }
    if (_presentToday) {
      return 'Present (Punched In)';
    }
    return 'Absent (Not Punched)';
  }

  String get _attendanceStatusBadgeText {
    if (!_isWorkingDay || _attendanceStatus == 'HOLIDAY') {
      return 'Holiday';
    }
    if (_punchedOutToday) {
      return 'Punched Out';
    }
    if (_presentToday) {
      return 'Present';
    }
    return 'Absent';
  }

  Color get _attendanceStatusColor {
    if (!_isWorkingDay || _attendanceStatus == 'HOLIDAY') {
      return const Color(0xFFB45309);
    }
    if (_punchedOutToday || _presentToday) {
      return const Color(0xFF0D6842);
    }
    return const Color(0xFFDC2626);
  }

  Color get _attendanceStatusBgColor {
    if (!_isWorkingDay || _attendanceStatus == 'HOLIDAY') {
      return const Color(0xFFFEF3C7);
    }
    if (_punchedOutToday || _presentToday) {
      return const Color(0xFFE8F5E9);
    }
    return const Color(0xFFFEF2F2);
  }

  @override
  void dispose() {
    _pageAnimationController.dispose();
    super.dispose();
  }

  bool get _isAreaManager => _role == AppRole.areaManager;

  Future<bool> _showConfirmExitDialog() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        backgroundColor: Colors.white,
        title: Row(
          children: [
            Container(
              padding: EdgeInsets.all(8.w),
              decoration: const BoxDecoration(
                color: Color(0xFFE8F5E9),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.exit_to_app_rounded, color: const Color(0xFF0D6842), size: 22.sp),
            ),
            SizedBox(width: 10.w),
            Text(
              'Exit Application?',
              style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
            ),
          ],
        ),
        content: Text(
          'Are you sure you want to exit Sarvam application?',
          style: TextStyle(fontSize: 14.sp, color: const Color(0xFF475569)),
        ),
        actions: [
          OutlinedButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Color(0xFFCBD5E1)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            child: Text('Cancel', style: TextStyle(color: const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 13.5.sp)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0D6842),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            child: Text('Exit App', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13.5.sp)),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final confirm = await _showConfirmExitDialog();
        if (confirm && mounted) {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        body: SafeArea(
          child: Column(
            children: [
              _buildHeader(context),
              _buildSegmentTabs(),
              Expanded(
                child: Obx(
                  () => RefreshIndicator(
                    color: _green,
                    onRefresh: () async {
                      await _dashboardController.getTaskDetails();
                      await _loadUserDetails();
                    },
                    child: _tabIndex == 0
                        ? _buildDashboardBody()
                        : _buildModulesBody(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Segmented Overview / Modules ──────────────────────────────────────────

  Widget _buildSegmentTabs() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 10.h),
      child: Container(
        padding: EdgeInsets.all(4.w),
        decoration: BoxDecoration(
          color: const Color(0xFFEAF2EE),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Row(
          children: [
            _buildSegmentItem('Overview', 0, Icons.dashboard_outlined),
            SizedBox(width: 6.w),
            _buildSegmentItem('Modules', 1, Icons.grid_view_rounded),
          ],
        ),
      ),
    );
  }

  Widget _buildSegmentItem(String label, int index, IconData icon) {
    final active = _tabIndex == index;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _tabIndex = index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          padding: EdgeInsets.symmetric(vertical: 9.h),
          decoration: BoxDecoration(
            color: active ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(9.r),
            boxShadow: active
                ? [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.06),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : const [],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                icon,
                size: 16.sp,
                color: active ? _green : _muted,
              ),
              SizedBox(width: 6.w),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w700,
                  color: active ? _green : _muted,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── Overview: role-scoped dashboard ───────────────────────────────────────

  Widget _buildDashboardBody() {
    final data = _dashboardController.taskDetails;
    if (_dashboardController.isTaskDetailsLoading.value && data.isEmpty) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }

    if (data.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.all(24.w),
        children: [
          Icon(Icons.dashboard_outlined, size: 56.sp, color: _muted),
          SizedBox(height: 16.h),
          Text(
            'Unable to load dashboard data. Pull down to retry.',
            textAlign: TextAlign.center,
            style: GoogleFonts.inter(color: _muted, fontSize: 15.sp),
          ),
        ],
      );
    }

    final targets = _map(data['targets']);
    final achievement = _map(data['achievement']);
    final operations = _map(data['operations']);
    final goldLoan = _map(data['goldLoan']);
    final portfolio = _map(data['portfolio']);
    final arrear = _map(data['arrear']);
    final actualCollection = _num(data['actualCollectionPct']);
    final difference = _num(data['collectionDifferencePct']);
    final par = _num(data['arrearMemberPct']);

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: EdgeInsets.all(16.w),
      child: FadeTransition(
        opacity: _pageFade,
        child: SlideTransition(
          position: _pageSlide,
          child: Container(
            padding: EdgeInsets.all(14.w),
            decoration: BoxDecoration(
              color: Colors.white,
              border: Border.all(color: const Color(0xFFC8EBD4)),
              borderRadius: BorderRadius.circular(14.r),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildAttendanceCard(),
                _buildTaskHeader(data),
                _metricSection('TARGETS', [
                  _Metric(
                    Icons.person_add_alt_1_rounded,
                    'New Member Target',
                    _number(targets['newMemberTarget']),
                  ),
                  _Metric(
                    Icons.refresh_rounded,
                    'Renewal Target',
                    _number(targets['renewalMemberTarget']),
                  ),
                  _Metric(
                    Icons.track_changes_rounded,
                    'Total Enrollment',
                    _number(targets['enrollmentTarget']),
                  ),
                  _Metric(
                    Icons.account_balance_rounded,
                    'Loan Disbmt Target',
                    _currency(targets['loanDisbursementTarget']),
                  ),
                ], columns: 2),
                _metricSection('ACHIEVEMENT', [
                  _Metric(
                    Icons.person_add_alt_1_rounded,
                    'New Members',
                    _number(achievement['newMember']),
                    _percent(
                      achievement['newMember'],
                      targets['newMemberTarget'],
                    ),
                  ),
                  _Metric(
                    Icons.refresh_rounded,
                    'Renewals',
                    _number(achievement['renewal']),
                    _percent(
                      achievement['renewal'],
                      targets['renewalMemberTarget'],
                    ),
                  ),
                  _Metric(
                    Icons.monetization_on_rounded,
                    'Gold Loans',
                    _number(achievement['goldLoan']),
                  ),
                  _Metric(
                    Icons.trending_up_rounded,
                    'Disbmt Amount',
                    _currency(achievement['disbursementAmount']),
                    _percent(
                      achievement['disbursementAmount'],
                      targets['loanDisbursementTarget'],
                    ),
                  ),
                ], columns: 2),
                _metricSection('OPERATIONS', [
                  _Metric(
                    Icons.location_city_rounded,
                    'No. of Centers',
                    _number(operations['numberOfCenters']),
                  ),
                  _Metric(
                    Icons.groups_rounded,
                    'Active (Total)',
                    _number(operations['activeClients']),
                  ),
                  _Metric(
                    Icons.people_alt_rounded,
                    'Active Members',
                    _number(operations['activeMembers']),
                  ),
                  _Metric(
                    Icons.person_rounded,
                    'Active Clients',
                    _number(operations['activeClientsWithLoan']),
                  ),
                  _Metric(
                    Icons.currency_rupee_rounded,
                    'Disbmt Clients',
                    _number(operations['totalDisbursementMembers']),
                  ),
                  _Metric(
                    Icons.account_balance_wallet_rounded,
                    'Disbmt Amount',
                    _currency(operations['totalDisbursementAmount']),
                  ),
                ], columns: 2),
                _metricSection('GOLD LOAN', [
                  _Metric(
                    Icons.people_rounded,
                    'Clients',
                    _number(goldLoan['numberOfMembers']),
                  ),
                  _Metric(
                    Icons.account_balance_wallet_rounded,
                    'Disbmt Amount',
                    _currency(goldLoan['disbursementAmount']),
                  ),
                  _Metric(
                    Icons.assignment_return_rounded,
                    'Returns',
                    _number(goldLoan['goldReturn']),
                  ),
                ], columns: 2),
                _metricSection('COLLECTION', [
                  const _Metric(Icons.track_changes_rounded, 'Target', '100%'),
                  _Metric(
                    Icons.show_chart_rounded,
                    'Actual',
                    '${actualCollection.toStringAsFixed(1)}%',
                  ),
                  _Metric(
                    Icons.percent_rounded,
                    'Difference',
                    '${difference > 0 ? '-' : ''}${difference.toStringAsFixed(1)}%',
                  ),
                  _Metric(
                    Icons.monetization_on_rounded,
                    'Gold Loan Coll.',
                    '${actualCollection.toStringAsFixed(1)}%',
                  ),
                ], columns: 2),
                _metricSection('PORTFOLIO OUTSTANDING', [
                  _Metric(
                    Icons.account_balance_wallet_rounded,
                    'Principal O/S',
                    _currency(portfolio['principalOutstanding']),
                  ),
                  _Metric(
                    Icons.currency_rupee_rounded,
                    'Interest O/S',
                    _currency(portfolio['interestOutstanding']),
                  ),
                ], columns: 2),
                _metricSection('ARREARS', [
                  _Metric(
                    Icons.warning_amber_rounded,
                    'Arrear Clients',
                    _number(arrear['arrearClients']),
                  ),
                  _Metric(
                    Icons.currency_rupee_rounded,
                    'Principal',
                    _currency(arrear['arrearPrincipal']),
                  ),
                  _Metric(
                    Icons.percent_rounded,
                    'Interest',
                    _currency(arrear['arrearInterest']),
                  ),
                ], columns: 2),
                _buildParCard(
                  par,
                  arrear['arrearClients'],
                  operations['activeClients'],
                ),
                _buildOutstandingBalanceCard(portfolio),
                SizedBox(height: 24.h),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── Modules: AM-only menus (mirrors web sidebar for AREA_MANAGER) ─────────

  Widget _buildModulesBody() {
    if (!_roleChecked) {
      return const Center(child: CircularProgressIndicator(color: _green));
    }
    if (!_isAreaManager) {
      return _buildAccessDenied();
    }

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: EdgeInsets.all(16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _moduleSection(
            title: 'LOAN MODULE',
            items: [
              _ModuleItem(
                icon: Icons.account_balance_wallet_rounded,
                title: 'Disbursement Approval',
                subtitle: 'Review & approve level-2 loans for final disbursal',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const DisbursementApproval()),
                ),
              ),
              _ModuleItem(
                icon: Icons.badge_rounded,
                title: 'Member Individual',
                subtitle: 'Review per-loan Member Individual appraisals',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MemberIndividual()),
                ),
              ),
              _ModuleItem(
                icon: Icons.track_changes_rounded,
                title: 'Client Loan Tracker',
                subtitle: 'Track enrollment, approval & loan status across branches',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ClientLoanTracker()),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'COLLECTIONS & FORECLOSURE',
            items: [
              _ModuleItem(
                icon: Icons.check_circle_outline_rounded,
                title: 'Collection Approval',
                subtitle: 'Review & authorize collections submitted by Field Officers',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const CollectionApproval(),
                  ),
                ),
              ),
              _ModuleItem(
                icon: Icons.visibility_rounded,
                title: 'View Collections',
                subtitle: 'Live, arrear, advance & single collection oversight',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => CollectionViewHub(
                      isBranchManager: widget.isBranchManager,
                    ),
                  ),
                ),
              ),
              _ModuleItem(
                icon: Icons.gavel_rounded,
                title: 'Foreclosure Approval',
                subtitle: 'Review & approve loan foreclosure requests',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const ForeclosureApproval(),
                  ),
                ),
              ),
              _ModuleItem(
                icon: Icons.undo_rounded,
                title: 'Correct Collection',
                subtitle: 'Reverse an approved collection entry',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const CorrectCollectionEntry(),
                  ),
                ),
              ),
              _ModuleItem(
                icon: Icons.person_search_rounded,
                title: 'Correct Single Collection',
                subtitle: 'Reverse a single client collection',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const CorrectSingleCollection(),
                  ),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'CLIENT & APPROVAL',
            items: [
              _ModuleItem(
                icon: Icons.how_to_reg_rounded,
                title: 'Member Approval',
                subtitle: 'Approve client enrollments & co-applicants',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const MemberApproval()),
                ),
              ),
              _ModuleItem(
                icon: Icons.location_on_rounded,
                title: 'Search & Locate',
                subtitle: 'Find members by center or client ID',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => const ClientSearchLocate(),
                  ),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'CENTER OPERATIONS',
            items: [
              _ModuleItem(
                icon: Icons.shield_rounded,
                title: 'Center Approval',
                subtitle: 'Approve or reject center requests',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const CentreApproval()),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'GOLD LOAN',
            items: [
              _ModuleItem(
                icon: Icons.workspace_premium_rounded,
                title: 'Gold Return Approval',
                subtitle: 'Approve or reject gold return transactions',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const GoldReturnApproval()),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'REPORTS & MONITORING',
            items: [
              _ModuleItem(
                icon: Icons.bar_chart_rounded,
                title: 'Area Manager Reports',
                subtitle: 'Demand, DCB, PAR, portfolio & performance reports',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const AmReportsHub()),
                ),
              ),
            ],
          ),
          _moduleSection(
            title: 'ACCOUNT & EMPLOYEES',
            items: [
              _ModuleItem(
                icon: Icons.people_outline_rounded,
                title: 'User Management',
                subtitle: 'View & manage subordinate branch employees',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const UserList()),
                ),
              ),
              _ModuleItem(
                icon: Icons.person_rounded,
                title: 'Profile',
                subtitle: 'View your profile & role details',
                onTap: () => _showProfileBottomSheet(context),
              ),
              _ModuleItem(
                icon: Icons.logout_rounded,
                title: 'Punch Out',
                subtitle: 'Face-verify and end today\'s shift',
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        const FaceVerificationScreen(isPunchOut: true),
                  ),
                ),
              ),
              _ModuleItem(
                icon: Icons.logout_rounded,
                title: 'Logout',
                subtitle: 'Sign out of this device',
                onTap: _logout,
                danger: true,
              ),
            ],
          ),
          SizedBox(height: 12.h),
        ],
      ),
    );
  }

  Widget _moduleSection({required String title, required List<_ModuleItem> items}) {
    return Padding(
      padding: EdgeInsets.only(bottom: 18.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: _sectionStyle),
          SizedBox(height: 8.h),
          ...items.map((item) => _moduleTile(item)),
        ],
      ),
    );
  }

  Widget _moduleTile(_ModuleItem item) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        child: InkWell(
          onTap: item.onTap,
          borderRadius: BorderRadius.circular(14.r),
          child: Container(
            padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 13.h),
            decoration: BoxDecoration(
              border: Border.all(
                color: item.danger
                    ? const Color(0xFFFECACA)
                    : const Color(0xFFE8F0EB),
              ),
              borderRadius: BorderRadius.circular(14.r),
            ),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(10.w),
                  decoration: BoxDecoration(
                    color: item.danger
                        ? const Color(0xFFFEF2F2)
                        : const Color(0xFFE4F5EB),
                    borderRadius: BorderRadius.circular(11.r),
                  ),
                  child: Icon(
                    item.icon,
                    color: item.danger ? const Color(0xFFDC2626) : _green,
                    size: 22.sp,
                  ),
                ),
                SizedBox(width: 14.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        style: GoogleFonts.inter(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        item.subtitle,
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          color: _muted,
                          height: 1.2,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: item.danger ? const Color(0xFFDC2626) : _green,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAccessDenied() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.all(24.w),
      children: [
        Icon(Icons.gpp_bad_rounded, size: 56.sp, color: _muted),
        SizedBox(height: 16.h),
        Text(
          'Access restricted to Area Manager accounts.',
          textAlign: TextAlign.center,
          style: GoogleFonts.inter(color: _muted, fontSize: 15.sp),
        ),
        SizedBox(height: 24.h),
        SizedBox(
          height: 48.h,
          child: ElevatedButton(
            onPressed: _logout,
            style: ElevatedButton.styleFrom(
              backgroundColor: _green,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12.r),
              ),
            ),
            child: const Text('Sign Out'),
          ),
        ),
      ],
    );
  }

  // ── Dashboard metric helpers ──────────────────────────────────────────────

  Widget _buildTaskHeader(Map<String, dynamic> data) => Padding(
    padding: EdgeInsets.only(bottom: 18.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('TASK DETAILS', style: _sectionStyle),
        SizedBox(height: 6.h),
        Text(
          '${data['name'] ?? 'Area Manager'}  •  ${data['subordinateCount'] ?? 0} BMs reporting',
          style: GoogleFonts.inter(
            fontSize: 14.sp,
            color: _darkText,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    ),
  );

  Widget _metricSection(
    String title,
    List<_Metric> metrics, {
    int columns = 2,
  }) => Padding(
    padding: EdgeInsets.only(bottom: 20.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: _sectionStyle),
        SizedBox(height: 8.h),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFC8EBD4)),
            borderRadius: BorderRadius.circular(12.r),
          ),
          clipBehavior: Clip.antiAlias,
          child: GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: metrics.length,
            gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: columns,
              crossAxisSpacing: 0,
              mainAxisSpacing: 0,
              childAspectRatio: 2.1,
            ),
            itemBuilder: (_, index) => _buildMetricCard(
              metrics[index],
              showRightDivider: index % columns != columns - 1,
              showBottomDivider:
                  index <
                  metrics.length -
                      (metrics.length % columns == 0
                          ? columns
                          : metrics.length % columns),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _buildMetricCard(
    _Metric metric, {
    required bool showRightDivider,
    required bool showBottomDivider,
  }) => Container(
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    decoration: BoxDecoration(
      border: Border(
        right: showRightDivider
            ? const BorderSide(color: Color(0xFFC8EBD4))
            : BorderSide.none,
        bottom: showBottomDivider
            ? const BorderSide(color: Color(0xFFC8EBD4))
            : BorderSide.none,
      ),
    ),
    child: Row(
      children: [
        Container(
          padding: EdgeInsets.all(7.w),
          decoration: BoxDecoration(
            color: const Color(0xFFE4F5EB),
            borderRadius: BorderRadius.circular(9.r),
          ),
          child: Icon(metric.icon, color: _green, size: 20.sp),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                metric.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.inter(
                  fontSize: 10.sp,
                  color: _muted,
                  fontWeight: FontWeight.w600,
                ),
              ),
              SizedBox(height: 1.h),
              Text(
                metric.value,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: GoogleFonts.inter(
                  fontSize: 14.sp,
                  color: _darkText,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if (metric.sub != null) ...[
                SizedBox(height: 1.h),
                Text(
                  metric.sub!,
                  style: GoogleFonts.inter(
                    fontSize: 10.sp,
                    color: _green,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    ),
  );

  Widget _buildParCard(
    double par,
    dynamic arrearClients,
    dynamic activeClients,
  ) => Padding(
    padding: EdgeInsets.only(bottom: 20.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('PAR (PORTFOLIO AT RISK)', style: _sectionStyle),
            Text(
              '${par.toStringAsFixed(1)}%',
              style: GoogleFonts.inter(
                fontSize: 14.sp,
                fontWeight: FontWeight.w800,
                color: par >= 20
                    ? Colors.red
                    : par >= 10
                    ? Colors.orange
                    : _green,
              ),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        ClipRRect(
          borderRadius: BorderRadius.circular(10.r),
          child: LinearProgressIndicator(
            value: (par / 100).clamp(0, 1),
            minHeight: 12.h,
            backgroundColor: const Color(0xFFE2E8F0),
            color: par >= 20
                ? Colors.red
                : par >= 10
                ? Colors.orange
                : _green,
          ),
        ),
        SizedBox(height: 6.h),
        Text(
          '${_number(arrearClients)} of ${_number(activeClients)} members/clients in arrears',
          style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
        ),
      ],
    ),
  );

  Widget _buildOutstandingBalanceCard(Map<String, dynamic> portfolio) =>
      Padding(
        padding: EdgeInsets.only(bottom: 20.h),
        child: Container(
          width: double.infinity,
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 18.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(color: const Color(0xFFF1E9E0)),
          ),
          child: Row(
            children: [
              Container(
                padding: EdgeInsets.all(12.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF3E0),
                  borderRadius: BorderRadius.circular(12.r),
                ),
                child: Icon(
                  Icons.account_balance_wallet_rounded,
                  color: const Color(0xFFF29906),
                  size: 30.sp,
                ),
              ),
              SizedBox(width: 14.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Outstanding Balance',
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        color: _muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      _currency(portfolio['principalOutstanding']),
                      style: GoogleFonts.inter(
                        fontSize: 22.sp,
                        color: const Color(0xFFB45309),
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      );

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};
  double _num(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('${value ?? 0}') ?? 0;
  String _percent(dynamic value, dynamic target) {
    final denominator = _num(target);
    if (denominator == 0) return _num(value) > 0 ? '—' : '0%';
    return '${((_num(value) / denominator) * 100).round()}%';
  }

  TextStyle get _sectionStyle => GoogleFonts.inter(
    fontSize: 13.sp,
    fontWeight: FontWeight.w800,
    color: _muted,
    letterSpacing: 1.1,
  );

  String _number(dynamic value) =>
      NumberFormat.decimalPattern('en_IN').format((value as num?) ?? 0);
  String _currency(dynamic value) => NumberFormat.compactCurrency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 1,
  ).format((value as num?) ?? 0);

  // ── Header ────────────────────────────────────────────────────────────────

  Widget _buildHeader(BuildContext context) {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      child: Row(
        children: [
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      'Dashboard',
                      style: TextStyle(
                        fontSize: 22.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    SizedBox(width: 8.w),
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 3.h,
                      ),
                      decoration: BoxDecoration(
                        color: _attendanceStatusBgColor,
                        borderRadius: BorderRadius.circular(10.r),
                        border: Border.all(
                          color: _attendanceStatusColor.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 7.w,
                            height: 7.w,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: _attendanceStatusColor,
                            ),
                          ),
                          SizedBox(width: 5.w),
                          Text(
                            _attendanceStatusBadgeText,
                            style: TextStyle(
                              color: _attendanceStatusColor,
                              fontSize: 11.sp,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 2.h),
                Text(
                  widget.isBranchManager
                      ? 'Branch performance overview'
                      : 'Area performance overview',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 12.5.sp, color: _muted),
                ),
              ],
            ),
          ),
          SizedBox(width: 8.w),
          // Refresh
          Obx(
            () => GestureDetector(
              onTap: _dashboardController.isTaskDetailsLoading.value
                  ? null
                  : () async {
                      await _dashboardController.getTaskDetails();
                      await _loadUserDetails();
                    },
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _dashboardController.isTaskDetailsLoading.value
                      ? SizedBox(
                          width: 22.sp,
                          height: 22.sp,
                          child: const CircularProgressIndicator(
                            strokeWidth: 2,
                            color: _green,
                          ),
                        )
                      : Icon(Icons.refresh, color: _darkText, size: 22.sp),
                  Text(
                    'Refresh',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      color: _muted,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (_isWorkingDay && !_punchedOutToday && _presentToday) ...[
            SizedBox(width: 14.w),
            // Punch Out
            GestureDetector(
              onTap: () => PunchOutDialog.show(context).then((_) => _loadUserDetails()),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.logout_rounded,
                    color: const Color(0xFFDC2626),
                    size: 22.sp,
                  ),
                  Text(
                    'Punch Out',
                    style: TextStyle(
                      fontSize: 10.5.sp,
                      color: const Color(0xFFDC2626),
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAttendanceCard() {
    final dateStr = DateFormat('EEE, dd MMM yyyy').format(DateTime.now());
    return Container(
      width: double.infinity,
      margin: EdgeInsets.only(bottom: 18.h),
      padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 14.h),
      decoration: BoxDecoration(
        color: _attendanceStatusBgColor,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(
          color: _attendanceStatusColor.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: _attendanceStatusColor.withValues(alpha: 0.15),
                  blurRadius: 6,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Icon(
              !_isWorkingDay || _attendanceStatus == 'HOLIDAY'
                  ? Icons.beach_access_rounded
                  : _presentToday || _punchedOutToday
                      ? Icons.verified_user_rounded
                      : Icons.person_off_rounded,
              color: _attendanceStatusColor,
              size: 24.sp,
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'MY ATTENDANCE  •  $dateStr',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w800,
                    color: _muted,
                    letterSpacing: 0.5,
                  ),
                ),
                SizedBox(height: 3.h),
                Text(
                  _attendanceStatusText,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w900,
                    color: _attendanceStatusColor,
                  ),
                ),
              ],
            ),
          ),
          if (_isWorkingDay && !_presentToday && !_punchedOutToday) ...[
            SizedBox(width: 8.w),
            ElevatedButton.icon(
              onPressed: () => Navigator.of(context)
                  .push(
                    MaterialPageRoute(
                      builder: (_) => const FaceVerificationScreen(),
                    ),
                  )
                  .then((_) => _loadUserDetails()),
              icon: Icon(Icons.center_focus_strong_rounded, size: 15.sp, color: Colors.white),
              label: Text(
                'Punch In',
                style: TextStyle(
                  fontSize: 11.5.sp,
                  fontWeight: FontWeight.bold,
                  color: Colors.white,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0D6842),
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
                elevation: 0,
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ── Profile / logout ──────────────────────────────────────────────────────

  void _logout() {
    final AuthController authController = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : Get.put(AuthController());
    authController.confirmLogout(context);
  }

  void _showProfileBottomSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(24.r),
              topRight: Radius.circular(24.r),
            ),
          ),
          padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 20.h),
          child: FutureBuilder<Map<String, String>>(
            future: _getProfileDetails(),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return SizedBox(
                  height: 200.h,
                  child: const Center(
                    child: CircularProgressIndicator(color: _green),
                  ),
                );
              }
              final data = snapshot.data ?? {};
              final String firstName = data['firstName'] ?? 'User';
              final String lastName = data['lastName'] ?? '';
              final String employeeId = data['employeeId'] ?? 'N/A';
              final String role =
                  data['rbacRoleName'] ?? (data['role'] ?? 'Area Manager');
              final String email = data['email'] ?? 'N/A';
              final String mobile = data['mobileNumber'] ?? 'N/A';
              final String branch = data['branchName'] ?? 'N/A';
              final String initials =
                  '${firstName.isNotEmpty ? firstName[0] : ''}${lastName.isNotEmpty ? lastName[0] : ''}'
                      .toUpperCase();

              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 40.w,
                    height: 5.h,
                    decoration: BoxDecoration(
                      color: const Color(0xFFE2E8F0),
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                  SizedBox(height: 20.h),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 32.r,
                        backgroundColor: const Color(0xFFE4F5EB),
                        child: Text(
                          initials.isNotEmpty ? initials : 'U',
                          style: GoogleFonts.inter(
                            fontSize: 22.sp,
                            fontWeight: FontWeight.bold,
                            color: _green,
                          ),
                        ),
                      ),
                      SizedBox(width: 16.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '$firstName $lastName',
                              style: GoogleFonts.inter(
                                fontSize: 19.sp,
                                fontWeight: FontWeight.bold,
                                color: _darkText,
                              ),
                            ),
                            SizedBox(height: 3.h),
                            Text(
                              role,
                              style: GoogleFonts.inter(
                                fontSize: 13.sp,
                                color: _muted,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 20.h),
                  const Divider(height: 1, color: Color(0xFFE2E8F0)),
                  SizedBox(height: 16.h),
                  _buildProfileRow(
                    Icons.badge_outlined,
                    'Employee ID',
                    employeeId,
                  ),
                  SizedBox(height: 14.h),
                  _buildProfileRow(Icons.email_outlined, 'Email', email),
                  SizedBox(height: 14.h),
                  _buildProfileRow(Icons.phone_outlined, 'Mobile', mobile),
                  SizedBox(height: 14.h),
                  _buildProfileRow(Icons.store_outlined, 'Branch', branch),
                  SizedBox(height: 24.h),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.red.shade50,
                        foregroundColor: Colors.red,
                        elevation: 0,
                        padding: EdgeInsets.symmetric(vertical: 14.h),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                      ),
                      onPressed: _logout,
                      child: Text(
                        'Logout',
                        style: GoogleFonts.inter(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 10.h),
                ],
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildProfileRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 22.sp, color: _muted),
        SizedBox(width: 14.w),
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 14.sp,
            color: _muted,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        Text(
          value,
          style: GoogleFonts.inter(
            fontSize: 14.sp,
            color: _darkText,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Future<Map<String, String>> _getProfileDetails() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'firstName': prefs.getString('firstName') ?? '',
      'lastName': prefs.getString('lastName') ?? '',
      'employeeId': prefs.getString('employeeId') ?? 'N/A',
      'rbacRoleName': prefs.getString('rbacRoleName') ?? '',
      'role': prefs.getString('role') ?? '',
      'email': prefs.getString('email') ?? 'N/A',
      'mobileNumber': prefs.getString('mobileNumber') ?? 'N/A',
      'branchName': prefs.getString('branchName') ?? 'N/A',
    };
  }
}

class _ModuleItem {
  const _ModuleItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.danger = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool danger;
}
