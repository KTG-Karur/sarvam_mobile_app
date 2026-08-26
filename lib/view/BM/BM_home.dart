import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/controller/dashboard_controller.dart';
import 'package:sarvam/view/AM/collection_view/collection_view_hub.dart';
import 'package:sarvam/view/FDO/client_search_locate/client_search_locate.dart';
import 'package:sarvam/view/FDO/loan_disbursement/loan_disbursement.dart';
import 'package:sarvam/view/auth/role_home_router.dart';
import 'package:sarvam/widgets/punch_out_dialog.dart';
import 'package:sarvam/services/face_biometric_service.dart';

class _Metric {
  const _Metric(this.icon, this.label, this.value, [this.sub]);
  final IconData icon;
  final String label;
  final String value;
  final String? sub;
}

class BmHome extends StatefulWidget {
  const BmHome({super.key});

  @override
  State<BmHome> createState() => _BmHomeState();
}

class _BmHomeState extends State<BmHome> with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  late final DashboardController _ctrl;
  late final AnimationController _pageAnimController;
  late final Animation<double> _pageFade;
  late final Animation<Offset> _pageSlide;

  String _employeeId = '';
  String _branchName = '';
  String _userName = '';
  bool _presentToday = false;

  static const _months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];

  @override
  void initState() {
    super.initState();
    _ctrl = Get.isRegistered<DashboardController>()
        ? Get.find<DashboardController>()
        : Get.put(DashboardController());
    _pageAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );
    _pageFade = CurvedAnimation(
      parent: _pageAnimController,
      curve: Curves.easeOut,
    );
    _pageSlide = Tween<Offset>(
      begin: const Offset(0, 0.04),
      end: Offset.zero,
    ).animate(_pageFade);
    _pageAnimController.forward();
    _loadUserDetails();
    WidgetsBinding.instance.addPostFrameCallback((_) => _ctrl.getTaskDetails());
  }

  @override
  void dispose() {
    _pageAnimController.dispose();
    super.dispose();
  }

  Future<void> _loadUserDetails() async {
    final prefs = await SharedPreferences.getInstance();
    final serverPresent = await FaceBiometricService.isPresentTodayOnServer();
    if (serverPresent == true) {
      // Keep the local fallback in sync with the confirmed server punch-in.
      await prefs.setString('lastPunchInDate', todayDateKey());
    }
    if (!mounted) return;
    setState(() {
      _employeeId = prefs.getString('employeeId') ?? '';
      _branchName = prefs.getString('branchName') ?? '';
      _userName =
          '${prefs.getString('firstName') ?? ''} ${prefs.getString('lastName') ?? ''}'
              .trim();
      _presentToday = serverPresent ?? hasPunchedInToday(prefs);
    });
  }

  // ── build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: Obx(
                () => RefreshIndicator(
                  color: _green,
                  onRefresh: () async {
                    await _ctrl.getTaskDetails();
                    await _loadUserDetails();
                  },
                  child: SingleChildScrollView(
                    padding: EdgeInsets.symmetric(horizontal: 16.w),
                    physics: const AlwaysScrollableScrollPhysics(
                      parent: BouncingScrollPhysics(),
                    ),
                    child: FadeTransition(
                      opacity: _pageFade,
                      child: SlideTransition(
                        position: _pageSlide,
                        child: _buildBody(),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── header (FDO style) ─────────────────────────────────────────────────────

  Widget _buildHeader() {
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
                        horizontal: 6.w,
                        vertical: 2.h,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE8F5E9),
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      child: Text(
                        'Live',
                        style: TextStyle(
                          color: _green,
                          fontSize: 11.sp,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 2.h),
                Text(
                  'Branch performance overview',
                  style: TextStyle(fontSize: 12.5.sp, color: _muted),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          SizedBox(width: 8.w),
          // Refresh
          Obx(
            () => GestureDetector(
              onTap: _ctrl.isTaskDetailsLoading.value
                  ? null
                  : _ctrl.getTaskDetails,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _ctrl.isTaskDetailsLoading.value
                      ? SizedBox(
                          width: 22.sp,
                          height: 22.sp,
                          child: const CircularProgressIndicator(
                            color: _green,
                            strokeWidth: 2,
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
          SizedBox(width: 14.w),
          // Punch Out
          GestureDetector(
            onTap: () => PunchOutDialog.show(context),
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
      ),
    );
  }

  // ── body ──────────────────────────────────────────────────────────────────

  Widget _buildBody() {
    final data = _ctrl.taskDetails;

    if (_ctrl.isTaskDetailsLoading.value && data.isEmpty) {
      return SizedBox(
        height: 300.h,
        child: const Center(child: CircularProgressIndicator(color: _green)),
      );
    }

    if (data.isEmpty) {
      return SizedBox(
        height: 300.h,
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.dashboard_outlined, size: 48.sp, color: _muted),
              SizedBox(height: 12.h),
              Text(
                'Unable to load dashboard data.\nPull down to retry.',
                textAlign: TextAlign.center,
                style: TextStyle(color: _muted, fontSize: 14.sp),
              ),
            ],
          ),
        ),
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(height: 16.h),

        // Task Details Card
        _buildTaskCard(data),
        SizedBox(height: 20.h),

        // Targets
        _sectionLabel('TARGETS'),
        SizedBox(height: 8.h),
        _metricGrid([
          _Metric(
            Icons.person_add_alt_1_outlined,
            'New Member Target',
            _number(targets['newMemberTarget']),
          ),
          _Metric(
            Icons.refresh_rounded,
            'Renewal Target',
            _number(targets['renewalMemberTarget']),
          ),
          _Metric(
            Icons.track_changes,
            'Total Enrollment',
            _number(targets['enrollmentTarget']),
          ),
          _Metric(
            Icons.payments_outlined,
            'Loan Disbmt Target',
            _currency(targets['loanDisbursementTarget']),
          ),
        ]),
        SizedBox(height: 20.h),

        // Achievement
        _sectionLabel('ACHIEVEMENT'),
        SizedBox(height: 8.h),
        _metricGrid([
          _Metric(
            Icons.person_add_alt_1_outlined,
            'New Members',
            _number(achievement['newMember']),
            _percent(achievement['newMember'], targets['newMemberTarget']),
          ),
          _Metric(
            Icons.autorenew,
            'Renewals',
            _number(achievement['renewal']),
            _percent(achievement['renewal'], targets['renewalMemberTarget']),
          ),
          _Metric(
            Icons.monetization_on_outlined,
            'Gold Loans',
            _number(achievement['goldLoan']),
          ),
          _Metric(
            Icons.trending_up,
            'Disbmt Amount',
            _currency(achievement['disbursementAmount']),
            _percent(
              achievement['disbursementAmount'],
              targets['loanDisbursementTarget'],
            ),
          ),
        ]),
        SizedBox(height: 20.h),

        // Collection vs Arrears
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(child: _collectionCard(actualCollection, difference)),
            SizedBox(width: 12.w),
            Expanded(child: _arrearsCard(arrear)),
          ],
        ),
        SizedBox(height: 20.h),

        // PAR
        _parCard(par, arrear['arrearClients'], operations['activeClients']),
        SizedBox(height: 20.h),

        // Operations
        _sectionLabel('OPERATIONS'),
        SizedBox(height: 8.h),
        _operationsGrid(operations),
        SizedBox(height: 20.h),

        // Gold Loan
        _sectionLabel('GOLD LOAN'),
        SizedBox(height: 8.h),
        _metricGrid([
          _Metric(
            Icons.people_outline,
            'Clients',
            _number(goldLoan['numberOfMembers']),
          ),
          _Metric(
            Icons.account_balance_wallet_outlined,
            'Disbmt Amount',
            _currency(goldLoan['disbursementAmount']),
          ),
          _Metric(
            Icons.assignment_return_outlined,
            'Returns',
            _number(goldLoan['goldReturn']),
          ),
        ]),
        SizedBox(height: 20.h),

        // Portfolio Outstanding
        _sectionLabel('PORTFOLIO OUTSTANDING'),
        SizedBox(height: 8.h),
        _metricGrid([
          _Metric(
            Icons.account_balance_wallet_outlined,
            'Principal O/S',
            _currency(portfolio['principalOutstanding']),
          ),
          _Metric(
            Icons.currency_rupee,
            'Interest O/S',
            _currency(portfolio['interestOutstanding']),
          ),
        ]),
        SizedBox(height: 16.h),

        // Outstanding Balance Card
        _outstandingCard(portfolio),
        SizedBox(height: 24.h),

        // Shortcuts
        _sectionLabel('QUICK ACCESS'),

        SizedBox(height: 10.h),
        _shortcutRow2(),
        SizedBox(height: 20.h),
      ],
    );
  }

  // ── Task Details Card ──────────────────────────────────────────────────────

  Widget _buildTaskCard(Map<String, dynamic> data) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.01),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'TASK DETAILS',
                  style: TextStyle(
                    fontSize: 11.5.sp,
                    fontWeight: FontWeight.bold,
                    color: _green,
                    letterSpacing: 0.5,
                  ),
                ),
                SizedBox(height: 4.h),
                Text(
                  '${_months[DateTime.now().month - 1]} ${DateTime.now().year}'
                  '${_userName.isEmpty ? '' : '  —  $_userName'}',
                  style: TextStyle(
                    fontSize: 15.5.sp,
                    fontWeight: FontWeight.bold,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 6.h),
                Wrap(
                  spacing: 12.w,
                  runSpacing: 4.h,
                  children: [
                    _taskInfo(
                      Icons.badge_outlined,
                      'ID: ${_employeeId.isEmpty ? '—' : _employeeId}',
                    ),
                    _taskInfo(
                      Icons.account_tree_outlined,
                      _branchName.isEmpty ? 'Branch: —' : _branchName,
                    ),
                  ],
                ),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
            decoration: BoxDecoration(
              color: _presentToday ? _green : const Color(0xFFB45309),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Text(
              _presentToday ? 'Present' : 'Not Punched',
              style: TextStyle(
                color: Colors.white,
                fontSize: 11.sp,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _taskInfo(IconData icon, String value) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 13.sp, color: const Color(0xFF4B8A68)),
      SizedBox(width: 4.w),
      Text(
        value,
        style: TextStyle(
          fontSize: 11.5.sp,
          color: const Color(0xFF4B8A68),
          fontWeight: FontWeight.w600,
        ),
      ),
    ],
  );

  // ── Section label ──────────────────────────────────────────────────────────

  Widget _sectionLabel(String title) => Text(
    title,
    style: TextStyle(
      fontSize: 12.5.sp,
      fontWeight: FontWeight.bold,
      color: _green,
      letterSpacing: 0.5,
    ),
  );

  // ── Metric grid ────────────────────────────────────────────────────────────

  Widget _metricGrid(List<_Metric> metrics) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: metrics.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        crossAxisSpacing: 8.w,
        mainAxisSpacing: 8.h,
        childAspectRatio: 2.2,
      ),
      itemBuilder: (_, i) => _metricCard(metrics[i]),
    );
  }

  Widget _metricCard(_Metric m) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(6.w),
            decoration: const BoxDecoration(
              color: Color(0xFFE8F5E9),
              shape: BoxShape.circle,
            ),
            child: Icon(m.icon, color: _green, size: 14.sp),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  m.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 9.5.sp, color: _muted),
                ),
                SizedBox(height: 2.h),
                Text(
                  m.value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.bold,
                    color: _darkText,
                  ),
                ),
                if (m.sub != null) ...[
                  SizedBox(height: 1.h),
                  Text(
                    m.sub!,
                    style: TextStyle(
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
  }

  // ── Collection / Arrears cards ─────────────────────────────────────────────

  Widget _collectionCard(double actual, double diff) {
    final onTarget = actual >= 100;
    final ac = onTarget ? _green : Colors.red;
    final dc = diff >= 0 ? _green : Colors.red;
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionLabel('COLLECTION'),
          SizedBox(height: 12.h),
          _tableRow(Icons.track_changes, _green, 'Target', '100%', _green),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _tableRow(
            Icons.show_chart,
            ac,
            'Actual',
            '${actual.toStringAsFixed(1)}%',
            ac,
          ),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _tableRow(
            Icons.percent,
            dc,
            'Difference',
            '${diff >= 0 ? '+' : ''}${diff.toStringAsFixed(1)}%',
            dc,
          ),
        ],
      ),
    );
  }

  Widget _arrearsCard(Map<String, dynamic> arrear) {
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _sectionLabel('ARREARS'),
          SizedBox(height: 12.h),
          _tableRow(
            Icons.warning_amber_rounded,
            Colors.red,
            'Arrear Clients',
            _number(arrear['arrearClients']),
            _darkText,
          ),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _tableRow(
            Icons.currency_rupee,
            Colors.red,
            'Principal',
            _currency(arrear['arrearPrincipal']),
            _darkText,
          ),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _tableRow(
            Icons.percent,
            Colors.red,
            'Interest',
            _currency(arrear['arrearInterest']),
            _darkText,
          ),
        ],
      ),
    );
  }

  Widget _tableRow(
    IconData icon,
    Color iconColor,
    String label,
    String value,
    Color valueColor,
  ) {
    return Row(
      children: [
        Container(
          padding: EdgeInsets.all(4.w),
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: iconColor, size: 13.sp),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11.5.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 13.5.sp,
            fontWeight: FontWeight.bold,
            color: valueColor,
          ),
        ),
      ],
    );
  }

  // ── PAR card ───────────────────────────────────────────────────────────────

  Widget _parCard(double par, dynamic arrearClients, dynamic activeClients) {
    final c = par >= 20
        ? Colors.red
        : par >= 10
        ? Colors.orange
        : _green;
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'PAR (Portfolio At Risk)',
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.bold,
                  color: _muted,
                ),
              ),
              Text(
                '${par.toStringAsFixed(1)}%',
                style: TextStyle(
                  fontSize: 13.5.sp,
                  fontWeight: FontWeight.bold,
                  color: c,
                ),
              ),
            ],
          ),
          SizedBox(height: 12.h),
          ClipRRect(
            borderRadius: BorderRadius.circular(4.r),
            child: Container(
              height: 8.h,
              width: double.infinity,
              color: const Color(0xFFE8F5E9),
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: (par / 100).clamp(0.0, 1.0),
                child: Container(color: c),
              ),
            ),
          ),
          SizedBox(height: 8.h),
          Text(
            '${_number(arrearClients)} of ${_number(activeClients)} clients in arrears',
            style: TextStyle(fontSize: 11.5.sp, color: _muted),
          ),
        ],
      ),
    );
  }

  // ── Operations grid ────────────────────────────────────────────────────────

  Widget _operationsGrid(Map<String, dynamic> ops) {
    return Row(
      children: [
        Expanded(
          child: Column(
            children: [
              _opsCard(
                Icons.apartment,
                'No. of Centers',
                _number(ops['numberOfCenters']),
                _green,
                const Color(0xFFE8F5E9),
              ),
              SizedBox(height: 8.h),
              _opsCard(
                Icons.person_outline,
                'Active Members',
                _number(ops['activeMembers']),
                _green,
                const Color(0xFFE8F5E9),
              ),
            ],
          ),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Column(
            children: [
              _opsCard(
                Icons.groups_outlined,
                'Active (Total)',
                _number(ops['activeClients']),
                _green,
                const Color(0xFFE8F5E9),
              ),
              SizedBox(height: 8.h),
              _opsCard(
                Icons.currency_rupee,
                'Disbmt Clients',
                _number(ops['totalDisbursementMembers']),
                _green,
                const Color(0xFFE8F5E9),
              ),
            ],
          ),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Column(
            children: [
              _opsCard(
                Icons.person_rounded,
                'Active Clients',
                _number(ops['activeClientsWithLoan']),
                _green,
                const Color(0xFFE8F5E9),
              ),
              SizedBox(height: 8.h),
              _opsCard(
                Icons.trending_up,
                'Disbmt Amount',
                _currency(ops['totalDisbursementAmount']),
                const Color(0xFFB45309),
                const Color(0xFFFEF3C7),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _opsCard(
    IconData icon,
    String label,
    String value,
    Color iconColor,
    Color bg,
  ) {
    return Container(
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(6.w),
            decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
            child: Icon(icon, color: iconColor, size: 14.sp),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 9.5.sp, color: _muted),
                ),
                SizedBox(height: 2.h),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.bold,
                    color: _darkText,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Outstanding Balance ────────────────────────────────────────────────────

  Widget _outstandingCard(Map<String, dynamic> portfolio) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.01),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          Container(
            height: 4.h,
            width: double.infinity,
            color: const Color(0xFFD97706),
          ),
          Padding(
            padding: EdgeInsets.all(16.w),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.w),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFEF3C7),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.wallet_outlined,
                    color: const Color(0xFFB45309),
                    size: 20.sp,
                  ),
                ),
                SizedBox(width: 14.w),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Outstanding Balance',
                      style: TextStyle(
                        fontSize: 13.5.sp,
                        color: _muted,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      _currency(portfolio['principalOutstanding']),
                      style: TextStyle(
                        fontSize: 20.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFFB45309),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Shortcut rows ──────────────────────────────────────────────────────────

  /// Row 1 — BM-exclusive approval workflows

  /// Row 2 — Disbursement + collection
  Widget _shortcutRow2() {
    return Row(
      children: [
        SizedBox(width: 10.w),
        Expanded(
          child: _tile(
            asset: 'assets/icon/client_update.png',
            label: 'View\nCollections',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const CollectionViewHub(isBranchManager: true),
              ),
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: _tile(
            asset: 'assets/icon/loan_disbursement.png',
            label: 'Loan\nDisbursement',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const LoanDisbursement(isBranchManager: true),
              ),
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: _tile(
            asset: 'assets/icon/location.png',
            label: 'Location',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const ClientSearchLocate()),
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: _tile(
            asset: 'assets/icon/profile.png',
            label: 'Profile',
            onTap: () => _showProfileSheet(context),
          ),
        ),
      ],
    );
  }


  Widget _tile({
    required String asset,
    required String label,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14.r),
        child: Container(
          height: 132.h,
          padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 12.h),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFE8F0EB)),
            borderRadius: BorderRadius.circular(14.r),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              SizedBox(
                height: 72.h,
                child: Image.asset(asset, fit: BoxFit.contain),
              ),
              Text(
                label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.5.sp,
                  fontWeight: FontWeight.bold,
                  color: _green,
                  height: 1.15,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : {};

  double _num(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('${value ?? 0}') ?? 0;

  String _percent(dynamic value, dynamic target) {
    final denominator = _num(target);
    if (denominator == 0) return _num(value) > 0 ? '—' : '0%';
    return '${((_num(value) / denominator) * 100).round()}%';
  }

  String _number(dynamic value) =>
      NumberFormat.decimalPattern('en_IN').format((value as num?) ?? 0);

  String _currency(dynamic value) => NumberFormat.compactCurrency(
    locale: 'en_IN',
    symbol: '₹',
    decimalDigits: 1,
  ).format((value as num?) ?? 0);

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

  Widget _buildProfileRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 22.sp, color: _muted),
        SizedBox(width: 14.w),
        Text(
          label,
          style: TextStyle(
            fontSize: 14.sp,
            color: _muted,
            fontWeight: FontWeight.w500,
          ),
        ),
        const Spacer(),
        Text(
          value,
          style: TextStyle(
            fontSize: 14.sp,
            color: _darkText,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  void _showProfileSheet(BuildContext context) {
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
                  data['rbacRoleName'] ?? (data['role'] ?? 'Branch Manager');
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
                          style: TextStyle(
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
                              style: TextStyle(
                                fontSize: 19.sp,
                                fontWeight: FontWeight.bold,
                                color: _darkText,
                              ),
                            ),
                            SizedBox(height: 3.h),
                            Text(
                              role,
                              style: TextStyle(
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
                      onPressed: () async {
                        Navigator.pop(context);
                        final AuthController authController =
                            Get.isRegistered<AuthController>()
                                ? Get.find<AuthController>()
                                : Get.put(AuthController());
                        authController.confirmLogout(context);
                      },
                      child: Text(
                        'Logout',
                        style: TextStyle(
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
}
