import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

/// "My Performance" — a self-progress screen for the FDO (visits, new
/// members, loan disbursement, meetings) against a weekly/monthly/yearly
/// target. There is no backend tracking yet for visits, meetings, or
/// per-FDO targets (no such table/endpoint exists), so every stat here is a
/// static placeholder (0) rather than a fabricated number — this screen is
/// UI-only for now. Wire real numbers in once the backend adds this data.
class MyPerformance extends StatefulWidget {
  const MyPerformance({super.key});

  @override
  State<MyPerformance> createState() => _MyPerformanceState();
}

enum _Range { week, month, year }

class _MyPerformanceState extends State<MyPerformance> {
  static const _green = Color(0xFF00843D);
  static const _darkGreen = Color(0xFF0B4A2C);

  _Range _range = _Range.week;

  String get _rangeLabel => switch (_range) {
    _Range.week => 'this week',
    _Range.month => 'this month',
    _Range.year => 'this year',
  };

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF2FAF5),
    body: Column(
      children: [
        _header(context),
        Expanded(
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(16.w, 16.h, 16.w, 32.h),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _rangeTabs(),
                SizedBox(height: 16.h),
                _statsGrid(),
                SizedBox(height: 20.h),
                _progressCard(),
                SizedBox(height: 20.h),
                _recentActivities(),
              ],
            ),
          ),
        ),
      ],
    ),
  );

  Widget _header(BuildContext context) => Container(
    padding: EdgeInsets.fromLTRB(16.w, 54.h, 16.w, 22.h),
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [_green, _darkGreen],
      ),
    ),
    child: Row(
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18.sp),
        ),
        Expanded(
          child: Column(
            children: [
              Text(
                'My Performance',
                style: TextStyle(fontSize: 19.sp, fontWeight: FontWeight.w800, color: Colors.white),
              ),
              SizedBox(height: 2.h),
              Text(
                'Track your progress',
                style: TextStyle(fontSize: 11.5.sp, color: Colors.white.withValues(alpha: 0.85)),
              ),
            ],
          ),
        ),
        SizedBox(width: 18.sp), // balances the back icon so the title stays centered
      ],
    ),
  );

  Widget _rangeTabs() {
    Widget tab(String label, _Range value) {
      final active = _range == value;
      return Expanded(
        child: GestureDetector(
          onTap: () => setState(() => _range = value),
          child: Container(
            padding: EdgeInsets.symmetric(vertical: 11.h),
            decoration: BoxDecoration(
              color: active ? _green : Colors.white,
              borderRadius: BorderRadius.circular(10.r),
              border: active ? null : Border.all(color: const Color(0xFFE1EEE6)),
            ),
            alignment: Alignment.center,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5.sp,
                fontWeight: FontWeight.w700,
                color: active ? Colors.white : const Color(0xFF475569),
              ),
            ),
          ),
        ),
      );
    }

    return Container(
      padding: EdgeInsets.all(4.w),
      decoration: BoxDecoration(
        color: const Color(0xFFEAF5EE),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Row(
        children: [
          tab('This Week', _Range.week),
          SizedBox(width: 4.w),
          tab('This Month', _Range.month),
          SizedBox(width: 4.w),
          tab('This Year', _Range.year),
        ],
      ),
    );
  }

  Widget _statsGrid() => Column(
    children: [
      Row(
        children: [
          Expanded(
            child: _statCard(
              icon: Icons.location_on_rounded,
              iconBg: const Color(0xFFD8F3E3),
              iconColor: _green,
              cardBg: const Color(0xFFEFFAF3),
              value: '0',
              label: 'Total Visits',
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: _statCard(
              icon: Icons.people_alt_rounded,
              iconBg: const Color(0xFFDCEBFF),
              iconColor: const Color(0xFF2563EB),
              cardBg: const Color(0xFFEEF5FF),
              value: '0',
              label: 'New Members',
            ),
          ),
        ],
      ),
      SizedBox(height: 10.h),
      Row(
        children: [
          Expanded(
            child: _statCard(
              icon: Icons.account_balance_wallet_rounded,
              iconBg: const Color(0xFFFCEBC9),
              iconColor: const Color(0xFFB45309),
              cardBg: const Color(0xFFFFF8EC),
              value: '₹ 0',
              label: 'Loan Disbursed',
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: _statCard(
              icon: Icons.calendar_month_rounded,
              iconBg: const Color(0xFFE7DDFB),
              iconColor: const Color(0xFF7C3AED),
              cardBg: const Color(0xFFF6F1FE),
              value: '0',
              label: 'Member Meetings',
            ),
          ),
        ],
      ),
    ],
  );

  Widget _statCard({
    required IconData icon,
    required Color iconBg,
    required Color iconColor,
    required Color cardBg,
    required String value,
    required String label,
  }) => Container(
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: cardBg,
      borderRadius: BorderRadius.circular(14.r),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              width: 38.w,
              height: 38.w,
              decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
              child: Icon(icon, size: 18.sp, color: iconColor),
            ),
            // No historical baseline exists yet to compute a real "vs last
            // period" delta — omitted rather than shown as a fake number.
          ],
        ),
        SizedBox(height: 10.h),
        Text(
          value,
          style: TextStyle(fontSize: 22.sp, fontWeight: FontWeight.w800, color: const Color(0xFF0B2A1A)),
        ),
        SizedBox(height: 2.h),
        Text(
          label,
          style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF475569), fontWeight: FontWeight.w600),
        ),
      ],
    ),
  );

  Widget _progressCard() => Container(
    padding: EdgeInsets.all(16.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFE1EEE6)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _progressRow(
          title: 'Visit Progress',
          current: 0,
          target: 0,
          color: _green,
        ),
        Padding(
          padding: EdgeInsets.symmetric(vertical: 14.h),
          child: Divider(height: 1, color: const Color(0xFFF1F5F9)),
        ),
        _progressRow(
          title: 'Member Enrollment Progress',
          current: 0,
          target: 0,
          color: const Color(0xFF0EA5A5),
        ),
        Padding(
          padding: EdgeInsets.symmetric(vertical: 14.h),
          child: Divider(height: 1, color: const Color(0xFFF1F5F9)),
        ),
        _progressRow(
          title: 'Loan Disbursement Progress',
          current: 0,
          target: 0,
          color: const Color(0xFF7C3AED),
          isCurrency: true,
        ),
      ],
    ),
  );

  Widget _progressRow({
    required String title,
    required int current,
    required int target,
    required Color color,
    bool isCurrency = false,
  }) {
    final hasTarget = target > 0;
    final pct = hasTarget ? (current / target).clamp(0, 1).toDouble() : 0.0;
    String fmt(int v) => isCurrency ? '₹ $v' : '$v';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              title,
              style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700, color: const Color(0xFF0B2A1A)),
            ),
            Text(
              hasTarget ? '${fmt(current)} / ${fmt(target)}' : 'No target set',
              style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600, color: const Color(0xFF64748B)),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        Row(
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(6.r),
                child: LinearProgressIndicator(
                  value: pct,
                  minHeight: 8.h,
                  backgroundColor: const Color(0xFFE7EEEA),
                  valueColor: AlwaysStoppedAnimation(color),
                ),
              ),
            ),
            SizedBox(width: 8.w),
            Text(
              '${(pct * 100).round()}%',
              style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w800, color: color),
            ),
          ],
        ),
      ],
    );
  }

  Widget _recentActivities() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        'Recent Activities',
        style: TextStyle(fontSize: 15.sp, fontWeight: FontWeight.w800, color: const Color(0xFF0B2A1A)),
      ),
      SizedBox(height: 10.h),
      Container(
        width: double.infinity,
        padding: EdgeInsets.symmetric(vertical: 28.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14.r),
          border: Border.all(color: const Color(0xFFE1EEE6)),
        ),
        child: Column(
          children: [
            Icon(Icons.history_rounded, size: 26.sp, color: const Color(0xFFA9C4B4)),
            SizedBox(height: 8.h),
            Text(
              'No activity tracked $_rangeLabel yet.',
              style: TextStyle(fontSize: 12.5.sp, color: const Color(0xFF64748B)),
            ),
          ],
        ),
      ),
    ],
  );
}
