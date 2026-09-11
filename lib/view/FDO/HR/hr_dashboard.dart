// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';

// ─────────────────────────────────────────────────────────────────────────────
// HR Dashboard – FDO Entry Point
// Follows the shortcut-tile + scrollable sub-module pattern of home.dart
// ─────────────────────────────────────────────────────────────────────────────

class HrDashboard extends StatefulWidget {
  const HrDashboard({super.key});

  @override
  State<HrDashboard> createState() => _HrDashboardState();
}

class _HrDashboardState extends State<HrDashboard>
    with SingleTickerProviderStateMixin {
  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  late final AnimationController _animCtrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _animCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );
    _fade = CurvedAnimation(parent: _animCtrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.04),
      end: Offset.zero,
    ).animate(_fade);
    _animCtrl.forward();
  }

  @override
  void dispose() {
    _animCtrl.dispose();
    super.dispose();
  }

  // ── HR shortcut definitions ────────────────────────────────────────────────
  static final List<_HrShortcutDef> _shortcuts = [
    _HrShortcutDef(
      icon: Icons.dashboard_customize_rounded,
      label: 'HR\nDashboard',
      color: const Color(0xFF0D6842),
      destination: const HrSectionScreen(section: HrSection.dashboard),
    ),
    _HrShortcutDef(
      icon: Icons.fingerprint_rounded,
      label: 'Attendance',
      color: const Color(0xFF0284C7),
      destination: const HrSectionScreen(section: HrSection.attendance),
    ),
    _HrShortcutDef(
      icon: Icons.badge_rounded,
      label: 'Employee\nManagement',
      color: const Color(0xFF7C3AED),
      destination: const HrSectionScreen(section: HrSection.employees),
    ),
    _HrShortcutDef(
      icon: Icons.beach_access_rounded,
      label: 'Leave\nManagement',
      color: const Color(0xFFD97706),
      destination: const HrSectionScreen(section: HrSection.leaves),
    ),
    _HrShortcutDef(
      icon: Icons.account_balance_wallet_rounded,
      label: 'Payroll',
      color: const Color(0xFF059669),
      destination: const HrSectionScreen(section: HrSection.payroll),
    ),
    _HrShortcutDef(
      icon: Icons.notifications_rounded,
      label: 'Notifications',
      color: const Color(0xFFDC2626),
      destination: const HrSectionScreen(section: HrSection.notifications),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.white,
        leading: IconButton(
          icon: const Icon(
            Icons.arrow_back_ios_new_rounded,
            color: _darkText,
            size: 20,
          ),
          onPressed: () => Get.back(),
        ),
        title: Row(
          children: [
            Container(
              padding: EdgeInsets.all(6.w),
              decoration: BoxDecoration(
                color: const Color(0xFFE8F5E9),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Icon(
                Icons.people_outline_rounded,
                color: _primaryGreen,
                size: 18.sp,
              ),
            ),
            SizedBox(width: 10.w),
            Text(
              'HR Module',
              style: TextStyle(
                fontSize: 18.sp,
                fontWeight: FontWeight.w800,
                color: _darkText,
              ),
            ),
          ],
        ),
        actions: [
          Container(
            margin: EdgeInsets.only(right: 16.w),
            padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
            decoration: BoxDecoration(
              color: const Color(0xFFE8F5E9),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Text(
              'FDO',
              style: TextStyle(
                color: _primaryGreen,
                fontSize: 11.sp,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ],
      ),
      body: FadeTransition(
        opacity: _fade,
        child: SlideTransition(
          position: _slide,
          child: SingleChildScrollView(
            padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
            physics: const BouncingScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildHeroBanner(),
                SizedBox(height: 24.h),
                _sectionLabel('QUICK ACCESS'),
                SizedBox(height: 12.h),
                _buildShortcutGrid(),
                SizedBox(height: 24.h),
                _sectionLabel('HR HIGHLIGHTS'),
                SizedBox(height: 12.h),
                _buildHighlightCards(),
                SizedBox(height: 24.h),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ── Hero banner ──────────────────────────────────────────────────────────
  Widget _buildHeroBanner() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(20.w),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF0D6842), Color(0xFF0F766E)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20.r),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0D6842).withOpacity(0.28),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(14.w),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.18),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.people_outline_rounded,
              color: Colors.white,
              size: 30.sp,
            ),
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Human Resources',
                  style: TextStyle(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
                  ),
                ),
                SizedBox(height: 4.h),
                Text(
                  'Attendance \u00b7 Leaves \u00b7 Payroll \u00b7 Employees',
                  style: TextStyle(
                    fontSize: 11.sp,
                    color: Colors.white.withOpacity(0.85),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Shortcut grid (3 tiles per row matching home.dart) ──────────────────
  Widget _buildShortcutGrid() {
    final rows = <Widget>[];
    for (int i = 0; i < _shortcuts.length; i += 3) {
      final rowItems = _shortcuts.sublist(
        i,
        (i + 3 > _shortcuts.length) ? _shortcuts.length : i + 3,
      );
      rows.add(
        Row(
          children: [
            for (int j = 0; j < rowItems.length; j++) ...[
              if (j > 0) SizedBox(width: 10.w),
              Expanded(child: _buildShortcutTile(rowItems[j])),
            ],
            // Pad incomplete row
            for (int k = rowItems.length; k < 3; k++) ...[
              SizedBox(width: 10.w),
              const Expanded(child: SizedBox.shrink()),
            ],
          ],
        ),
      );
      if (i + 3 < _shortcuts.length) rows.add(SizedBox(height: 10.h));
    }
    return Column(children: rows);
  }

  Widget _buildShortcutTile(_HrShortcutDef def) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      child: InkWell(
        onTap: () => Navigator.of(
          context,
        ).push(MaterialPageRoute(builder: (_) => def.destination)),
        borderRadius: BorderRadius.circular(14.r),
        child: Container(
          height: 120.h,
          padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 12.h),
          decoration: BoxDecoration(
            border: Border.all(color: const Color(0xFFE8F0EB)),
            borderRadius: BorderRadius.circular(14.r),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: EdgeInsets.all(12.w),
                decoration: BoxDecoration(
                  color: def.color.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(def.icon, color: def.color, size: 24.sp),
              ),
              SizedBox(height: 8.h),
              Text(
                def.label,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.bold,
                  color: const Color(0xFF0D6842),
                  height: 1.2,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ── HR Highlight cards ───────────────────────────────────────────────────
  Widget _buildHighlightCards() {
    final highlights = [
      _HrHighlight(
        icon: Icons.people_alt_rounded,
        label: 'Total Employees',
        value: '124 Active',
        color: const Color(0xFF7C3AED),
      ),
      _HrHighlight(
        icon: Icons.event_available_rounded,
        label: "Today's Attendance",
        value: '118 / 124',
        color: const Color(0xFF0D6842),
      ),
      _HrHighlight(
        icon: Icons.beach_access_rounded,
        label: 'Pending Leaves',
        value: '7 Requests',
        color: const Color(0xFFD97706),
      ),
    ];

    return Column(
      children: highlights.map((h) {
        return Container(
          margin: EdgeInsets.only(bottom: 12.h),
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 14.h),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(color: const Color(0xFFF1F5F9)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: h.color.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Icon(h.icon, color: h.color, size: 20.sp),
              ),
              SizedBox(width: 14.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      h.label,
                      style: TextStyle(
                        fontSize: 12.sp,
                        color: _muted,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      h.value,
                      style: TextStyle(
                        fontSize: 15.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right_rounded, color: h.color, size: 20),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _sectionLabel(String label) {
    return Text(
      label,
      style: TextStyle(
        fontSize: 12.sp,
        fontWeight: FontWeight.w700,
        color: _muted,
        letterSpacing: 0.6,
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data models
// ─────────────────────────────────────────────────────────────────────────────

class _HrShortcutDef {
  final IconData icon;
  final String label;
  final Color color;
  final Widget destination;
  const _HrShortcutDef({
    required this.icon,
    required this.label,
    required this.color,
    required this.destination,
  });
}

class _HrHighlight {
  final IconData icon;
  final String label;
  final String value;
  final Color color;
  const _HrHighlight({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Section enum (public so HrSectionScreen can reference it)
// ─────────────────────────────────────────────────────────────────────────────
enum HrSection {
  dashboard,
  attendance,
  employees,
  leaves,
  payroll,
  notifications,
}

// ─────────────────────────────────────────────────────────────────────────────
// HrSectionScreen – sub-module screen, mirrors Collection in collection.dart
// Shows: header row + divider + scrollable list of sub-feature cards
// ─────────────────────────────────────────────────────────────────────────────
class HrSectionScreen extends StatelessWidget {
  final HrSection section;
  const HrSectionScreen({super.key, required this.section});

  // ── Metadata ────────────────────────────────────────────────────────────
  String get _title {
    switch (section) {
      case HrSection.dashboard:
        return 'HR Dashboard';
      case HrSection.attendance:
        return 'Attendance';
      case HrSection.employees:
        return 'Employee Management';
      case HrSection.leaves:
        return 'Leave Management';
      case HrSection.payroll:
        return 'Payroll';
      case HrSection.notifications:
        return 'Notifications';
    }
  }

  IconData get _icon {
    switch (section) {
      case HrSection.dashboard:
        return Icons.dashboard_customize_rounded;
      case HrSection.attendance:
        return Icons.fingerprint_rounded;
      case HrSection.employees:
        return Icons.badge_rounded;
      case HrSection.leaves:
        return Icons.beach_access_rounded;
      case HrSection.payroll:
        return Icons.account_balance_wallet_rounded;
      case HrSection.notifications:
        return Icons.notifications_rounded;
    }
  }

  Color get _accent {
    switch (section) {
      case HrSection.dashboard:
        return const Color(0xFF0D6842);
      case HrSection.attendance:
        return const Color(0xFF0284C7);
      case HrSection.employees:
        return const Color(0xFF7C3AED);
      case HrSection.leaves:
        return const Color(0xFFD97706);
      case HrSection.payroll:
        return const Color(0xFF059669);
      case HrSection.notifications:
        return const Color(0xFFDC2626);
    }
  }

  // ── Sub-feature list ─────────────────────────────────────────────────────
  List<_SubFeature> get _features {
    switch (section) {
      case HrSection.dashboard:
        return [
          const _SubFeature(
            title: 'KPI Overview',
            subtitle: '12 live KPI cards – headcount, leave, attendance rate',
            icon: Icons.bar_chart_rounded,
          ),
          const _SubFeature(
            title: 'Charts & Trends',
            subtitle: 'Joining, exit, attendance & incentive trend lines',
            icon: Icons.show_chart_rounded,
          ),
          const _SubFeature(
            title: 'Pending Actions',
            subtitle: 'Aggregated approvals & reminders from My Tasks',
            icon: Icons.task_alt_rounded,
          ),
        ];
      case HrSection.attendance:
        return [
          const _SubFeature(
            title: 'Mark Attendance',
            subtitle: 'Bulk daily marking per employee for the branch',
            icon: Icons.checklist_rounded,
          ),
          const _SubFeature(
            title: 'Punch In / Punch Out',
            subtitle: 'GPS + face-verified punch recording',
            icon: Icons.login_rounded,
          ),
          const _SubFeature(
            title: 'Attendance Report',
            subtitle: 'Daily, monthly, per-branch absentee summary',
            icon: Icons.summarize_rounded,
          ),
        ];
      case HrSection.employees:
        return [
          const _SubFeature(
            title: 'Employee Master',
            subtitle: 'Full personal, org, bank & address record',
            icon: Icons.person_rounded,
          ),
          const _SubFeature(
            title: 'Documents',
            subtitle: 'KYC, BGV, appointment & education documents',
            icon: Icons.folder_rounded,
          ),
          const _SubFeature(
            title: 'Employee List',
            subtitle: 'Searchable paginated directory of all staff',
            icon: Icons.list_alt_rounded,
          ),
          const _SubFeature(
            title: 'My Profile',
            subtitle: 'Self-service: view & edit your own record',
            icon: Icons.manage_accounts_rounded,
          ),
        ];
      case HrSection.leaves:
        return [
          const _SubFeature(
            title: 'Leave Types',
            subtitle: 'CL, SL, PL and custom configured leave types',
            icon: Icons.category_rounded,
          ),
          const _SubFeature(
            title: 'Leave Application',
            subtitle: 'Apply, view balance & cancel pending requests',
            icon: Icons.send_rounded,
          ),
          const _SubFeature(
            title: 'Leave Approval',
            subtitle: 'Manager / HR approve or reject leave requests',
            icon: Icons.approval_rounded,
          ),
          const _SubFeature(
            title: 'Leave Balance',
            subtitle: 'Opening / used / remaining balance per employee',
            icon: Icons.balance_rounded,
          ),
        ];
      case HrSection.payroll:
        return [
          const _SubFeature(
            title: 'Salary Master',
            subtitle: 'Component-based salary structure per employee',
            icon: Icons.settings_rounded,
          ),
          const _SubFeature(
            title: 'Payroll Processing',
            subtitle: 'Working days, LOP, incentive & loan deductions',
            icon: Icons.calculate_rounded,
          ),
          const _SubFeature(
            title: 'Salary Report',
            subtitle: 'Monthly payroll & salary register download',
            icon: Icons.receipt_long_rounded,
          ),
          const _SubFeature(
            title: 'Salary Letter',
            subtitle: 'Generated CTC / offer letter per employee',
            icon: Icons.description_rounded,
          ),
        ];
      case HrSection.notifications:
        return [
          const _SubFeature(
            title: 'System Alerts',
            subtitle: 'EOD reminders, approval alerts & deadlines',
            icon: Icons.notifications_active_rounded,
          ),
          const _SubFeature(
            title: 'Wishes',
            subtitle: 'Birthday, Work Anniversary & New Joiner greetings',
            icon: Icons.celebration_rounded,
          ),
          const _SubFeature(
            title: 'Announcements',
            subtitle: 'HR & admin broadcasts to all employees',
            icon: Icons.campaign_rounded,
          ),
        ];
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = _accent;
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: Text(_title),
      ),
      body: SafeArea(
        child: Stack(
          children: [
            // Bottom wave decoration – mirrors collection.dart
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: CustomPaint(
                size: Size(double.infinity, 100.h),
                painter: _WavePainter(color: accent),
              ),
            ),
            // Main content
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(height: 16.h),
                  // Section header row (matches Collection header)
                  Row(
                    children: [
                      Icon(_icon, color: accent, size: 32.sp),
                      SizedBox(width: 8.w),
                      Text(
                        _title,
                        style: TextStyle(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w900,
                          color: accent,
                          letterSpacing: -0.3,
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 12.h),
                  Divider(color: accent, thickness: 1.2, height: 1),
                  SizedBox(height: 20.h),
                  // Sub-feature list
                  Expanded(
                    child: ListView(
                      physics: const BouncingScrollPhysics(),
                      children: [
                        ..._features.map(
                          (f) => _SubFeatureOption(
                            feature: f,
                            accent: accent,
                            onTap: () {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('${f.title} — coming soon'),
                                  backgroundColor: accent,
                                  behavior: SnackBarBehavior.floating,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10.r),
                                  ),
                                  duration: const Duration(seconds: 1),
                                ),
                              );
                            },
                          ),
                        ),
                        SizedBox(height: 120.h),
                      ],
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-feature card – mirrors _CollectionOption from collection.dart
// ─────────────────────────────────────────────────────────────────────────────
class _SubFeature {
  final String title;
  final String subtitle;
  final IconData icon;
  const _SubFeature({
    required this.title,
    required this.subtitle,
    required this.icon,
  });
}

class _SubFeatureOption extends StatelessWidget {
  const _SubFeatureOption({
    required this.feature,
    required this.accent,
    required this.onTap,
  });

  final _SubFeature feature;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: EdgeInsets.only(bottom: 14.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
        border: Border.all(color: const Color(0xFFF1F5F9)),
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(16.r),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16.r),
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
            child: Row(
              children: [
                // Circle Icon (matches _CollectionOption layout)
                Container(
                  width: 52.w,
                  height: 52.w,
                  decoration: BoxDecoration(
                    color: accent.withOpacity(0.1),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(feature.icon, color: accent, size: 24.sp),
                ),
                SizedBox(width: 14.w),
                // Vertical divider
                Container(
                  width: 1,
                  height: 34.h,
                  color: const Color(0xFFE2E8F0),
                ),
                SizedBox(width: 14.w),
                // Text
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        feature.title,
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.bold,
                          color: accent,
                        ),
                      ),
                      SizedBox(height: 4.h),
                      Text(
                        feature.subtitle,
                        style: TextStyle(
                          fontSize: 11.5.sp,
                          color: const Color(0xFF64748B),
                          height: 1.3,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  Icons.chevron_right_rounded,
                  color: accent.withOpacity(0.6),
                  size: 20,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Wave painter – matches collection.dart bottom decoration style
// ─────────────────────────────────────────────────────────────────────────────
class _WavePainter extends CustomPainter {
  final Color color;
  const _WavePainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint1 = Paint()
      ..color = color.withOpacity(0.06)
      ..style = PaintingStyle.fill;

    final path1 = Path()
      ..moveTo(0, size.height * 0.5)
      ..quadraticBezierTo(
        size.width * 0.25,
        size.height * 0.2,
        size.width * 0.5,
        size.height * 0.45,
      )
      ..quadraticBezierTo(
        size.width * 0.75,
        size.height * 0.7,
        size.width,
        size.height * 0.35,
      )
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path1, paint1);

    final paint2 = Paint()
      ..color = color.withOpacity(0.04)
      ..style = PaintingStyle.fill;

    final path2 = Path()
      ..moveTo(0, size.height * 0.7)
      ..quadraticBezierTo(
        size.width * 0.3,
        size.height * 0.4,
        size.width * 0.6,
        size.height * 0.65,
      )
      ..quadraticBezierTo(
        size.width * 0.8,
        size.height * 0.85,
        size.width,
        size.height * 0.6,
      )
      ..lineTo(size.width, size.height)
      ..lineTo(0, size.height)
      ..close();
    canvas.drawPath(path2, paint2);
  }

  @override
  bool shouldRepaint(_WavePainter oldDelegate) => oldDelegate.color != color;
}
