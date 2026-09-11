// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';

/// HrHome — landing screen shown when any HR sub-module is tapped.
/// Replace each [_buildSection] body with the real screen when ready.
class HrHome extends StatefulWidget {
  final String section; // e.g. 'HR Dashboard', 'Attendance', …
  const HrHome({super.key, required this.section});

  @override
  State<HrHome> createState() => _HrHomeState();
}

class _HrHomeState extends State<HrHome> with SingleTickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  late AnimationController _ctrl;
  late Animation<double> _fade;
  late Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(begin: const Offset(0, 0.12), end: Offset.zero)
        .animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  // ── icon & colour per section ──────────────────────────────────────────────
  IconData get _icon {
    switch (widget.section) {
      case 'HR Dashboard':
        return Icons.dashboard_customize_rounded;
      case 'Attendance':
        return Icons.fingerprint_rounded;
      case 'Employee Management':
        return Icons.badge_rounded;
      case 'Leave Management':
        return Icons.beach_access_rounded;
      case 'Payroll':
        return Icons.account_balance_wallet_rounded;
      case 'Notifications':
        return Icons.notifications_rounded;
      default:
        return Icons.corporate_fare_rounded;
    }
  }

  Color get _accentColor {
    switch (widget.section) {
      case 'HR Dashboard':
        return const Color(0xFF0D6842);
      case 'Attendance':
        return const Color(0xFF0284C7);
      case 'Employee Management':
        return const Color(0xFF7C3AED);
      case 'Leave Management':
        return const Color(0xFFD97706);
      case 'Payroll':
        return const Color(0xFF059669);
      case 'Notifications':
        return const Color(0xFFDC2626);
      default:
        return const Color(0xFF4338CA);
    }
  }

  // ── sub-features per section ───────────────────────────────────────────────
  List<_FeatureItem> get _features {
    switch (widget.section) {
      case 'HR Dashboard':
        return [
          _FeatureItem('KPI Overview', Icons.bar_chart_rounded,
              '12 live KPI cards (headcount, leave, attendance)'),
          _FeatureItem('Charts & Trends', Icons.show_chart_rounded,
              'Joining, exit, attendance & incentive trends'),
          _FeatureItem('Pending Actions', Icons.task_alt_rounded,
              'Aggregated approvals & reminders from My Tasks'),
        ];
      case 'Attendance':
        return [
          _FeatureItem('Attendance', Icons.checklist_rounded,
              'Bulk daily marking per employee'),
          _FeatureItem('Punch In / Punch Out', Icons.login_rounded,
              'GPS + face-verified punches'),
          _FeatureItem('Attendance Report', Icons.summarize_rounded,
              'Daily, monthly, per-branch absentee views'),
        ];
      case 'Employee Management':
        return [
          _FeatureItem('Employee Master', Icons.person_rounded,
              'Full personal, org, bank & address record'),
          _FeatureItem('Documents', Icons.folder_rounded,
              'KYC, BGV, appointment & education docs'),
          _FeatureItem('Employee List', Icons.list_alt_rounded,
              'Searchable paginated directory'),
          _FeatureItem('My Profile', Icons.manage_accounts_rounded,
              'Self-service: view & edit own record'),
        ];
      case 'Leave Management':
        return [
          _FeatureItem('Leave Types', Icons.category_rounded,
              'CL, SL, PL and custom types'),
          _FeatureItem('Leave Application', Icons.send_rounded,
              'Apply, view balance & cancel pending'),
          _FeatureItem('Leave Approval', Icons.approval_rounded,
              'Manager / HR approve or reject leaves'),
          _FeatureItem('Leave Balance', Icons.balance_rounded,
              'Opening / used / remaining per employee'),
        ];
      case 'Payroll':
        return [
          _FeatureItem('Salary Master', Icons.settings_rounded,
              'Component-based structure per employee'),
          _FeatureItem('Payroll Processing', Icons.calculate_rounded,
              'Working days, LOP, incentive, loan deductions'),
          _FeatureItem('Salary Report', Icons.receipt_long_rounded,
              'Monthly payroll & salary register'),
          _FeatureItem('Salary Letter', Icons.description_rounded,
              'Generated CTC / offer letter per employee'),
        ];
      case 'Notifications':
        return [
          _FeatureItem('System Alerts', Icons.notifications_active_rounded,
              'EOD reminders, approval alerts, deadlines'),
          _FeatureItem('Wishes', Icons.celebration_rounded,
              'Birthday, Work Anniversary & New Joiner greetings'),
          _FeatureItem('Announcements', Icons.campaign_rounded,
              'HR & admin broadcasts to all employees'),
        ];
      default:
        return [
          _FeatureItem(widget.section, Icons.construction_rounded,
              'Under development — coming soon'),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          widget.section,
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
      ),
      body: FadeTransition(
        opacity: _fade,
        child: SlideTransition(
          position: _slide,
          child: ListView(
            padding: EdgeInsets.all(20.w),
            children: [
              // Hero banner
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(24.w),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [_accentColor, _accentColor.withOpacity(0.75)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(20.r),
                  boxShadow: [
                    BoxShadow(
                      color: _accentColor.withOpacity(0.28),
                      blurRadius: 24,
                      offset: const Offset(0, 8),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      padding: EdgeInsets.all(14.w),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(_icon, color: Colors.white, size: 32.sp),
                    ),
                    SizedBox(width: 16.w),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            widget.section,
                            style: GoogleFonts.inter(
                              fontSize: 18.sp,
                              fontWeight: FontWeight.w800,
                              color: Colors.white,
                            ),
                          ),
                          SizedBox(height: 4.h),
                          Text(
                            'HR Module • Sarvam MFI',
                            style: GoogleFonts.inter(
                              fontSize: 12.sp,
                              color: Colors.white.withOpacity(0.85),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(height: 24.h),
              // Section label
              Text(
                'Available Features',
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w700,
                  color: _muted,
                  letterSpacing: 0.5,
                ),
              ),
              SizedBox(height: 12.h),
              // Feature cards
              ..._features.map((f) => _FeatureCard(item: f, accent: _accentColor)),
              SizedBox(height: 24.h),
              // Coming-soon badge
              Center(
                child: Container(
                  padding:
                      EdgeInsets.symmetric(horizontal: 20.w, vertical: 10.h),
                  decoration: BoxDecoration(
                    color: _accentColor.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(30.r),
                    border: Border.all(
                        color: _accentColor.withOpacity(0.25), width: 1),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.rocket_launch_rounded,
                          color: _accentColor, size: 16.sp),
                      SizedBox(width: 8.w),
                      Text(
                        'Full build — Phase A → F Roadmap',
                        style: GoogleFonts.inter(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w600,
                          color: _accentColor,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Supporting types ────────────────────────────────────────────────────────

class _FeatureItem {
  final String title;
  final IconData icon;
  final String description;
  const _FeatureItem(this.title, this.icon, this.description);
}

class _FeatureCard extends StatelessWidget {
  final _FeatureItem item;
  final Color accent;
  const _FeatureCard({required this.item, required this.accent});

  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: 10.h),
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
        contentPadding:
            EdgeInsets.symmetric(horizontal: 16.w, vertical: 6.h),
        leading: Container(
          padding: EdgeInsets.all(10.w),
          decoration: BoxDecoration(
            color: accent.withOpacity(0.1),
            borderRadius: BorderRadius.circular(12.r),
          ),
          child: Icon(item.icon, color: accent, size: 20.sp),
        ),
        title: Text(
          item.title,
          style: GoogleFonts.inter(
            fontSize: 13.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        subtitle: Text(
          item.description,
          style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
        ),
        trailing: Icon(Icons.arrow_forward_ios_rounded,
            color: accent.withOpacity(0.5), size: 14),
        onTap: () {
          // TODO: navigate to individual sub-screen when built
        },
      ),
    );
  }
}
