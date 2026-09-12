// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// HrHome — the HR module's landing screen (reached from the Field Officer
/// home screen's "HRM" tile). Shows quick-access tiles into the HR
/// sub-modules, a next-meeting card, and recent updates.
class HrHome extends StatefulWidget {
  const HrHome({super.key});

  @override
  State<HrHome> createState() => _HrHomeState();
}

class _HrHomeState extends State<HrHome> with SingleTickerProviderStateMixin {
  // ── Colors ────────────────────────────────────────────────────────────────
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _yellowAccent = Color(0xFFFEF3C7);
  static const _yellowText = Color(0xFFB45309);
  static const _lightGreenBg = Color(0xFFE8F5E9);
  static const _lightYellowBg = Color(0xFFFFF8E1);
  static const _borderColor = Color(0xFFE2E8F0);

  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  String _fullName = '';
  String _role = 'Field Officer';

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    _ctrl.forward();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      final firstName = prefs.getString('firstName') ?? '';
      final lastName = prefs.getString('lastName') ?? '';
      _fullName = '$firstName $lastName'.trim();
      _role =
          prefs.getString('rbacRoleName') ??
          prefs.getString('role') ??
          'Field Officer';
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  String get _greeting {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'GOOD MORNING';
    if (hour < 17) return 'GOOD AFTERNOON';
    return 'GOOD EVENING';
  }

  String get _dateText {
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
    final now = DateTime.now();
    return '${weekdays[now.weekday - 1]}, ${now.day} ${months[now.month - 1]} ${now.year}';
  }

  void _comingSoon(String label) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$label — coming soon'),
        backgroundColor: _greenAccent,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
        duration: const Duration(seconds: 1),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: FadeTransition(
                opacity: _fade,
                child: SlideTransition(
                  position: _slide,
                  child: SingleChildScrollView(
                    padding: EdgeInsets.symmetric(
                      horizontal: 20.w,
                      vertical: 16.h,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _buildHeroBanner(),
                        SizedBox(height: 20.h),
                        _buildQuickActionsGrid(),
                        SizedBox(height: 20.h),
                        _buildMeetingCard(),
                        SizedBox(height: 24.h),
                        _buildFooterBanner(),
                        SizedBox(height: 20.h),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _buildBottomNavBar(context),
    );
  }

  // ── Header Widget ──────────────────────────────────────────────────────────
  Widget _buildHeader() {
    return Container(
      padding: EdgeInsets.fromLTRB(20.w, 10.h, 20.w, 14.h),
      color: Colors.white,
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Image.asset(
                  'assets/icon/Sarvam_01.png',
                  width: 155.w,
                  height: 54.h,
                  fit: BoxFit.contain,
                  alignment: Alignment.centerLeft,
                ),
                SizedBox(height: 2.h),
                Text(
                  'SARVAM MICROFINANCE ERP',
                  style: GoogleFonts.inter(
                    fontSize: 8.5.sp,
                    letterSpacing: 2.0,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          Stack(
            clipBehavior: Clip.none,
            children: [
              Icon(Icons.notifications_rounded, size: 28.sp, color: _darkText),
              Positioned(
                right: 1,
                top: 0,
                child: Container(
                  width: 9.w,
                  height: 9.w,
                  decoration: const BoxDecoration(
                    color: Colors.amber,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(width: 12.w),
          Column(
            children: [
              CircleAvatar(
                radius: 22.r,
                backgroundColor: const Color(0xFFE2E8F0),
                backgroundImage: const AssetImage('assets/icon/profile.png'),
              ),
              SizedBox(height: 3.h),
              Text(
                'Hi, ${_fullName.isEmpty ? 'there' : _fullName.split(' ').first}',
                style: GoogleFonts.inter(
                  fontSize: 10.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              Text(
                _role,
                style: GoogleFonts.inter(fontSize: 8.5.sp, color: _muted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Hero Banner ────────────────────────────────────────────────────────────
  Widget _buildHeroBanner() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(20.r),
      child: AspectRatio(
        aspectRatio: 1600 / 600,
        child: Stack(
          children: [
            Positioned.fill(
              child: Image.asset(
                'assets/images/home_banner_top.png',
                fit: BoxFit.cover,
                filterQuality: FilterQuality.high,
              ),
            ),
            Positioned(
              left: 20.w,
              bottom: 15.h,
              child: Row(
                children: [
                  Icon(
                    Icons.event_available_rounded,
                    color: _greenAccent,
                    size: 18.sp,
                  ),
                  SizedBox(width: 7.w),
                  Text(
                    _dateText,
                    style: GoogleFonts.inter(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w600,
                      color: _darkText,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Quick Actions Grid ─────────────────────────────────────────────────────
  Widget _buildQuickActionsGrid() {
    final actions = [
      _QuickAction(
        Icons.location_on_rounded,
        'Live Tracking',
        _lightGreenBg,
        _greenAccent,
      ),
      _QuickAction(
        Icons.fingerprint_rounded,
        'Attendance',
        _lightYellowBg,
        _yellowText,
      ),
      _QuickAction(
        Icons.calendar_month_rounded,
        'Apply Leave',
        _lightGreenBg,
        _greenAccent,
      ),
      _QuickAction(
        Icons.description_rounded,
        'My Leave',
        _lightYellowBg,
        _yellowText,
      ),
      _QuickAction(
        Icons.business_center_rounded,
        'Company\nPolicies',
        _lightGreenBg,
        _greenAccent,
      ),
      _QuickAction(
        Icons.speed_rounded,
        'My Performance',
        _lightYellowBg,
        _yellowText,
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: actions.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        mainAxisSpacing: 12.h,
        crossAxisSpacing: 12.w,
        childAspectRatio: 1.03,
      ),
      itemBuilder: (context, index) {
        final item = actions[index];
        return _StaggeredTile(
          index: index,
          controller: _ctrl,
          child: Material(
            color: item.bg,
            borderRadius: BorderRadius.circular(14.r),
            child: InkWell(
              borderRadius: BorderRadius.circular(14.r),
              onTap: () => _comingSoon(item.label.replaceAll('\n', ' ')),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(item.icon, color: item.color, size: 28.sp),
                  SizedBox(height: 8.h),
                  Text(
                    item.label,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      fontWeight: FontWeight.w600,
                      color: _darkText,
                      height: 1.2,
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

  // ── Next Weekly Meeting Card ───────────────────────────────────────────────
  Widget _buildMeetingCard() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(color: _borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.groups_rounded, color: _greenAccent, size: 20.sp),
              SizedBox(width: 8.w),
              Text(
                'Next Weekly Meeting',
                style: GoogleFonts.inter(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: () => _comingSoon('Meetings'),
                child: Row(
                  children: [
                    Text(
                      'View All',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w600,
                        color: _greenAccent,
                      ),
                    ),
                    Icon(
                      Icons.chevron_right_rounded,
                      color: _greenAccent,
                      size: 18.sp,
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 14.h),
          Row(
            children: [
              Icon(Icons.location_on_rounded, color: _greenAccent, size: 18.sp),
              SizedBox(width: 10.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '34 - METTUPATTI (VANNAR ST)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w600,
                        color: _darkText,
                      ),
                    ),
                    SizedBox(height: 7.h),
                    Row(
                      children: [
                        Icon(
                          Icons.event_available_rounded,
                          color: _greenAccent,
                          size: 16.sp,
                        ),
                        SizedBox(width: 6.w),
                        Text(
                          '12 Sep 2026  |  10:00 AM',
                          style: GoogleFonts.inter(
                            fontSize: 10.5.sp,
                            color: _muted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                width: 36.w,
                height: 36.w,
                decoration: const BoxDecoration(
                  color: _yellowAccent,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.arrow_forward_ios_rounded,
                  color: _yellowText,
                  size: 16.sp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Recent Updates List ────────────────────────────────────────────────────
  Widget _buildRecentUpdates() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              'Recent Updates',
              style: GoogleFonts.inter(
                fontSize: 16.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            const Spacer(),
          ],
        ),
        SizedBox(height: 12.h),
        Container(
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16.r),
            border: Border.all(color: _borderColor),
          ),
          child: const Column(
            children: [
              _UpdateRow(
                Icons.flight_rounded,
                'Leave request submitted',
                '2 days ago',
                Color(0xFF059669),
              ),
              Divider(height: 1),
              _UpdateRow(
                Icons.description_rounded,
                'Policy updated',
                '3 days ago',
                Color(0xFFFBBF24),
              ),
              Divider(height: 1),
              _UpdateRow(
                Icons.bar_chart_rounded,
                'Performance goal assigned',
                '5 days ago',
                Color(0xFF059669),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Footer Banner ──────────────────────────────────────────────────────────
  Widget _buildFooterBanner() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16.r),
      child: SizedBox(
        height: 92.h,
        child: Image.asset(
          'assets/images/home_banner_bttom.png',
          fit: BoxFit.fill,
          filterQuality: FilterQuality.high,
        ),
      ),
    );
  }

  // ── Bottom Navigation Bar ──────────────────────────────────────────────────
  Widget _buildBottomNavBar(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: _borderColor, width: 1)),
      ),
      child: BottomNavigationBar(
        currentIndex: 0,
        selectedItemColor: _greenAccent,
        unselectedItemColor: _muted,
        showUnselectedLabels: true,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
        backgroundColor: Colors.transparent,
        selectedLabelStyle: GoogleFonts.inter(
          fontSize: 11.sp,
          fontWeight: FontWeight.w600,
        ),
        unselectedLabelStyle: GoogleFonts.inter(
          fontSize: 11.sp,
          fontWeight: FontWeight.w500,
        ),
        onTap: (index) {
          if (index == 0) return;
          if (index == 1) {
            _comingSoon('Leave');
          } else {
            _comingSoon('Profile');
          }
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.home_rounded),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.calendar_today_rounded),
            label: 'Leave',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person_rounded),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}

class _QuickAction {
  final IconData icon;
  final String label;
  final Color bg;
  final Color color;
  const _QuickAction(this.icon, this.label, this.bg, this.color);
}

class _UpdateRow extends StatelessWidget {
  const _UpdateRow(this.icon, this.title, this.time, this.color);

  final IconData icon;
  final String title;
  final String time;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 9.h),
      child: Row(
        children: [
          Container(
            width: 38.w,
            height: 38.w,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: Colors.white, size: 20.sp),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: GoogleFonts.inter(
                    fontSize: 11.5.sp,
                    fontWeight: FontWeight.w600,
                    color: _HrHomeState._darkText,
                  ),
                ),
                SizedBox(height: 3.h),
                Text(
                  time,
                  style: GoogleFonts.inter(
                    fontSize: 10.sp,
                    color: _HrHomeState._muted,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            Icons.chevron_right_rounded,
            color: _HrHomeState._muted,
            size: 20.sp,
          ),
        ],
      ),
    );
  }
}

/// Staggers each grid tile's entrance off the shared [controller] — later
/// tiles start fading/scaling in slightly after earlier ones.
class _StaggeredTile extends StatelessWidget {
  const _StaggeredTile({
    required this.index,
    required this.controller,
    required this.child,
  });

  final int index;
  final AnimationController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final start = (index * 0.08).clamp(0.0, 0.6);
    final end = (start + 0.4).clamp(0.0, 1.0);
    final curved = CurvedAnimation(
      parent: controller,
      curve: Interval(start, end, curve: Curves.easeOutCubic),
    );
    return FadeTransition(
      opacity: curved,
      child: ScaleTransition(
        scale: Tween<double>(begin: 0.85, end: 1).animate(curved),
        child: child,
      ),
    );
  }
}
