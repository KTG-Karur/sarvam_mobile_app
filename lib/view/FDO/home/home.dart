import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/view/FDO/client_search_locate/client_search_locate.dart';
import 'package:sarvam/view/FDO/colletion/collection.dart';
import 'package:sarvam/view/FDO/loan_disbursement/loan_disbursement.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/controller/dashboard_controller.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

class Home extends StatefulWidget {
  const Home({super.key});

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> with SingleTickerProviderStateMixin {
  final DashboardController _controller =
      Get.isRegistered<DashboardController>()
      ? Get.find<DashboardController>()
      : Get.put(DashboardController());

  String _employeeId = '';
  String _branchName = '';
  String _fdoName = '';
  bool _presentToday = false;

  late final AnimationController _pageAnimController;
  late final Animation<double> _pageFade;
  late final Animation<Offset> _pageSlide;

  @override
  void initState() {
    super.initState();
    _loadUserDetails();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _controller.getDashboardStats();
    });

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
  }

  @override
  void dispose() {
    _pageAnimController.dispose();
    super.dispose();
  }

  Future<void> _loadUserDetails() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _employeeId = prefs.getString('employeeId') ?? '';
      _branchName = prefs.getString('branchName') ?? '';
      _fdoName =
          '${prefs.getString('firstName') ?? ''} ${prefs.getString('lastName') ?? ''}'
              .trim();
      _presentToday = hasPunchedInToday(prefs);
    });
  }

  String _formatCurrency(num value) {
    if (value >= 10000000) {
      return '₹${(value / 10000000).toStringAsFixed(2)} Cr';
    }
    if (value >= 100000) return '₹${(value / 100000).toStringAsFixed(2)} L';
    if (value >= 1000) return '₹${(value / 1000).toStringAsFixed(2)} K';
    return '₹${value.toStringAsFixed(0)}';
  }

  String _statValue(String key) {
    final value = _controller.stats[key];
    if (value == null) return '—';
    return '$value';
  }

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
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            // Pinned Custom Header (App Bar)
            Container(
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
                                color: const Color(0xFF0F172A),
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
                                  color: const Color(0xFF0D6842),
                                  fontSize: 11.sp,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          'Comprehensive overview of your microfinance operations',
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            color: const Color(0xFF64748B),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  SizedBox(width: 8.w),
                  // Refresh button
                  Obx(
                    () => GestureDetector(
                      onTap: _controller.isLoading.value
                          ? null
                          : () => _controller.getDashboardStats(),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _controller.isLoading.value
                              ? SizedBox(
                                  width: 22.sp,
                                  height: 22.sp,
                                  child: const CircularProgressIndicator(
                                    color: Color(0xFF0D6842),
                                    strokeWidth: 2,
                                  ),
                                )
                              : Icon(
                                  Icons.refresh,
                                  color: const Color(0xFF0F172A),
                                  size: 22.sp,
                                ),
                          Text(
                            'Refresh',
                            style: TextStyle(
                              fontSize: 10.5.sp,
                              color: const Color(0xFF64748B),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(width: 14.w),

                  // Punch out (face verification, then logout)
                  GestureDetector(
                    onTap: () async {
                      final prefs = await SharedPreferences.getInstance();
                      if (!hasPunchedInToday(prefs)) {
                        Get.snackbar(
                          'Punch Out',
                          'Please Punch-In first.',
                          snackPosition: SnackPosition.BOTTOM,
                          backgroundColor: Colors.orange,
                          colorText: Colors.white,
                        );
                        return;
                      }
                      if (prefs.getString('lastPunchOutDate') == todayDateKey()) {
                        Get.snackbar(
                          'Punch Out',
                          'You have already punched out today.',
                          snackPosition: SnackPosition.BOTTOM,
                          backgroundColor: Colors.orange,
                          colorText: Colors.white,
                        );
                        return;
                      }
                      if (!context.mounted) return;
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) =>
                              const FaceVerificationScreen(isPunchOut: true),
                        ),
                      );
                    },
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

                  // Notification bell with red dot
                ],
              ),
            ),

            // Scrollable Dashboard Body
            Expanded(
              child: RefreshIndicator(
                color: const Color(0xFF0D6842),
                onRefresh: () async {
                  await _controller.getDashboardStats();
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
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(height: 16.h),

                          // Task Details Card
                          _buildTaskDetailsCard(),

                          SizedBox(height: 20.h),

                          // Targets Row
                          _buildSectionHeader('TARGETS'),
                          SizedBox(height: 8.h),
                          _buildTargetsRow(),

                          SizedBox(height: 20.h),

                          // Achievement Row
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              _buildSectionHeader('ACHIEVEMENT'),
                              Text(
                                'View All',
                                style: TextStyle(
                                  fontSize: 12.5.sp,
                                  fontWeight: FontWeight.bold,
                                  color: const Color(0xFF0D6842),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 8.h),
                          _buildAchievementRow(),

                          SizedBox(height: 20.h),

                          // Collection vs Arrears Side-By-Side Cards
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: _buildCollectionCard()),
                              SizedBox(width: 12.w),
                              Expanded(child: _buildArrearsCard()),
                            ],
                          ),

                          SizedBox(height: 20.h),

                          // PAR (Portfolio At Risk)
                          _buildParCard(),

                          SizedBox(height: 20.h),

                          // Operations summary 6-grid (3 columns, 2 rows)
                          _buildOperationsGrid(),

                          SizedBox(height: 16.h),

                          // Outstanding Balance Card
                          _buildOutstandingBalanceCard(),

                          SizedBox(height: 24.h),
                          // Quick-access shortcut tiles — row 1
                          Row(
                            children: [
                              Expanded(
                                child: _buildShortcut(
                                  asset: 'assets/icon/create_collection.png',
                                  label: 'Collection Relationship',
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const Collection(),
                                    ),
                                  ),
                                ),
                              ),
                              SizedBox(width: 10.w),
                              Expanded(
                                child: _buildShortcut(
                                  asset: 'assets/icon/loan_disbursement.png',
                                  label: 'Loan\nDisbursement',
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => const LoanDisbursement(),
                                    ),
                                  ),
                                ),
                              ),
                              SizedBox(width: 10.w),
                              Expanded(
                                child: _buildShortcut(
                                  asset: 'assets/icon/profile.png',
                                  label: 'Profile',
                                  onTap: () => _showProfileBottomSheet(context),
                                ),
                              ),
                              SizedBox(width: 10.w),
                              Expanded(
                                child: _buildShortcut(
                                  asset: 'assets/icon/location.png',
                                  label: 'Location',
                                  onTap: () => Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) =>
                                          const ClientSearchLocate(),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: 10.h),
                          // Quick-access shortcut tiles — row 2
                          Row(
                            children: [
                              SizedBox(width: 10.w),
                              // Empty spacers keep the tile width consistent
                              // with the row above (4-column grid width).
                              Expanded(child: SizedBox.shrink()),
                              SizedBox(width: 10.w),
                              Expanded(child: SizedBox.shrink()),
                              SizedBox(width: 10.w),
                              Expanded(child: SizedBox.shrink()),
                            ],
                          ),
                          SizedBox(height: 20.h),
                        ],
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

  Widget _buildShortcut({
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
                  color: const Color(0xFF0D6842),
                  height: 1.15,
                ),
              ),
            ],
          ),
        ),
      ),
    );
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
                    child: CircularProgressIndicator(color: Color(0xFF0D6842)),
                  ),
                );
              }
              final data = snapshot.data ?? {};
              final String firstName = data['firstName'] ?? 'User';
              final String lastName = data['lastName'] ?? '';
              final String employeeId = data['employeeId'] ?? 'N/A';
              final String role =
                  data['rbacRoleName'] ?? (data['role'] ?? 'FDO');
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
                        radius: 30.r,
                        backgroundColor: const Color(0xFFE4F5EB),
                        child: Text(
                          initials.isNotEmpty ? initials : 'U',
                          style: TextStyle(
                            fontSize: 22.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF0D6842),
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
                                fontSize: 20.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF0F172A),
                              ),
                            ),
                            SizedBox(height: 4.h),
                            Text(
                              role,
                              style: TextStyle(
                                fontSize: 13.5.sp,
                                color: const Color(0xFF64748B),
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 24.h),
                  const Divider(color: Color(0xFFF1F5F9)),
                  SizedBox(height: 16.h),
                  _buildDetailRow('Employee ID', employeeId),
                  _buildDetailRow('Mobile Number', mobile),
                  _buildDetailRow('Email Address', email),
                  _buildDetailRow('Current Branch', branch),
                  SizedBox(height: 32.h),
                  SizedBox(
                    width: double.infinity,
                    height: 50.h,
                    child: ElevatedButton.icon(
                      onPressed: () {
                        Navigator.pop(context); // Close bottom sheet
                        final AuthController authController =
                            Get.isRegistered<AuthController>()
                            ? Get.find<AuthController>()
                            : Get.put(AuthController());
                        authController.logout();
                      },
                      icon: const Icon(
                        Icons.logout_rounded,
                        color: Colors.white,
                      ),
                      label: Text(
                        'LOGOUT',
                        style: TextStyle(
                          fontSize: 15.5.sp,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                          letterSpacing: 1,
                        ),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFDC2626),
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12.r),
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

  Future<Map<String, String>> _getProfileDetails() async {
    final prefs = await SharedPreferences.getInstance();
    return {
      'firstName': prefs.getString('firstName') ?? '',
      'lastName': prefs.getString('lastName') ?? '',
      'employeeId': prefs.getString('employeeId') ?? '',
      'role': prefs.getString('role') ?? '',
      'rbacRoleName': prefs.getString('rbacRoleName') ?? '',
      'email': prefs.getString('email') ?? '',
      'mobileNumber': prefs.getString('mobileNumber') ?? '',
      'branchName': prefs.getString('branchName') ?? '',
    };
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 8.h),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 13.5.sp,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF64748B),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 14.5.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF1E293B),
            ),
          ),
        ],
      ),
    );
  }

  // Section Header Builder
  Widget _buildSectionHeader(String title) {
    return Text(
      title,
      style: TextStyle(
        fontSize: 12.5.sp,
        fontWeight: FontWeight.bold,
        color: const Color(0xFF0D6842),
        letterSpacing: 0.5,
      ),
    );
  }

  // Task Details Card Builder
  Widget _buildTaskDetailsCard() {
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
                    color: const Color(0xFF0D6842),
                    letterSpacing: 0.5,
                  ),
                ),
                SizedBox(height: 4.h),
                Text(
                  '${_months[DateTime.now().month - 1]} ${DateTime.now().year}'
                  '${_fdoName.isEmpty ? '' : ' — $_fdoName'}',
                  style: TextStyle(
                    fontSize: 15.5.sp,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
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
          SizedBox(width: 8.w),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
            decoration: BoxDecoration(
              color: _presentToday
                  ? const Color(0xFF0D6842)
                  : const Color(0xFFB45309),
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

  // Targets Row Builder
  Widget _buildTargetsRow() {
    return Row(
      children: [
        _buildTargetCard(
          icon: Icons.person_add_alt_1_outlined,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'New Client\nTarget',
          value: '0',
        ),
        SizedBox(width: 8.w),
        _buildTargetCard(
          icon: Icons.autorenew,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'Renewal\nTarget',
          value: '0',
        ),
        SizedBox(width: 8.w),
        _buildTargetCard(
          icon: Icons.track_changes,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'Total Enr.\nTarget',
          value: '0',
        ),
        SizedBox(width: 8.w),
        _buildTargetCard(
          icon: Icons.payments_outlined,
          iconColor: const Color(0xFFB45309),
          bgColor: const Color(0xFFFEF3C7),
          title: 'Loan Disbmt\nTarget',
          value: '₹0',
        ),
      ],
    );
  }

  Widget _buildTargetCard({
    required IconData icon,
    required Color iconColor,
    required Color bgColor,
    required String title,
    required String value,
  }) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 10.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8.r),
          border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(5.w),
              decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
              child: Icon(icon, color: iconColor, size: 14.sp),
            ),
            SizedBox(height: 8.h),
            Text(
              title,
              style: TextStyle(
                fontSize: 9.5.sp,
                color: const Color(0xFF64748B),
                height: 1.2,
              ),
            ),
            SizedBox(height: 4.h),
            Text(
              value,
              style: TextStyle(
                fontSize: 15.5.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF0F172A),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Achievement Row Builder
  Widget _buildAchievementRow() {
    return Row(
      children: [
        _buildAchievementCard(
          icon: Icons.person_add_alt_1_outlined,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'New Clients',
          value: '0',
          percent: '0%',
        ),
        SizedBox(width: 8.w),
        _buildAchievementCard(
          icon: Icons.autorenew,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'Renewals',
          value: '0',
          percent: '0%',
        ),
        SizedBox(width: 8.w),
        _buildAchievementCard(
          icon: Icons.monetization_on_outlined,
          iconColor: const Color(0xFFB45309),
          bgColor: const Color(0xFFFEF3C7),
          title: 'Gold Loans',
          value: '0',
          percent: '0%',
        ),
        SizedBox(width: 8.w),
        _buildAchievementCard(
          icon: Icons.trending_up,
          iconColor: const Color(0xFF0D6842),
          bgColor: const Color(0xFFE8F5E9),
          title: 'Disbmt Amount',
          value: '₹0',
          percent: '0%',
        ),
      ],
    );
  }

  Widget _buildAchievementCard({
    required IconData icon,
    required Color iconColor,
    required Color bgColor,
    required String title,
    required String value,
    required String percent,
  }) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 10.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8.r),
          border: Border.all(color: const Color(0xFFEDF2F7), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: EdgeInsets.all(5.w),
              decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
              child: Icon(icon, color: iconColor, size: 14.sp),
            ),
            SizedBox(height: 8.h),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 9.5.sp,
                color: const Color(0xFF64748B),
              ),
            ),
            SizedBox(height: 4.h),
            Text(
              value,
              style: TextStyle(
                fontSize: 15.5.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF0F172A),
              ),
            ),
            SizedBox(height: 2.h),
            Text(
              percent,
              style: TextStyle(
                fontSize: 9.5.sp,
                color: const Color(0xFF64748B),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Collection Card Builder — live weekly demand-vs-collected % from the
  // dashboard API, scoped to the FDO's branch for the current Mon–Sun week.
  Widget _buildCollectionCard() {
    return Obx(() {
      final pct = _controller.weeklyCollectionPercent;
      final onTarget = pct != null && pct >= 100;
      final actualColor = pct == null
          ? const Color(0xFF64748B)
          : (onTarget ? const Color(0xFF0D6842) : Colors.red);
      final diff = pct == null ? null : pct - 100;
      final diffColor = diff == null
          ? const Color(0xFF64748B)
          : (diff >= 0 ? const Color(0xFF0D6842) : Colors.red);

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
            _buildSectionHeader('COLLECTION (THIS WEEK)'),
            SizedBox(height: 12.h),
            _buildTableRow(
              icon: Icons.track_changes,
              iconColor: const Color(0xFF0D6842),
              label: 'Target',
              value: '100%',
              valueColor: const Color(0xFF0D6842),
            ),
            Divider(color: const Color(0xFFEDF2F7), height: 16.h),
            _buildTableRow(
              icon: Icons.show_chart,
              iconColor: actualColor,
              label: 'Actual',
              value: pct == null ? '—' : '${pct.toStringAsFixed(2)}%',
              valueColor: actualColor,
            ),
            Divider(color: const Color(0xFFEDF2F7), height: 16.h),
            _buildTableRow(
              icon: Icons.percent,
              iconColor: diffColor,
              label: 'Difference',
              value: diff == null
                  ? '—'
                  : '${diff >= 0 ? '+' : ''}${diff.toStringAsFixed(2)}%',
              valueColor: diffColor,
            ),
            Divider(color: const Color(0xFFEDF2F7), height: 16.h),
            _buildTableRow(
              icon: Icons.payments_outlined,
              iconColor: const Color(0xFF0D6842),
              label: 'Collected',
              value: _formatCurrency(_controller.weeklyCollectionTotal),
              valueColor: const Color(0xFF0D6842),
            ),
          ],
        ),
      );
    });
  }

  // Arrears Card Builder
  Widget _buildArrearsCard() {
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
          _buildSectionHeader('ARREARS'),
          SizedBox(height: 12.h),
          _buildTableRow(
            icon: Icons.warning_amber_rounded,
            iconColor: Colors.red,
            label: 'Arrear Clients',
            value: '9',
            valueColor: const Color(0xFF0F172A),
          ),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _buildTableRow(
            icon: Icons.currency_rupee,
            iconColor: Colors.red,
            label: 'Principal',
            value: '₹12.2K',
            valueColor: const Color(0xFF0F172A),
          ),
          Divider(color: const Color(0xFFEDF2F7), height: 16.h),
          _buildTableRow(
            icon: Icons.percent,
            iconColor: Colors.red,
            label: 'Interest',
            value: '₹5.6K',
            valueColor: const Color(0xFF0F172A),
          ),
          SizedBox(height: 40.h), // Spacing to match heights of columns
        ],
      ),
    );
  }

  Widget _buildTableRow({
    required IconData icon,
    required Color iconColor,
    required String label,
    required String value,
    required Color valueColor,
  }) {
    return Row(
      children: [
        Container(
          padding: EdgeInsets.all(4.w),
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.06),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: iconColor, size: 14.sp),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11.5.sp,
              color: const Color(0xFF64748B),
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

  // PAR Card Builder
  Widget _buildParCard() {
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
                  color: const Color(0xFF64748B),
                ),
              ),
              Text(
                '28.0%',
                style: TextStyle(
                  fontSize: 13.5.sp,
                  fontWeight: FontWeight.bold,
                  color: Colors.red,
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
                widthFactor: 0.28,
                child: Container(color: Colors.red),
              ),
            ),
          ),
          SizedBox(height: 8.h),
          Text(
            '9 of 31 clients in arrears',
            style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  // Operations Summary Grid Builder (3 columns, 2 rows) — live branch stats
  // from the dashboard API (backend scopes these to the FDO's own branch).
  Widget _buildOperationsGrid() {
    return Obx(() {
      final loanDisbursement = _controller.stats['loanDisbursement'];
      return Row(
        children: [
          Expanded(
            child: Column(
              children: [
                _buildOperationsCard(
                  icon: Icons.apartment,
                  label: 'No. of Centers',
                  value: _statValue('centers'),
                  iconColor: const Color(0xFF0D6842),
                  bgColor: const Color(0xFFE8F5E9),
                ),
                SizedBox(height: 8.h),
                _buildOperationsCard(
                  icon: Icons.person_outline,
                  label: 'Active Members',
                  value: _statValue('activeMembers'),
                  iconColor: const Color(0xFF0D6842),
                  bgColor: const Color(0xFFE8F5E9),
                ),
              ],
            ),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Column(
              children: [
                _buildOperationsCard(
                  icon: Icons.qr_code_scanner,
                  label: 'Total Groups',
                  value: _statValue('groups'),
                  iconColor: const Color(0xFF0D6842),
                  bgColor: const Color(0xFFE8F5E9),
                ),
                SizedBox(height: 8.h),
                _buildOperationsCard(
                  icon: Icons.person_off_outlined,
                  label: 'Rejected Members',
                  value: _statValue('rejectedMembers'),
                  iconColor: const Color(0xFFB45309),
                  bgColor: const Color(0xFFFEF3C7),
                ),
              ],
            ),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Column(
              children: [
                _buildOperationsCard(
                  icon: Icons.person_outline,
                  label: 'Total Members',
                  value: _statValue('totalMembers'),
                  iconColor: const Color(0xFF0D6842),
                  bgColor: const Color(0xFFE8F5E9),
                ),
                SizedBox(height: 8.h),
                _buildOperationsCard(
                  icon: Icons.trending_up,
                  label: 'Loan Disbursement',
                  value: loanDisbursement == null
                      ? '—'
                      : _formatCurrency(loanDisbursement as num),
                  iconColor: const Color(0xFF0D6842),
                  bgColor: const Color(0xFFE8F5E9),
                ),
              ],
            ),
          ),
        ],
      );
    });
  }

  Widget _buildOperationsCard({
    required IconData icon,
    required String label,
    required String value,
    required Color iconColor,
    required Color bgColor,
  }) {
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
            decoration: BoxDecoration(color: bgColor, shape: BoxShape.circle),
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
                  style: TextStyle(
                    fontSize: 9.5.sp,
                    color: const Color(0xFF64748B),
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  value,
                  style: TextStyle(
                    fontSize: 15.5.sp,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Outstanding Balance Card Builder — live figure from the dashboard API.
  Widget _buildOutstandingBalanceCard() {
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
                        color: const Color(0xFF64748B),
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 4.h),
                    Obx(() {
                      final outstanding =
                          _controller.stats['outstandingBalance'];
                      return Text(
                        outstanding == null
                            ? '—'
                            : _formatCurrency(outstanding as num),
                        style: TextStyle(
                          fontSize: 20.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFFB45309),
                        ),
                      );
                    }),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
