import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/controller/admin/admin_dashboard_controller.dart';
import 'package:sarvam/services/excel_export_service.dart';
import 'package:sarvam/view/ADMIN/masters/funder_list.dart';
import 'package:sarvam/view/ADMIN/masters/gl_list.dart';
import 'package:sarvam/view/ADMIN/masters/loan_products_list.dart';
import 'package:sarvam/view/ADMIN/masters/loan_purposes_list.dart';
import 'package:sarvam/view/ADMIN/masters/economic_activities_list.dart';
import 'package:sarvam/view/ADMIN/masters/meeting_places_list.dart';
import 'package:sarvam/view/ADMIN/accounts/accounts_overview.dart';
import 'package:sarvam/view/ADMIN/transactions/transaction_management.dart';
import 'package:sarvam/view/ADMIN/eod/eod_execution.dart';
import 'package:sarvam/view/ADMIN/settings/profile_settings.dart';
import 'package:sarvam/view/ADMIN/reports/admin_reports_overview.dart';
import 'package:sarvam/view/ADMIN/roles/role_list.dart';
import 'package:sarvam/view/ADMIN/users/user_list.dart';
import 'package:sarvam/view/ADMIN/module_directory_screen.dart';
import 'package:sarvam/view/ADMIN/branches/branch_list.dart';
import 'package:sarvam/view/ADMIN/branches/hub_management_screen.dart';
import 'package:sarvam/view/ADMIN/branches/product_map_screen.dart';
import 'package:sarvam/view/ADMIN/branches/extend_branch_lock_screen.dart';
import 'package:sarvam/view/BM/member_approval.dart';
import 'package:sarvam/view/BM/centre_approval.dart';
import 'package:sarvam/view/BM/final_disbursement/final_disbursement.dart';
import 'package:sarvam/view/FDO/client_search_locate/client_search_locate.dart';
import 'package:sarvam/view/auth/login_screen.dart';

class AdminHome extends StatefulWidget {
  const AdminHome({super.key});

  @override
  State<AdminHome> createState() => _AdminHomeState();
}

class _AdminHomeState extends State<AdminHome>
    with SingleTickerProviderStateMixin {
  // Color palette
  static const _primaryGreen = Color(0xFF0D6842);
  static const _primaryGreenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  // Animation controllers
  late AnimationController _mainController;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;
  late Animation<Offset> _slideAnimation;

  int _selectedTab = 0; // 0: Operational Dashboard, 1: Admin Console
  final AdminDashboardController _dashController = Get.put(
    AdminDashboardController(),
  );
  bool _roleChecked = false;
  AppRole _role = AppRole.unknown;

  // Keys for staggered animations
  final List<GlobalKey> _sectionKeys = List.generate(18, (_) => GlobalKey());

  DataColumn _buildDataColumn(String label) {
    return DataColumn(
      label: Flexible(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontWeight: FontWeight.w700,
              fontSize: 11.sp,
            ),
          ),
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();

    // Initialize main animation controller
    _mainController = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );

    _fadeAnimation = CurvedAnimation(
      parent: _mainController,
      curve: Curves.easeOut,
    );

    _scaleAnimation = Tween<double>(begin: 0.96, end: 1.0).animate(
      CurvedAnimation(parent: _mainController, curve: Curves.easeOutCubic),
    );

    _slideAnimation = Tween<Offset>(begin: Offset(0, 0.4), end: Offset.zero)
        .animate(
          CurvedAnimation(parent: _mainController, curve: Curves.easeOutCubic),
        );

    // Check role and start animation
    RoleScope.current().then((role) {
      if (!mounted) return;
      setState(() {
        _role = role;
        _roleChecked = true;
      });
      _mainController.forward();
    });
  }

  @override
  void dispose() {
    _mainController.dispose();
    super.dispose();
  }

  bool get _isAdmin => _role == AppRole.admin;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      drawer: _buildAdminDrawer(),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: _roleChecked && !_isAdmin
                  ? _buildAccessDenied()
                  : FadeTransition(
                      opacity: _fadeAnimation,
                      child: SlideTransition(
                        position: _slideAnimation,
                        child: ScaleTransition(
                          scale: _scaleAnimation,
                          child: _buildMainContent(),
                        ),
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }

  // ============== MAIN CONTENT ==============
  Widget _buildMainContent() {
    if (!_roleChecked) {
      return const Center(
        child: CircularProgressIndicator(color: _primaryGreen, strokeWidth: 3),
      );
    }

    return RefreshIndicator(
      color: _primaryGreen,
      onRefresh: () async {
        await _dashController.reloadDashboard();
      },
      child: SingleChildScrollView(
        physics: const BouncingScrollPhysics(
          parent: AlwaysScrollableScrollPhysics(),
        ),
        padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildGreetingSection(),
            _buildSegmentedTabSelector(),
            SizedBox(height: 12.h),

            _selectedTab == 0
                ? _buildOperationalDashboardView()
                : _buildAdminConsoleView(),

            SizedBox(height: 20.h),
            _buildFooter(),
          ],
        ),
      ),
    );
  }

  // ============== MODE SWITCHER TAB SELECTOR ==============
  Widget _buildSegmentedTabSelector() {
    return Container(
      margin: EdgeInsets.symmetric(vertical: 12.h),
      padding: EdgeInsets.all(4.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedTab = 0),
              child: Container(
                padding: EdgeInsets.symmetric(vertical: 10.h),
                decoration: BoxDecoration(
                  color: _selectedTab == 0 ? _primaryGreen : Colors.transparent,
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.dashboard_rounded,
                      size: 16.sp,
                      color: _selectedTab == 0 ? Colors.white : _muted,
                    ),
                    SizedBox(width: 6.w),
                    Text(
                      'Dashboard',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w700,
                        color: _selectedTab == 0 ? Colors.white : _muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedTab = 1),
              child: Container(
                padding: EdgeInsets.symmetric(vertical: 10.h),
                decoration: BoxDecoration(
                  color: _selectedTab == 1 ? _primaryGreen : Colors.transparent,
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.admin_panel_settings_rounded,
                      size: 16.sp,
                      color: _selectedTab == 1 ? Colors.white : _muted,
                    ),
                    SizedBox(width: 6.w),
                    Text(
                      'Admin Console',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w700,
                        color: _selectedTab == 1 ? Colors.white : _muted,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ============== 1. OPERATIONAL DASHBOARD VIEW ==============
  Widget _buildOperationalDashboardView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildDashboardRoleFilterSelector(),
        SizedBox(height: 14.h),
        _buildTaskDetailsSection(),
        SizedBox(height: 16.h),
        _buildStatCardsGridSection(),
        SizedBox(height: 16.h),
        _buildExecutiveCollectionWidget(),
        SizedBox(height: 16.h),
        _buildOperationsApprovalsGrid(),
        SizedBox(height: 16.h),
        _buildDemandCollectionTableWidget(),
        SizedBox(height: 16.h),
        _buildLoanIndexTableWidget(),
        SizedBox(height: 16.h),
        _buildEodStatusTableWidget(),
        SizedBox(height: 16.h),
        _buildOfficerLoanTableWidget(),
        SizedBox(height: 16.h),
        _buildBranchLeaderboardWidget(),
      ],
    );
  }

  Widget _buildDashboardRoleFilterSelector() {
    final roles = ['Admin', 'AM', 'BM', 'FDO'];
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Text(
                    'View by: ',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      color: _muted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Obx(() {
                    return Row(
                      mainAxisSize: MainAxisSize.min,
                      children: roles.map((r) {
                        final isSel = _dashController.selectedRole.value == r;
                        return GestureDetector(
                          onTap: () => _dashController.selectedRole.value = r,
                          child: Container(
                            margin: EdgeInsets.only(right: 6.w),
                            padding: EdgeInsets.symmetric(
                              horizontal: 8.w,
                              vertical: 4.h,
                            ),
                            decoration: BoxDecoration(
                              color: isSel
                                  ? _primaryGreen
                                  : const Color(0xFFF1F5F9),
                              borderRadius: BorderRadius.circular(8.r),
                            ),
                            child: Text(
                              r,
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                fontWeight: isSel
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                                color: isSel ? Colors.white : _muted,
                              ),
                            ),
                          ),
                        );
                      }).toList(),
                    );
                  }),
                ],
              ),
            ),
          ),
          SizedBox(width: 6.w),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
            decoration: BoxDecoration(
              color: const Color(0xFFDCFCE7),
              borderRadius: BorderRadius.circular(6.r),
            ),
            child: Text(
              '1 FDOs',
              style: GoogleFonts.inter(
                fontSize: 10.sp,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF166534),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTaskDetailsSection() {
    return Obx(() {
      return Container(
        padding: EdgeInsets.all(14.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          border: Border.all(color: const Color(0xFFE2E8F0)),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 10),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'TASK DETAILS — ${DateTime.now().month == 8 ? 'Aug 2026' : 'System Overview'}',
              style: GoogleFonts.inter(
                fontSize: 11.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
                letterSpacing: 0.5,
              ),
            ),
            SizedBox(height: 10.h),

            // TARGETS & ACHIEVEMENTS
            _buildSectionSubtitle('TARGETS & ACHIEVEMENT'),
            SizedBox(height: 6.h),
            Row(
              children: [
                Expanded(
                  child: _buildSmallKpiCard(
                    'New Member Target',
                    '${_dashController.newMemberTarget.value}',
                    Icons.person_add_outlined,
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Achieved Members',
                    '${_dashController.newMembersAchievement.value}',
                    Icons.how_to_reg_rounded,
                    color: const Color(0xFF166534),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Disbmt Target',
                    '₹0',
                    Icons.payments_outlined,
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),

            // OPERATIONS & GOLD LOAN
            _buildSectionSubtitle('OPERATIONS & GOLD LOANS'),
            SizedBox(height: 6.h),
            Row(
              children: [
                Expanded(
                  child: _buildSmallKpiCard(
                    'No. of Centers',
                    '${_dashController.noOfCenters.value}',
                    Icons.pin_drop_rounded,
                    color: const Color(0xFF1E3A8A),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Active Members',
                    '${_dashController.activeMembers.value}',
                    Icons.group_rounded,
                    color: const Color(0xFF0D6842),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Active Clients',
                    '${_dashController.activeClients.value}',
                    Icons.person_rounded,
                    color: const Color(0xFF7C3AED),
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),

            // COLLECTION & PORTFOLIO OS
            _buildSectionSubtitle('COLLECTION & PORTFOLIO OUTSTANDING'),
            SizedBox(height: 6.h),
            Row(
              children: [
                Expanded(
                  child: _buildSmallKpiCard(
                    'Target Coll',
                    '${_dashController.collectionTargetPct.value}%',
                    Icons.flag_rounded,
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Actual Coll',
                    '${_dashController.collectionActualPct.value}%',
                    Icons.show_chart_rounded,
                    color: const Color(0xFFDC2626),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Principal O/S',
                    '₹${(_dashController.principalOs.value / 1000).toStringAsFixed(1)}K',
                    Icons.account_balance_wallet_rounded,
                    color: const Color(0xFF0284C7),
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: _buildSmallKpiCard(
                    'Interest O/S',
                    '₹${(_dashController.interestOs.value / 1000).toStringAsFixed(1)}K',
                    Icons.savings_rounded,
                    color: const Color(0xFFB45309),
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),

            // PAR (Portfolio At Risk)
            _buildSectionSubtitle('PAR (PORTFOLIO AT RISK)'),
            SizedBox(height: 6.h),
            Container(
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: const Color(0xFFFEF2F2),
                borderRadius: BorderRadius.circular(10.r),
                border: Border.all(color: const Color(0xFFFCA5A5)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '1 of 9 members/clients in arrears',
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF991B1B),
                        ),
                      ),
                      Text(
                        'PAR: ${_dashController.parPct.value}%',
                        style: GoogleFonts.inter(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFFDC2626),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 6.h),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4.r),
                    child: LinearProgressIndicator(
                      value: _dashController.parPct.value / 100.0,
                      minHeight: 6.h,
                      backgroundColor: const Color(0xFFFEE2E2),
                      valueColor: const AlwaysStoppedAnimation<Color>(
                        Color(0xFFDC2626),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildSectionSubtitle(String title) {
    return Text(
      title,
      style: GoogleFonts.inter(
        fontSize: 9.sp,
        fontWeight: FontWeight.w700,
        color: _muted,
        letterSpacing: 0.8,
      ),
    );
  }

  Widget _buildSmallKpiCard(
    String label,
    String val,
    IconData icon, {
    Color color = _darkText,
  }) {
    return Container(
      padding: EdgeInsets.all(8.w),
      decoration: BoxDecoration(
        color: _lightBg,
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 12.sp, color: _muted),
              SizedBox(width: 4.w),
              Expanded(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 9.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 4.h),
          Text(
            val,
            style: GoogleFonts.inter(
              fontSize: 12.sp,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatCardsGridSection() {
    return Obx(() {
      final stats = [
        {
          'title': 'No of Centers',
          'val': '${_dashController.noOfCenters.value}',
          'icon': Icons.pin_drop_rounded,
        },
        {
          'title': 'Total Groups',
          'val': '${_dashController.totalGroups.value}',
          'icon': Icons.group_work_rounded,
        },
        {
          'title': 'Total Members',
          'val': '${_dashController.totalMembers.value}',
          'icon': Icons.people_rounded,
        },
        {
          'title': 'Active Members',
          'val': '${_dashController.activeMembers.value}',
          'icon': Icons.person_sharp,
        },
        {
          'title': 'Rejected Members',
          'val': '${_dashController.rejectedMembers.value}',
          'icon': Icons.person_off_rounded,
        },
        {
          'title': 'Total Staff',
          'val': '${_dashController.totalStaff.value}',
          'icon': Icons.badge_rounded,
        },
        {
          'title': 'Total Funder',
          'val': '${_dashController.totalFunders.value}',
          'icon': Icons.account_balance_rounded,
        },
        {
          'title': 'Loan Disbursement',
          'val':
              '₹${_dashController.loanDisbursementTotal.value.toStringAsFixed(0)}',
          'icon': Icons.trending_up_rounded,
        },
        {
          'title': 'Outstanding Balance',
          'val':
              '₹${_dashController.outstandingBalanceTotal.value.toStringAsFixed(0)}',
          'icon': Icons.account_balance_wallet_rounded,
        },
        {
          'title': 'Highmark Checked',
          'val': '${_dashController.highmarkChecked.value}',
          'icon': Icons.verified_rounded,
        },
      ];

      return GridView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 10.w,
          mainAxisSpacing: 10.h,
          childAspectRatio: 2.2,
        ),
        itemCount: stats.length,
        itemBuilder: (context, index) {
          final item = stats[index];
          return Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12.r),
              boxShadow: [
                BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 6),
              ],
            ),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.w),
                  decoration: BoxDecoration(
                    color: _primaryGreen.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                  child: Icon(
                    item['icon'] as IconData,
                    color: _primaryGreen,
                    size: 16.sp,
                  ),
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        item['title'] as String,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.inter(
                          fontSize: 10.sp,
                          color: _muted,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        item['val'] as String,
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      );
    });
  }

  Widget _buildDemandCollectionTableWidget() {
    return Obx(() {
      final rows = _dashController.demandCollectionRows;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 8),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(12.w),
              decoration: const BoxDecoration(
                color: _primaryGreen,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.bar_chart_rounded,
                    color: Colors.white,
                    size: 18.sp,
                  ),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Demand Collection Details',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          'Group-wise demand vs collection',
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: Colors.white.withOpacity(0.8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton.icon(
                    onPressed: () {
                      ExcelExportService.exportToCsv(
                        title: 'Demand_Collection_Details',
                        headers: [
                          'Date',
                          'Day',
                          'Groups',
                          'Members',
                          'Principal Demand',
                          'Interest Demand',
                          'Total Demand',
                          'Actual Coll',
                          'Yet To Collect',
                          'Arrear Due',
                        ],
                        rows: rows
                            .map(
                              (r) => [
                                r['date'] ?? '',
                                r['day'] ?? '',
                                r['groups'] ?? 0,
                                r['members'] ?? 0,
                                r['pDemand'] ?? 0,
                                r['iDemand'] ?? 0,
                                r['totalDemand'] ?? 0,
                                r['actualColl'] ?? 0,
                                r['yetToCollect'] ?? 0,
                                r['arrearDue'] ?? 0,
                              ],
                            )
                            .toList(),
                      );
                    },
                    icon: Icon(
                      Icons.file_download_outlined,
                      size: 13.sp,
                      color: _primaryGreen,
                    ),
                    label: Text(
                      'Export Excel',
                      style: GoogleFonts.inter(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w700,
                        color: _primaryGreen,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      elevation: 0,
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 4.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 14.w,
                headingRowHeight: 40.h,
                dataRowHeight: 44.h,
                columns: [
                  _buildDataColumn('Date'),
                  _buildDataColumn('Day'),
                  _buildDataColumn('Groups'),
                  _buildDataColumn('Demand'),
                  _buildDataColumn('Coll'),
                  _buildDataColumn('Yet Coll'),
                  _buildDataColumn('Arrear'),
                ],
                rows: rows.map((r) {
                  return DataRow(
                    cells: [
                      DataCell(
                        Text(
                          '${r['date'] ?? ''}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['day'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['groups'] ?? 0}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${r['totalDemand']}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                            color: _primaryGreen,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${r['actualColl']}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${r['yetToCollect']}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            color: (r['yetToCollect'] as num? ?? 0) > 0
                                ? const Color(0xFFD97706)
                                : _darkText,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${r['arrearDue']}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            color: (r['arrearDue'] as num? ?? 0) > 0
                                ? const Color(0xFFDC2626)
                                : _darkText,
                          ),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildLoanIndexTableWidget() {
    return Obx(() {
      final rows = _dashController.loanIndexRows;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 8),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(12.w),
              decoration: const BoxDecoration(
                color: _primaryGreen,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.assignment_rounded,
                    color: Colors.white,
                    size: 18.sp,
                  ),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Loan Index Details',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          'Recent loan indexes & disbursement summary',
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: Colors.white.withOpacity(0.8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton.icon(
                    onPressed: () {
                      ExcelExportService.exportToCsv(
                        title: 'Loan_Index_Details',
                        headers: [
                          'Index No',
                          'Date',
                          'Status',
                          'Branch',
                          'Center',
                          'Loan Amount',
                          'Principal Pd',
                          'Interest Pd',
                          'Members',
                        ],
                        rows: rows
                            .map(
                              (r) => [
                                r['indexNo'] ?? '',
                                r['date'] ?? '',
                                r['status'] ?? '',
                                r['branch'] ?? '',
                                r['center'] ?? '',
                                r['loanAmt'] ?? 0,
                                r['principalPd'] ?? 0,
                                r['interestPd'] ?? 0,
                                r['members'] ?? '',
                              ],
                            )
                            .toList(),
                      );
                    },
                    icon: Icon(
                      Icons.file_download_outlined,
                      size: 13.sp,
                      color: _primaryGreen,
                    ),
                    label: Text(
                      'Export Excel',
                      style: GoogleFonts.inter(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w700,
                        color: _primaryGreen,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      elevation: 0,
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 4.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 12.w,
                headingRowHeight: 40.h,
                dataRowHeight: 44.h,
                columns: [
                  _buildDataColumn('Index No'),
                  _buildDataColumn('Date'),
                  _buildDataColumn('Status'),
                  _buildDataColumn('Branch'),
                  _buildDataColumn('Center'),
                  _buildDataColumn('Loan Amt'),
                  _buildDataColumn('Members'),
                ],
                rows: rows.map((r) {
                  return DataRow(
                    cells: [
                      DataCell(
                        Text(
                          '${r['indexNo'] ?? ''}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['date'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 3.h,
                          ),
                          decoration: BoxDecoration(
                            color: (r['status'] == 'Fully Disbursed'
                                ? const Color(0xFFDCFCE7)
                                : const Color(0xFFFEF3C7)),
                            borderRadius: BorderRadius.circular(6.r),
                          ),
                          child: Text(
                            '${r['status'] ?? ''}',
                            style: GoogleFonts.inter(
                              fontSize: 10.sp,
                              fontWeight: FontWeight.w700,
                              color: r['status'] == 'Fully Disbursed'
                                  ? const Color(0xFF166534)
                                  : const Color(0xFFD97706),
                            ),
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['branch'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['center'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${(r['loanAmt'] as num?)?.toStringAsFixed(0)}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                            color: _primaryGreen,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['members'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildEodStatusTableWidget() {
    return Obx(() {
      final rows = _dashController.eodStatusRows;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 8),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(12.w),
              decoration: const BoxDecoration(
                color: _primaryGreen,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.event_repeat_rounded,
                    color: Colors.white,
                    size: 18.sp,
                  ),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'End of Day Status',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          'Branch daily cash and bank balance summary',
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: Colors.white.withOpacity(0.8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton.icon(
                    onPressed: () {
                      ExcelExportService.exportToCsv(
                        title: 'End_Of_Day_Status',
                        headers: [
                          'Branch',
                          'EOD Date',
                          'Cash Opening',
                          'Cash Closing',
                          'Bank Opening',
                          'Bank Closing',
                          'EOD Status',
                          'Manager',
                        ],
                        rows: rows
                            .map(
                              (r) => [
                                r['branch'] ?? '',
                                r['eodDate'] ?? '',
                                r['cashOpening'] ?? 0,
                                r['cashClosing'] ?? 0,
                                r['bankOpening'] ?? 0,
                                r['bankClosing'] ?? 0,
                                r['eodStatus'] ?? '',
                                r['manager'] ?? '',
                              ],
                            )
                            .toList(),
                      );
                    },
                    icon: Icon(
                      Icons.file_download_outlined,
                      size: 13.sp,
                      color: _primaryGreen,
                    ),
                    label: Text(
                      'Export Excel',
                      style: GoogleFonts.inter(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w700,
                        color: _primaryGreen,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      elevation: 0,
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 4.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 14.w,
                headingRowHeight: 40.h,
                dataRowHeight: 44.h,
                columns: [
                  _buildDataColumn('Branch'),
                  _buildDataColumn('EOD Date'),
                  _buildDataColumn('Cash Closing'),
                  _buildDataColumn('Status'),
                  _buildDataColumn('Manager'),
                ],
                rows: rows.map((r) {
                  return DataRow(
                    cells: [
                      DataCell(
                        Text(
                          '${r['branch'] ?? ''}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['eodDate'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${(r['cashClosing'] as num?)?.toStringAsFixed(0)}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                            color: _primaryGreen,
                          ),
                        ),
                      ),
                      DataCell(
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 3.h,
                          ),
                          decoration: BoxDecoration(
                            color: (r['eodStatus'] == 'In Progress'
                                ? const Color(0xFFDBEAFE)
                                : const Color(0xFFFEF3C7)),
                            borderRadius: BorderRadius.circular(6.r),
                          ),
                          child: Text(
                            '${r['eodStatus'] ?? ''}',
                            style: GoogleFonts.inter(
                              fontSize: 10.sp,
                              fontWeight: FontWeight.w700,
                              color: r['eodStatus'] == 'In Progress'
                                  ? const Color(0xFF1E3A8A)
                                  : const Color(0xFFD97706),
                            ),
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['manager'] ?? ''}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildOfficerLoanTableWidget() {
    return Obx(() {
      final rows = _dashController.officerLoanRows;
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(color: Colors.black.withOpacity(0.03), blurRadius: 8),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(12.w),
              decoration: const BoxDecoration(
                color: _primaryGreen,
                borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
              ),
              child: Row(
                children: [
                  Icon(Icons.badge_rounded, color: Colors.white, size: 18.sp),
                  SizedBox(width: 8.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Officer Loan Details',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          'Published loan issue & OLB balance per FDO',
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: Colors.white.withOpacity(0.8),
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton.icon(
                    onPressed: () {
                      ExcelExportService.exportToCsv(
                        title: 'Officer_Loan_Details',
                        headers: [
                          'Officer Name',
                          'Groups',
                          'Members',
                          'Active Members',
                          'Published Total',
                          'OLB Total',
                        ],
                        rows: rows
                            .map(
                              (r) => [
                                r['officerName'] ?? '',
                                r['groups'] ?? 0,
                                r['members'] ?? 0,
                                r['active'] ?? 0,
                                r['publishedTotal'] ?? 0,
                                r['olbTotal'] ?? 0,
                              ],
                            )
                            .toList(),
                      );
                    },
                    icon: Icon(
                      Icons.file_download_outlined,
                      size: 13.sp,
                      color: _primaryGreen,
                    ),
                    label: Text(
                      'Export Excel',
                      style: GoogleFonts.inter(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w700,
                        color: _primaryGreen,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      elevation: 0,
                      padding: EdgeInsets.symmetric(
                        horizontal: 8.w,
                        vertical: 4.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: DataTable(
                columnSpacing: 14.w,
                headingRowHeight: 40.h,
                dataRowHeight: 44.h,
                columns: [
                  _buildDataColumn('Officer Name'),
                  _buildDataColumn('Groups'),
                  _buildDataColumn('Members'),
                  _buildDataColumn('Disbursed Total'),
                  _buildDataColumn('OLB Total'),
                ],
                rows: rows.map((r) {
                  return DataRow(
                    cells: [
                      DataCell(
                        Text(
                          '${r['officerName'] ?? ''}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['groups']}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '${r['members']}',
                          style: GoogleFonts.inter(fontSize: 11.sp),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${(r['publishedTotal'] as num?)?.toStringAsFixed(0)}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                            color: _primaryGreen,
                          ),
                        ),
                      ),
                      DataCell(
                        Text(
                          '₹${(r['olbTotal'] as num?)?.toStringAsFixed(0)}',
                          style: GoogleFonts.inter(
                            fontSize: 11.sp,
                            fontWeight: FontWeight.w700,
                            color: const Color(0xFF1E3A8A),
                          ),
                        ),
                      ),
                    ],
                  );
                }).toList(),
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildExecutiveCollectionWidget() {
    return Obx(() {
      final pct = _dashController.collectionPercentage;
      return Container(
        padding: EdgeInsets.all(16.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 10,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Container(
                      padding: EdgeInsets.all(8.w),
                      decoration: BoxDecoration(
                        color: _primaryGreen.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      child: Icon(
                        Icons.analytics_rounded,
                        color: _primaryGreen,
                        size: 18.sp,
                      ),
                    ),
                    SizedBox(width: 8.w),
                    Text(
                      'Portfolio Demand & Recovery',
                      style: GoogleFonts.inter(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w700,
                        color: _darkText,
                      ),
                    ),
                  ],
                ),
                Text(
                  '${pct.toStringAsFixed(1)}%',
                  style: GoogleFonts.inter(
                    fontSize: 15.sp,
                    fontWeight: FontWeight.w800,
                    color: _primaryGreen,
                  ),
                ),
              ],
            ),
            SizedBox(height: 12.h),
            ClipRRect(
              borderRadius: BorderRadius.circular(8.r),
              child: LinearProgressIndicator(
                value: pct / 100.0,
                minHeight: 8.h,
                backgroundColor: const Color(0xFFE2E8F0),
                valueColor: const AlwaysStoppedAnimation<Color>(_primaryGreen),
              ),
            ),
            SizedBox(height: 12.h),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildMetricText(
                  'Demand',
                  '₹${(_dashController.totalDemandAmount.value / 100000).toStringAsFixed(2)} L',
                ),
                _buildMetricText(
                  'Collected',
                  '₹${(_dashController.totalCollectedAmount.value / 100000).toStringAsFixed(2)} L',
                ),
                _buildMetricText(
                  'Disbursed',
                  '₹${(_dashController.totalDisbursedAmount.value / 100000).toStringAsFixed(2)} L',
                ),
              ],
            ),
          ],
        ),
      );
    });
  }

  Widget _buildMetricText(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 10.sp,
            color: _muted,
            fontWeight: FontWeight.w500,
          ),
        ),
        SizedBox(height: 2.h),
        Text(
          value,
          style: GoogleFonts.inter(
            fontSize: 13.sp,
            color: _darkText,
            fontWeight: FontWeight.w700,
          ),
        ),
      ],
    );
  }

  Widget _buildOperationsApprovalsGrid() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'EXECUTIVE OPERATIONS & APPROVALS',
          style: GoogleFonts.inter(
            fontSize: 11.sp,
            fontWeight: FontWeight.w700,
            color: _muted,
            letterSpacing: 0.8,
          ),
        ),
        SizedBox(height: 10.h),
        GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          crossAxisSpacing: 12.w,
          mainAxisSpacing: 12.h,
          childAspectRatio: 1.35,
          children: [
            _buildQuickActionCard(
              title: 'Member Approval',
              subtitle: 'Review & approve member applications',
              icon: Icons.assignment_ind_rounded,
              color: const Color(0xFF0D6842),
              badge: 'Pending',
              onTap: () => _push(const MemberApproval()),
            ),
            _buildQuickActionCard(
              title: 'Center Approval',
              subtitle: 'Approve new center requests',
              icon: Icons.add_location_alt_rounded,
              color: const Color(0xFF0D9488),
              badge: 'Action',
              onTap: () => _push(const CentreApproval()),
            ),
            _buildQuickActionCard(
              title: 'Final Disbursement',
              subtitle: 'Release loan funds to clients',
              icon: Icons.payments_rounded,
              color: const Color(0xFF1E3A8A),
              onTap: () => _push(const FinalDisbursement()),
            ),
            _buildQuickActionCard(
              title: 'Client Search',
              subtitle: 'Locate clients, KYC & loan status',
              icon: Icons.person_search_rounded,
              color: const Color(0xFF7C3AED),
              onTap: () => _push(const ClientSearchLocate()),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildQuickActionCard({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    String? badge,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14.r),
      child: Container(
        padding: EdgeInsets.all(12.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Container(
                  padding: EdgeInsets.all(8.w),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Icon(icon, color: color, size: 20.sp),
                ),
                if (badge != null)
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 8.w,
                      vertical: 3.h,
                    ),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    child: Text(
                      badge,
                      style: GoogleFonts.inter(
                        fontSize: 9.sp,
                        fontWeight: FontWeight.w700,
                        color: color,
                      ),
                    ),
                  ),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.inter(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                SizedBox(height: 2.h),
                Text(
                  subtitle,
                  style: GoogleFonts.inter(
                    fontSize: 10.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBranchLeaderboardWidget() {
    final branches = [
      {
        'name': 'Main Branch',
        'code': 'BR-001',
        'efficiency': '98.5%',
        'disbursed': '₹ 18.5 L',
      },
      {
        'name': 'North Zone Branch',
        'code': 'BR-002',
        'efficiency': '95.2%',
        'disbursed': '₹ 14.2 L',
      },
      {
        'name': 'City Center Branch',
        'code': 'BR-003',
        'efficiency': '92.8%',
        'disbursed': '₹ 11.8 L',
      },
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'BRANCH PERFORMANCE LEADERBOARD',
              style: GoogleFonts.inter(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: _muted,
                letterSpacing: 0.8,
              ),
            ),
            GestureDetector(
              onTap: () => _push(const BranchList()),
              child: Text(
                'View All',
                style: GoogleFonts.inter(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  color: _primaryGreen,
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 10.h),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: branches.length,
          separatorBuilder: (context, index) => SizedBox(height: 8.h),
          itemBuilder: (context, index) {
            final b = branches[index];
            return Container(
              padding: EdgeInsets.all(12.w),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12.r),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.03),
                    blurRadius: 6,
                  ),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 28.w,
                    height: 28.w,
                    decoration: BoxDecoration(
                      color: index == 0
                          ? const Color(0xFFFEF3C7)
                          : const Color(0xFFF1F5F9),
                      shape: BoxShape.circle,
                    ),
                    child: Center(
                      child: Text(
                        '#${index + 1}',
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.w800,
                          color: index == 0 ? const Color(0xFFD97706) : _muted,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          b['name']!,
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: _darkText,
                          ),
                        ),
                        Text(
                          '${b['code']} • Disbursed: ${b['disbursed']}',
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: _muted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 8.w,
                      vertical: 4.h,
                    ),
                    decoration: BoxDecoration(
                      color: const Color(0xFFDCFCE7),
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    child: Text(
                      b['efficiency']!,
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF166534),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  String _consoleSearchQuery = '';
  final TextEditingController _consoleSearchController =
      TextEditingController();

  static const List<Map<String, dynamic>> _hubModules = [
    {
      'name': 'Dashboard',
      'icon': Icons.dashboard_rounded,
      'color': Color(0xFF0D6842),
      'count': 'Live',
    },
    {
      'name': 'Hubs',
      'icon': Icons.hub_rounded,
      'color': Color(0xFF0D9488),
      'children': ['Hub Create', 'Product Map', 'Extend Branch Lock'],
    },
    {
      'name': 'Center Operations',
      'icon': Icons.pin_drop_rounded,
      'color': Color(0xFF1E3A8A),
      'children': [
        'Create Center',
        'Center Approval',
        'Groups',
        'Transfer',
        'Locate Center',
      ],
    },
    {
      'name': 'Client',
      'icon': Icons.people_alt_rounded,
      'color': Color(0xFF7C3AED),
      'children': [
        'Search & Locate',
        'Member Enrollment',
        'Credit Check',
        'Member Approval',
        'Member Update',
        'Co-Applicant Management',
        'Group Assign',
        'Transfer',
        'Inactive',
        'Re-active',
        'Member Validation',
        'Renewal Loan Application',
        'Client Loan Tracker',
      ],
    },
    {
      'name': 'Loan Module',
      'icon': Icons.credit_card_rounded,
      'color': Color(0xFFB45309),
      'children': [
        'Loan Indexation',
        'Member Individual',
        'Disbursement',
        'Final Disbursement',
        'Change Funder',
        'Delete Disbursement',
      ],
    },
    {
      'name': 'Collections',
      'icon': Icons.receipt_rounded,
      'color': Color(0xFF0D6842),
      'children': [
        'Collection Approval',
        'Demand Collection',
        'Arrear Collection',
      ],
    },
    {
      'name': 'Client / Late Collection',
      'icon': Icons.payments_rounded,
      'color': Color(0xFFDC2626),
      'children': [
        'Single Collection',
        'Bulk Collection',
        'Foreclosure',
        'Loan Advance Refund',
        'Foreclosure Approval',
        'Loan Write-Off / Death Closure',
        'Member Collection Details',
        'Delete Demand Collection',
        'Delete Client Collection',
        'Delete Foreclosure',
      ],
    },
    {
      'name': 'Payroll & Attendance',
      'icon': Icons.schedule_rounded,
      'color': Color(0xFF0284C7),
      'children': [
        'Leave Type',
        'Leave Balance',
        'Salary',
        'Salary Master',
        'Salary Pay',
        'Payroll',
        'Attendance',
      ],
    },
    {
      'name': 'Daily Monitoring',
      'icon': Icons.bar_chart_rounded,
      'color': Color(0xFF0D9488),
      'children': [
        'New Zero Collection',
        'Collection Followup',
        'Advance Collection',
        'Inter Branch',
      ],
    },
    {
      'name': 'Masters',
      'icon': Icons.dataset_rounded,
      'color': Color(0xFF7C3AED),
      'children': [
        'Role Management',
        'Member Approval Workflow',
        'Incentive Configuration',
        'Funder',
        'GL Master',
        'Loan Product Type',
        'Loan Product',
        'Loan Purpose Type',
        'Loan Purpose',
        'Leave Type',
        'Economic Activity Type',
        'Meeting Place',
        'Economic Activity',
        'Questionnaire',
        'Upload',
        'FDO Task Management',
        'Brand Theme',
        'Highmark Settings',
      ],
    },
    {
      'name': 'Gold Loan',
      'icon': Icons.monetization_on_rounded,
      'color': Color(0xFFD97706),
      'children': ['Gold Return'],
    },
    {
      'name': 'Employees',
      'icon': Icons.badge_rounded,
      'color': Color(0xFF1E3A8A),
      'children': ['User Management', 'Reset Password'],
    },
    {
      'name': 'Accounts',
      'icon': Icons.account_balance_wallet_rounded,
      'color': Color(0xFF2563EB),
      'children': ['Accounts Group', 'Accounts Ledger', 'Self Accounts'],
    },
    {
      'name': 'Transactions',
      'icon': Icons.sync_alt_rounded,
      'color': Color(0xFF059669),
      'children': [
        'Cash Receipt',
        'Cash Payment',
        'Bank Receipt',
        'Bank Payment',
        'Journal',
        'Contra',
        'Modification',
      ],
    },
    {
      'name': 'Reports',
      'icon': Icons.summarize_rounded,
      'color': Color(0xFF4338CA),
      'children': [
        'Demand',
        'Client',
        'Collection',
        'Portfolio',
        'Account',
        'Employee',
        'Funders',
        'Others',
        'Gold',
      ],
    },
    {
      'name': 'MIS Reports',
      'icon': Icons.insights_rounded,
      'color': Color(0xFF0D6842),
      'children': [
        'Company Profile',
        'All DCB',
        'Branch Demand',
        'Disbursement',
        'Loan OS Details',
        'Agewise Arrear',
        'Preclosure',
        'Performance',
        'Ledger Report',
      ],
    },
    {
      'name': 'EOD',
      'icon': Icons.event_repeat_rounded,
      'color': Color(0xFFB45309),
      'children': ['EOD Process'],
    },
    {
      'name': 'Revert',
      'icon': Icons.undo_rounded,
      'color': Color(0xFFDC2626),
      'children': [
        'Collection Revert',
        'Individual Member Collection Revert',
        'Pre-Closure Revert',
        'Allocation Revert',
        'EOD Revert',
        'Disbursement Revert',
        'Loan Closure Revert',
        'Death Revert',
        'Loan Advance Revert',
      ],
    },
  ];

  // ============== 2. ADMIN CONSOLE VIEW (18-MODULE NAVIGATION HUB) ==============
  Widget _buildAdminConsoleView() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 1. Search Bar
        Container(
          margin: EdgeInsets.only(bottom: 14.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14.r),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: TextField(
            controller: _consoleSearchController,
            onChanged: (val) => setState(() => _consoleSearchQuery = val),
            decoration: InputDecoration(
              hintText: 'Search 18 modules & sub-items...',
              hintStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
              prefixIcon: const Icon(Icons.search_rounded, color: _muted),
              suffixIcon: _consoleSearchQuery.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, color: _muted),
                      onPressed: () {
                        _consoleSearchController.clear();
                        setState(() => _consoleSearchQuery = '');
                      },
                    )
                  : null,
              filled: true,
              fillColor: Colors.white,
              contentPadding: EdgeInsets.symmetric(vertical: 12.h),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14.r),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),

        // 2. 18 Expandable Module Cards List
        ..._hubModules.map((mod) {
          final String name = mod['name'];
          final IconData icon = mod['icon'];
          final Color color = mod['color'];
          final List<String> children = List<String>.from(
            mod['children'] ?? [],
          );

          final q = _consoleSearchQuery.toLowerCase();
          if (q.isNotEmpty) {
            final nameMatches = name.toLowerCase().contains(q);
            final matchingChildren = children
                .where((c) => c.toLowerCase().contains(q))
                .toList();
            if (!nameMatches && matchingChildren.isEmpty) {
              return const SizedBox.shrink();
            }
          }

          return Padding(
            padding: EdgeInsets.only(bottom: 10.h),
            child: _buildExpandableHubModuleCard(name, icon, color, children),
          );
        }),
      ],
    );
  }

  Widget _buildExpandableHubModuleCard(
    String name,
    IconData icon,
    Color color,
    List<String> children,
  ) {
    if (children.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: ListTile(
          leading: Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: color, size: 20.sp),
          ),
          title: Text(
            name,
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          trailing: const Icon(
            Icons.arrow_forward_ios_rounded,
            color: _muted,
            size: 14,
          ),
          onTap: () => _handleModuleTap(name, null),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: color, size: 20.sp),
          ),
          title: Text(
            name,
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          subtitle: Text(
            '${children.length} Features',
            style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
          ),
          children: children.map((sub) {
            return ListTile(
              contentPadding: EdgeInsets.only(left: 52.w, right: 16.w),
              title: Text(
                sub,
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  color: _darkText,
                  fontWeight: FontWeight.w500,
                ),
              ),
              trailing: Icon(
                Icons.chevron_right_rounded,
                color: color,
                size: 18,
              ),
              onTap: () => _handleModuleTap(name, sub),
            );
          }).toList(),
        ),
      ),
    );
  }

  // ============== HEADER ==============
  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 14.h),
      decoration: BoxDecoration(
        color: _cardBg,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 12,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Builder(
            builder: (context) => IconButton(
              icon: Icon(Icons.menu_rounded, color: _darkText, size: 24.sp),
              onPressed: () => Scaffold.of(context).openDrawer(),
            ),
          ),
          SizedBox(width: 4.w),
          // Animated Logo
          TweenAnimationBuilder(
            duration: const Duration(milliseconds: 600),
            curve: Curves.easeOutBack,
            tween: Tween<double>(begin: 0.0, end: 1.0),
            builder: (context, value, child) {
              return Transform.scale(
                scale: value,
                child: Container(
                  padding: EdgeInsets.all(10.w),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D6842), Color(0xFF1A8A5A)],
                    ),
                    borderRadius: BorderRadius.circular(14.r),
                    boxShadow: [
                      BoxShadow(
                        color: _primaryGreen.withOpacity(0.25),
                        blurRadius: 12,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: Icon(
                    Icons.admin_panel_settings_rounded,
                    color: Colors.white,
                    size: 22.sp,
                  ),
                ),
              );
            },
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Admin Console',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                    height: 1.1,
                  ),
                ),
                Text(
                  'Organization Management Dashboard',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          // Admin Badge
          TweenAnimationBuilder(
            duration: const Duration(milliseconds: 500),
            curve: Curves.easeOutBack,
            tween: Tween<double>(begin: 0.0, end: 1.0),
            builder: (context, value, child) {
              return Transform.scale(
                scale: value,
                child: Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 12.w,
                    vertical: 6.h,
                  ),
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF0D6842), Color(0xFF1A8A5A)],
                    ),
                    borderRadius: BorderRadius.circular(20.r),
                    boxShadow: [
                      BoxShadow(
                        color: _primaryGreen.withOpacity(0.2),
                        blurRadius: 8,
                      ),
                    ],
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 6.w,
                        height: 6.w,
                        decoration: const BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                        ),
                      ),
                      SizedBox(width: 4.w),
                      Text(
                        'Admin',
                        style: GoogleFonts.inter(
                          fontSize: 10.sp,
                          fontWeight: FontWeight.w600,
                          color: Colors.white,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // ============== GREETING SECTION ==============
  Widget _buildGreetingSection() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_primaryGreen, _primaryGreenLight],
        ),
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: _primaryGreen.withOpacity(0.3),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Good ${_getTimeOfDay()}! 👋',
                  style: GoogleFonts.inter(
                    fontSize: 18.sp,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                    height: 1.2,
                  ),
                ),
                SizedBox(height: 4.h),
                Text(
                  'Welcome back to your admin dashboard',
                  style: GoogleFonts.inter(
                    fontSize: 12.sp,
                    color: Colors.white.withOpacity(0.85),
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: 10.h),
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 10.w,
                    vertical: 4.h,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(20.r),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.calendar_today_rounded,
                        color: Colors.white,
                        size: 12.sp,
                      ),
                      SizedBox(width: 4.w),
                      Text(
                        _getFormattedDate(),
                        style: GoogleFonts.inter(
                          fontSize: 10.sp,
                          color: Colors.white,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          GestureDetector(
            onTap: () => _dashController.reloadDashboard(),
            child: Container(
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                borderRadius: BorderRadius.circular(12.r),
              ),
              child: Obx(() {
                return _dashController.isRefreshing.value
                    ? SizedBox(
                        width: 20.sp,
                        height: 20.sp,
                        child: const CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Icon(
                        Icons.refresh_rounded,
                        color: Colors.white,
                        size: 22.sp,
                      );
              }),
            ),
          ),
        ],
      ),
    );
  }

  // ============== STATS ROW ==============
  Widget _buildStatsRow() {
    final stats = [
      {
        'label': 'Total Users',
        'value': '156',
        'icon': Icons.people_rounded,
        'color': const Color(0xFF0D6842),
      },
      {
        'label': 'Active Branches',
        'value': '6',
        'icon': Icons.store_rounded,
        'color': const Color(0xFF0D9488),
      },
      {
        'label': 'Funders',
        'value': '8',
        'icon': Icons.account_balance_rounded,
        'color': const Color(0xFF7C3AED),
      },
      {
        'label': 'GL Accounts',
        'value': '24',
        'icon': Icons.menu_book_rounded,
        'color': const Color(0xFFB45309),
      },
    ];

    return SizedBox(
      height: 80.h,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemCount: stats.length,
        separatorBuilder: (context, index) => SizedBox(width: 10.w),
        itemBuilder: (context, index) {
          final stat = stats[index];
          return _buildStatCard(stat, index);
        },
      ),
    );
  }

  Widget _buildStatCard(Map<String, dynamic> stat, int index) {
    return TweenAnimationBuilder(
      duration: Duration(milliseconds: 400 + (index * 100)),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(20 * (1 - value), 0),
            child: Container(
              width: 110.w,
              padding: EdgeInsets.all(12.w),
              decoration: BoxDecoration(
                color: _cardBg,
                borderRadius: BorderRadius.circular(14.r),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(4.w),
                        decoration: BoxDecoration(
                          color: stat['color'].withOpacity(0.1),
                          borderRadius: BorderRadius.circular(6.r),
                        ),
                        child: Icon(
                          stat['icon'],
                          color: stat['color'],
                          size: 14.sp,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        stat['value'],
                        style: GoogleFonts.inter(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 2.h),
                  Text(
                    stat['label'],
                    style: GoogleFonts.inter(
                      fontSize: 9.sp,
                      color: _muted,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // ============== MODULE SECTION ==============
  Widget _buildModuleSection({
    required Key key,
    required String title,
    required IconData icon,
    required List<_ModuleItem> items,
  }) {
    return Padding(
      key: key,
      padding: EdgeInsets.only(bottom: 16.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: _muted, size: 16.sp),
              SizedBox(width: 6.w),
              Text(
                title.toUpperCase(),
                style: GoogleFonts.inter(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  color: _muted,
                  letterSpacing: 0.8,
                ),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          ...items.asMap().entries.map(
            (entry) => _buildModuleTile(entry.value, entry.key),
          ),
        ],
      ),
    );
  }

  // ============== MODULE TILE ==============
  Widget _buildModuleTile(_ModuleItem item, int index) {
    return Padding(
      padding: EdgeInsets.only(bottom: 8.h),
      child: TweenAnimationBuilder(
        duration: Duration(milliseconds: 300 + (index * 80)),
        curve: Curves.easeOutCubic,
        tween: Tween<double>(begin: 0.0, end: 1.0),
        builder: (context, value, child) {
          return Opacity(
            opacity: value,
            child: Transform.translate(
              offset: Offset(30 * (1 - value), 0),
              child: child,
            ),
          );
        },
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: item.onTap,
            borderRadius: BorderRadius.circular(16.r),
            splashColor: _primaryGreen.withOpacity(0.08),
            highlightColor: _primaryGreen.withOpacity(0.04),
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
              decoration: BoxDecoration(
                color: _cardBg,
                borderRadius: BorderRadius.circular(16.r),
                border: Border.all(
                  color: item.danger
                      ? const Color(0xFFFFE5E5)
                      : const Color(0xFFE8F0EB),
                  width: 1.5,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.04),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: Row(
                children: [
                  // Icon Container with Gradient
                  Container(
                    padding: EdgeInsets.all(10.w),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors:
                            item.gradient ??
                            (item.danger
                                ? const [Color(0xFFDC2626), Color(0xFFF87171)]
                                : const [Color(0xFF0D6842), Color(0xFF1A8A5A)]),
                      ),
                      borderRadius: BorderRadius.circular(12.r),
                      boxShadow: [
                        BoxShadow(
                          color:
                              (item.gradient ??
                                      const [
                                        Color(0xFF0D6842),
                                        Color(0xFF1A8A5A),
                                      ])[0]
                                  .withOpacity(0.2),
                          blurRadius: 8,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(item.icon, color: Colors.white, size: 20.sp),
                  ),
                  SizedBox(width: 12.w),
                  // Title & Subtitle
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                item.title,
                                style: GoogleFonts.inter(
                                  fontSize: 13.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                  height: 1.2,
                                ),
                              ),
                            ),
                            if (item.count != null)
                              Container(
                                padding: EdgeInsets.symmetric(
                                  horizontal: 8.w,
                                  vertical: 2.h,
                                ),
                                decoration: BoxDecoration(
                                  color: _primaryGreen.withOpacity(0.1),
                                  borderRadius: BorderRadius.circular(10.r),
                                ),
                                child: Text(
                                  item.count!,
                                  style: GoogleFonts.inter(
                                    fontSize: 10.sp,
                                    fontWeight: FontWeight.w700,
                                    color: _primaryGreen,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          item.subtitle,
                          style: GoogleFonts.inter(
                            fontSize: 10.sp,
                            color: _muted,
                            height: 1.3,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  // Arrow
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: EdgeInsets.all(6.w),
                    decoration: BoxDecoration(
                      color: _primaryGreen.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: _primaryGreen,
                      size: 12.sp,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============== ACCESS DENIED ==============
  Widget _buildAccessDenied() {
    return TweenAnimationBuilder(
      duration: const Duration(milliseconds: 600),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.scale(
            scale: 0.92 + (0.08 * value),
            child: Center(
              child: Container(
                margin: EdgeInsets.all(24.w),
                padding: EdgeInsets.all(24.w),
                decoration: BoxDecoration(
                  color: _cardBg,
                  borderRadius: BorderRadius.circular(24.r),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.06),
                      blurRadius: 30,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      padding: EdgeInsets.all(16.w),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF2F2),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.gpp_bad_rounded,
                        size: 48.sp,
                        color: const Color(0xFFDC2626),
                      ),
                    ),
                    SizedBox(height: 16.h),
                    Text(
                      'Access Restricted',
                      style: GoogleFonts.inter(
                        fontSize: 18.sp,
                        fontWeight: FontWeight.w700,
                        color: _darkText,
                      ),
                    ),
                    SizedBox(height: 8.h),
                    Text(
                      'This portal is exclusively available for Admin accounts.',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        color: _muted,
                        height: 1.4,
                      ),
                    ),
                    SizedBox(height: 24.h),
                    SizedBox(
                      width: double.infinity,
                      height: 48.h,
                      child: ElevatedButton.icon(
                        onPressed: _logout,
                        icon: const Icon(Icons.logout_rounded, size: 20),
                        label: Text(
                          'Sign Out',
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _primaryGreen,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                          elevation: 2,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  // ============== FOOTER ==============
  Widget _buildFooter() {
    return Center(
      child: Text(
        'Sarvam v2.0.0 • ${DateTime.now().year}',
        style: GoogleFonts.inter(
          fontSize: 10.sp,
          color: _muted.withOpacity(0.6),
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }

  // ============== LOGOUT DIALOG ==============
  void _showLogoutDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => _buildLogoutDialog(),
    );
  }

  Widget _buildLogoutDialog() {
    return Dialog(
      elevation: 0,
      backgroundColor: Colors.transparent,
      child: TweenAnimationBuilder(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOutBack,
        tween: Tween<double>(begin: 0.0, end: 1.0),
        builder: (context, value, child) {
          return Transform.scale(
            scale: value,
            child: Container(
              padding: EdgeInsets.all(24.w),
              decoration: BoxDecoration(
                color: _cardBg,
                borderRadius: BorderRadius.circular(20.r),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.15),
                    blurRadius: 30,
                    spreadRadius: 5,
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    padding: EdgeInsets.all(16.w),
                    decoration: const BoxDecoration(
                      color: Color(0xFFFEF2F2),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.logout_rounded,
                      size: 36.sp,
                      color: const Color(0xFFDC2626),
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'Sign Out?',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Are you sure you want to sign out?',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                  ),
                  SizedBox(height: 24.h),
                  Row(
                    children: [
                      Expanded(
                        child: TextButton(
                          onPressed: () => Navigator.pop(context),
                          style: TextButton.styleFrom(
                            foregroundColor: _muted,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                              side: BorderSide(color: Colors.grey.shade300),
                            ),
                          ),
                          child: Text(
                            'Cancel',
                            style: GoogleFonts.inter(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () {
                            Navigator.pop(context);
                            _logout();
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFDC2626),
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                            elevation: 2,
                          ),
                          child: Text(
                            'Sign Out',
                            style: GoogleFonts.inter(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // ============== HELPER METHODS ==============
  String _getTimeOfDay() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  }

  String _getFormattedDate() {
    final now = DateTime.now();
    final days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    final months = [
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
    return '${days[now.weekday - 1]}, ${now.day} ${months[now.month - 1]} ${now.year}';
  }

  void _push(Widget screen) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) => screen,
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          const begin = Offset(0.3, 0);
          const end = Offset.zero;
          const curve = Curves.easeOutCubic;
          var tween = Tween(
            begin: begin,
            end: end,
          ).chain(CurveTween(curve: curve));
          var offsetAnimation = animation.drive(tween);
          return SlideTransition(
            position: offsetAnimation,
            child: FadeTransition(opacity: animation, child: child),
          );
        },
      ),
    );
  }

  String _drawerSearchQuery = '';

  Widget _buildAdminDrawer() {
    final List<Map<String, dynamic>> modules = [
      {
        'name': 'Dashboard',
        'icon': Icons.dashboard_rounded,
        'color': const Color(0xFF0D6842),
      },
      {
        'name': 'Hub',
        'icon': Icons.hub_rounded,
        'color': const Color(0xFF0D9488),
        'children': ['Hub Create', 'Product Map', 'Extend Branch Lock'],
      },
      {
        'name': 'Center Operations',
        'icon': Icons.pin_drop_rounded,
        'color': const Color(0xFF1E3A8A),
        'children': [
          'Create Center',
          'Center Approval',
          'Groups',
          'Transfer',
          'Locate Center',
        ],
      },
      {
        'name': 'Client',
        'icon': Icons.people_alt_rounded,
        'color': const Color(0xFF7C3AED),
        'children': [
          'Search & Locate',
          'Member Enrollment',
          'Credit Check',
          'Member Approval',
          'Member Update',
          'Co-Applicant Management',
          'Group Assign',
          'Transfer',
          'Inactive',
          'Re-active',
          'Member Validation',
          'Renewal Loan Application',
          'Client Loan Tracker',
        ],
      },
      {
        'name': 'Loan Module',
        'icon': Icons.credit_card_rounded,
        'color': const Color(0xFFB45309),
        'children': [
          'Loan Indexation',
          'Member Individual',
          'Disbursement',
          'Final Disbursement',
          'Change Funder',
          'Delete Disbursement',
        ],
      },
      {
        'name': 'Collections',
        'icon': Icons.receipt_rounded,
        'color': const Color(0xFF0D6842),
        'children': [
          'Collection Approval',
          'Demand Collection',
          'Arrear Collection',
        ],
      },
      {
        'name': 'Client / Late Collection',
        'icon': Icons.payments_rounded,
        'color': const Color(0xFFDC2626),
        'children': [
          'Single Collection',
          'Bulk Collection',
          'Foreclosure',
          'Loan Advance Refund',
          'Foreclosure Approval',
          'Loan Write-Off / Death Closure',
          'Member Collection Details',
          'Delete Demand Collection',
          'Delete Client Collection',
          'Delete Foreclosure',
        ],
      },
      {
        'name': 'Payroll & Attendance',
        'icon': Icons.schedule_rounded,
        'color': const Color(0xFF0284C7),
        'children': [
          'Leave Type',
          'Leave Balance',
          'Salary',
          'Salary Master',
          'Salary Pay',
          'Payroll',
          'Attendance',
        ],
      },
      {
        'name': 'Daily Monitoring',
        'icon': Icons.bar_chart_rounded,
        'color': const Color(0xFF0D9488),
        'children': [
          'New Zero Collection',
          'Collection Followup',
          'Advance Collection',
          'Inter Branch',
        ],
      },
      {
        'name': 'Masters',
        'icon': Icons.dataset_rounded,
        'color': const Color(0xFF7C3AED),
        'children': [
          'Role Management',
          'Member Approval Workflow',
          'Incentive Configuration',
          'Funder',
          'GL Master',
          'Loan Product Type',
          'Loan Product',
          'Loan Purpose Type',
          'Loan Purpose',
          'Leave Type',
          'Economic Activity Type',
          'Meeting Place',
          'Economic Activity',
          'Questionnaire',
          'Upload',
          'FDO Task Management',
          'Brand Theme',
          'Highmark Settings',
        ],
      },
      {
        'name': 'Gold Loan',
        'icon': Icons.monetization_on_rounded,
        'color': const Color(0xFFD97706),
        'children': ['Gold Return'],
      },
      {
        'name': 'Employees',
        'icon': Icons.badge_rounded,
        'color': const Color(0xFF1E3A8A),
        'children': ['User Management', 'Reset Password'],
      },
      {
        'name': 'Accounts',
        'icon': Icons.account_balance_wallet_rounded,
        'color': const Color(0xFF2563EB),
        'children': ['Accounts Group', 'Accounts Ledger', 'Self Accounts'],
      },
      {
        'name': 'Transactions',
        'icon': Icons.sync_alt_rounded,
        'color': const Color(0xFF059669),
        'children': [
          'Cash Receipt',
          'Cash Payment',
          'Bank Receipt',
          'Bank Payment',
          'Journal',
          'Contra',
          'Modification',
        ],
      },
      {
        'name': 'Reports',
        'icon': Icons.summarize_rounded,
        'color': const Color(0xFF4338CA),
        'children': [
          'Demand',
          'Client',
          'Collection',
          'Portfolio',
          'Account',
          'Employee',
          'Funders',
          'Others',
          'Gold',
        ],
      },
      {
        'name': 'MIS Reports',
        'icon': Icons.insights_rounded,
        'color': const Color(0xFF0D6842),
        'children': [
          'Company Profile',
          'All DCB',
          'Branch Demand',
          'Disbursement',
          'Loan OS Details',
          'Agewise Arrear',
          'Preclosure',
          'Performance',
          'Ledger Report',
        ],
      },
      {
        'name': 'EOD',
        'icon': Icons.event_repeat_rounded,
        'color': const Color(0xFFB45309),
        'children': ['EOD Process'],
      },
      {
        'name': 'Revert',
        'icon': Icons.undo_rounded,
        'color': const Color(0xFFDC2626),
        'children': [
          'Collection Revert',
          'Individual Member Collection Revert',
          'Pre-Closure Revert',
          'Allocation Revert',
          'EOD Revert',
          'Disbursement Revert',
          'Loan Closure Revert',
          'Death Revert',
          'Loan Advance Revert',
        ],
      },
    ];

    return Drawer(
      backgroundColor: _lightBg,
      child: SafeArea(
        child: Column(
          children: [
            // Drawer Header
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(18.w),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [_primaryGreen, Color(0xFF1A8A5A)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(8.w),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.admin_panel_settings_rounded,
                          color: Colors.white,
                          size: 24.sp,
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Sarvam MFI Admin',
                              style: GoogleFonts.inter(
                                fontSize: 16.sp,
                                fontWeight: FontWeight.w800,
                                color: Colors.white,
                              ),
                            ),
                            Text(
                              'Full Web Parity Directory',
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                color: Colors.white.withOpacity(0.85),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Search Bar
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 10.h),
              child: TextField(
                onChanged: (val) => setState(() => _drawerSearchQuery = val),
                decoration: InputDecoration(
                  hintText: 'Search 18 modules & sub-items...',
                  hintStyle: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
                  prefixIcon: const Icon(
                    Icons.search_rounded,
                    color: _muted,
                    size: 18,
                  ),
                  filled: true,
                  fillColor: Colors.white,
                  contentPadding: EdgeInsets.symmetric(vertical: 8.h),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10.r),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),

            // Module Navigation List
            Expanded(
              child: ListView.builder(
                padding: EdgeInsets.symmetric(horizontal: 10.w),
                itemCount: modules.length,
                itemBuilder: (context, index) {
                  final mod = modules[index];
                  final String name = mod['name'];
                  final IconData icon = mod['icon'];
                  final Color color = mod['color'];
                  final List<String> children = List<String>.from(
                    mod['children'] ?? [],
                  );

                  final q = _drawerSearchQuery.toLowerCase();
                  if (q.isNotEmpty) {
                    final nameMatches = name.toLowerCase().contains(q);
                    final matchingChildren = children
                        .where((c) => c.toLowerCase().contains(q))
                        .toList();
                    if (!nameMatches && matchingChildren.isEmpty) {
                      return const SizedBox.shrink();
                    }
                  }

                  if (children.isEmpty) {
                    return ListTile(
                      dense: true,
                      leading: Icon(icon, color: color, size: 20.sp),
                      title: Text(
                        name,
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                      onTap: () {
                        Get.back();
                        _handleModuleTap(name, null);
                      },
                    );
                  }

                  return Theme(
                    data: Theme.of(
                      context,
                    ).copyWith(dividerColor: Colors.transparent),
                    child: ExpansionTile(
                      dense: true,
                      leading: Icon(icon, color: color, size: 20.sp),
                      title: Text(
                        name,
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                      children: children.map((sub) {
                        return ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.only(
                            left: 44.w,
                            right: 16.w,
                          ),
                          title: Text(
                            sub,
                            style: GoogleFonts.inter(
                              fontSize: 12.sp,
                              color: _muted,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          onTap: () {
                            Get.back();
                            _handleModuleTap(name, sub);
                          },
                        );
                      }).toList(),
                    ),
                  );
                },
              ),
            ),

            // Drawer Footer Sign Out
            Divider(height: 1, color: Colors.grey.shade300),
            ListTile(
              dense: true,
              leading: const Icon(
                Icons.logout_rounded,
                color: Color(0xFFDC2626),
              ),
              title: Text(
                'Sign Out',
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFFDC2626),
                ),
              ),
              onTap: () {
                Get.back();
                _showLogoutDialog();
              },
            ),
          ],
        ),
      ),
    );
  }

  void _handleModuleTap(String parent, String? subItem) {
    final sub = subItem ?? parent;

    switch (sub) {
      case 'User Management':
        _push(const UserList());
        break;
      case 'Role Management':
      case 'Role Manager':
        _push(const RoleList());
        break;
      case 'Branches & Hubs':
      case 'Hub Create':
        _push(const HubManagementScreen());
        break;
      case 'Product Map':
        _push(const ProductMapScreen());
        break;
      case 'Extend Branch Lock':
        _push(const ExtendBranchLockScreen());
        break;
      case 'Create Center':
      case 'Center Approval':
      case 'Groups':
      case 'Transfer':
      case 'Locate Center':
        _push(const CentreApproval());
        break;
      case 'Search & Locate':
      case 'Client Search':
        _push(const ClientSearchLocate());
        break;
      case 'Member Approval':
      case 'Member Validation':
      case 'Member Approval Workflow':
        _push(const MemberApproval());
        break;
      case 'Loan Indexation':
        _push(const LoanProductsList());
        break;
      case 'Disbursement':
      case 'Final Disbursement':
        _push(const FinalDisbursement());
        break;
      case 'Loan Product':
      case 'Loan Product Type':
        _push(const LoanProductsList());
        break;
      case 'Loan Purpose':
      case 'Loan Purpose Type':
        _push(const LoanPurposesList());
        break;
      case 'Economic Activity':
      case 'Economic Activity Type':
        _push(const EconomicActivitiesList());
        break;
      case 'Meeting Place':
        _push(const MeetingPlacesList());
        break;
      case 'Funder':
        _push(const FunderList());
        break;
      case 'GL Master':
      case 'Accounts Ledger':
      case 'Self Accounts':
      case 'Accounts Group':
        _push(const AccountsOverview());
        break;
      case 'Cash Receipt':
      case 'Cash Payment':
      case 'Bank Receipt':
      case 'Bank Payment':
      case 'Journal':
      case 'Contra':
      case 'Modification':
        _push(const TransactionManagement());
        break;
      case 'EOD Process':
      case 'EOD':
        _push(const EodExecution());
        break;
      case 'Profile & Settings':
        _push(const ProfileSettings());
        break;
      default:
        _push(const AdminReportsOverview());
        break;
    }
  }

  Future<void> _logout() async {
    final AuthController authController = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : Get.put(AuthController());
    await authController.logout();
  }
}

// ============== MODULE ITEM MODEL ==============
class _ModuleItem {
  const _ModuleItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.danger = false,
    this.gradient,
    this.count,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool danger;
  final List<Color>? gradient;
  final String? count;
}
