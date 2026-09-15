// ignore_for_file: deprecated_member_use

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

import 'view_all_attendance.dart';

enum DayStatus { present, absent, onLeave, holiday }

const kPresentColor = Color(0xFF16A34A);
const kAbsentColor = Color(0xFFEF4444);
const kOnLeaveColor = Color(0xFFF59E0B);
const kHolidayColor = Color(0xFF64748B);

String statusLabel(DayStatus s) {
  switch (s) {
    case DayStatus.present:
      return 'Present';
    case DayStatus.absent:
      return 'Absent';
    case DayStatus.onLeave:
      return 'On Leave';
    case DayStatus.holiday:
      return 'Holiday';
  }
}

Color statusColor(DayStatus s) {
  switch (s) {
    case DayStatus.present:
      return kPresentColor;
    case DayStatus.absent:
      return kAbsentColor;
    case DayStatus.onLeave:
      return kOnLeaveColor;
    case DayStatus.holiday:
      return kHolidayColor;
  }
}

/// Sep 2026 is the "current" demo month — its per-day statuses are hand
/// picked so the week/month/year views and the View All list all agree
/// with each other (23 present / 3 absent / 2 on leave / 2 holiday = 30).
final Map<int, DayStatus> _septemberStatuses = {
  1: DayStatus.present,
  2: DayStatus.present,
  3: DayStatus.present,
  4: DayStatus.absent,
  5: DayStatus.present,
  6: DayStatus.holiday,
  7: DayStatus.onLeave,
  8: DayStatus.present,
  9: DayStatus.present,
  10: DayStatus.absent,
  11: DayStatus.present,
  12: DayStatus.present,
  13: DayStatus.onLeave,
  14: DayStatus.present,
  15: DayStatus.present,
  16: DayStatus.absent,
  17: DayStatus.present,
  18: DayStatus.present,
  19: DayStatus.present,
  20: DayStatus.holiday,
  21: DayStatus.present,
  22: DayStatus.present,
  23: DayStatus.present,
  24: DayStatus.present,
  25: DayStatus.present,
  26: DayStatus.present,
  27: DayStatus.present,
  28: DayStatus.present,
  29: DayStatus.present,
  30: DayStatus.present,
};

DayStatus statusFor(DateTime date) {
  if (date.year == 2026 && date.month == 9) {
    return _septemberStatuses[date.day] ?? DayStatus.present;
  }
  if (date.day % 11 == 0) return DayStatus.absent;
  if (date.day % 9 == 0) return DayStatus.onLeave;
  if (date.weekday == DateTime.sunday && date.day % 14 == 6) {
    return DayStatus.holiday;
  }
  return DayStatus.present;
}

class MonthTally {
  final int present;
  final int absent;
  final int onLeave;
  final int holiday;
  final int totalDays;
  const MonthTally({
    required this.present,
    required this.absent,
    required this.onLeave,
    required this.holiday,
    required this.totalDays,
  });

  int get tracked => present + absent + onLeave + holiday;
}

MonthTally tallyForMonth(int year, int month, {required bool hasData}) {
  final daysInMonth = DateTime(year, month + 1, 0).day;
  if (!hasData) {
    return MonthTally(
      present: 0,
      absent: 0,
      onLeave: 0,
      holiday: 0,
      totalDays: daysInMonth,
    );
  }
  var present = 0, absent = 0, onLeave = 0, holiday = 0;
  for (var d = 1; d <= daysInMonth; d++) {
    switch (statusFor(DateTime(year, month, d))) {
      case DayStatus.present:
        present++;
        break;
      case DayStatus.absent:
        absent++;
        break;
      case DayStatus.onLeave:
        onLeave++;
        break;
      case DayStatus.holiday:
        holiday++;
        break;
    }
  }
  return MonthTally(
    present: present,
    absent: absent,
    onLeave: onLeave,
    holiday: holiday,
    totalDays: daysInMonth,
  );
}

const _weekdayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const _weekdayShortSunFirst = [
  'Sun',
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
];
const _monthNamesFull = [
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
const _monthNamesShort = [
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
const _weekdayFullName = {
  DateTime.monday: 'Monday',
  DateTime.tuesday: 'Tuesday',
  DateTime.wednesday: 'Wednesday',
  DateTime.thursday: 'Thursday',
  DateTime.friday: 'Friday',
  DateTime.saturday: 'Saturday',
  DateTime.sunday: 'Sunday',
};

enum _RangeTab { week, month, year }

/// AttendanceStatus — HR module screen for a field officer's own attendance,
/// switchable between Week / Month / Year views, with a link into the full
/// searchable "View All Attendance" history. Reached from HrHome's
/// "Attendance" quick-action tile.
class AttendanceStatus extends StatefulWidget {
  const AttendanceStatus({super.key});

  @override
  State<AttendanceStatus> createState() => _AttendanceStatusState();
}

class _AttendanceStatusState extends State<AttendanceStatus>
    with SingleTickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _borderColor = Color(0xFFE2E8F0);
  static final _today = DateTime(2026, 9, 12);

  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  _RangeTab _tab = _RangeTab.week;
  late DateTime _weekAnchor;
  late DateTime _monthAnchor;
  int _year = 2026;

  @override
  void initState() {
    super.initState();
    _weekAnchor = _today.subtract(Duration(days: _today.weekday - 1));
    _monthAnchor = DateTime(_today.year, _today.month);
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 650),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    _ctrl.forward();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  void _selectTab(_RangeTab tab) {
    if (_tab == tab) return;
    setState(() => _tab = tab);
    _ctrl.forward(from: 0);
  }

  void _shiftWeek(int deltaWeeks) {
    setState(() {
      _weekAnchor = _weekAnchor.add(Duration(days: 7 * deltaWeeks));
    });
    _ctrl.forward(from: 0);
  }

  void _shiftMonth(int delta) {
    setState(() {
      _monthAnchor = DateTime(_monthAnchor.year, _monthAnchor.month + delta);
    });
    _ctrl.forward(from: 0);
  }

  void _shiftYear(int delta) {
    setState(() => _year += delta);
    _ctrl.forward(from: 0);
  }

  void _openViewAll() {
    Navigator.of(context).push(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 350),
        pageBuilder: (_, animation, __) => const ViewAllAttendance(),
        transitionsBuilder: (_, animation, __, child) {
          return FadeTransition(
            opacity: animation,
            child: SlideTransition(
              position: Tween<Offset>(
                begin: const Offset(0.05, 0),
                end: Offset.zero,
              ).animate(
                CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
              ),
              child: child,
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(context),
            _buildTabBar(),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 24.h),
                child: FadeTransition(
                  opacity: _fade,
                  child: SlideTransition(
                    position: _slide,
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 250),
                      child: KeyedSubtree(
                        key: ValueKey(_tab),
                        child: switch (_tab) {
                          _RangeTab.week => _buildWeekView(),
                          _RangeTab.month => _buildMonthView(),
                          _RangeTab.year => _buildYearView(),
                        },
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

  // ── Header ──────────────────────────────────────────────────────────────
  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(12.w, 10.h, 20.w, 12.h),
      color: Colors.white,
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_rounded, color: _darkText, size: 22.sp),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Attendance Status',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  'Track your attendance',
                  style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Segmented tab bar ───────────────────────────────────────────────────
  Widget _buildTabBar() {
    return Container(
      margin: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 12.h),
      padding: EdgeInsets.all(4.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Row(
        children: [
          _tabSegment('This Week', _RangeTab.week),
          _tabSegment('This Month', _RangeTab.month),
          _tabSegment('This Year', _RangeTab.year),
        ],
      ),
    );
  }

  Widget _tabSegment(String label, _RangeTab tab) {
    final selected = _tab == tab;
    return Expanded(
      child: GestureDetector(
        onTap: () => _selectTab(tab),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: EdgeInsets.symmetric(vertical: 10.h),
          decoration: BoxDecoration(
            color: selected ? _greenAccent : Colors.transparent,
            borderRadius: BorderRadius.circular(9.r),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 12.sp,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : _muted,
            ),
          ),
        ),
      ),
    );
  }

  // ── Shared bits ─────────────────────────────────────────────────────────
  Widget _navHeader(String label, VoidCallback onPrev, VoidCallback onNext) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 4.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _borderColor),
      ),
      child: Row(
        children: [
          _navArrow(Icons.chevron_left_rounded, onPrev),
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 200),
              child: Text(
                label,
                key: ValueKey(label),
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(
                  fontSize: 15.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
            ),
          ),
          _navArrow(Icons.chevron_right_rounded, onNext),
        ],
      ),
    );
  }

  Widget _navArrow(IconData icon, VoidCallback onTap) {
    return Material(
      color: const Color(0xFFF1F5F9),
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(6.w),
          child: Icon(icon, size: 20.sp, color: _darkText),
        ),
      ),
    );
  }

  Widget _legendRow() {
    return Wrap(
      spacing: 14.w,
      runSpacing: 6.h,
      children: [
        _legendItem(kPresentColor, 'Present'),
        _legendItem(kAbsentColor, 'Absent'),
        _legendItem(kOnLeaveColor, 'On Leave'),
        _legendItem(kHolidayColor, 'Holiday'),
      ],
    );
  }

  Widget _legendItem(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8.w,
          height: 8.w,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        SizedBox(width: 5.w),
        Text(label, style: GoogleFonts.inter(fontSize: 10.5.sp, color: _muted)),
      ],
    );
  }

  Widget _summaryCards(MonthTally tally, {bool big = false}) {
    final items = [
      (Icons.groups_rounded, tally.present, 'Present', kPresentColor),
      (Icons.block_rounded, tally.absent, 'Absent', kAbsentColor),
      (Icons.event_busy_rounded, tally.onLeave, 'On Leave', kOnLeaveColor),
      (Icons.event_available_rounded, tally.holiday, 'Holiday', kHolidayColor),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: 8.w,
        crossAxisSpacing: 8.w,
        childAspectRatio: 0.82,
      ),
      itemBuilder: (context, index) {
        final (icon, value, label, color) = items[index];
        return _StaggeredEntry(
          index: index,
          controller: _ctrl,
          child: Container(
            padding: EdgeInsets.symmetric(vertical: 10.h, horizontal: 4.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(icon, color: color, size: big ? 20.sp : 17.sp),
                SizedBox(height: 6.h),
                Text(
                  '$value',
                  style: GoogleFonts.inter(
                    fontSize: big ? 18.sp : 15.sp,
                    fontWeight: FontWeight.w800,
                    color: _darkText,
                  ),
                ),
                Text(
                  label,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(fontSize: 8.5.sp, color: _muted),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _detailsList({
    required String title,
    required VoidCallback onViewAll,
    required String viewAllLabel,
    required List<DateTime> dates,
  }) {
    final sorted = [...dates]..sort((a, b) => b.compareTo(a));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              title,
              style: GoogleFonts.inter(
                fontSize: 14.5.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            const Spacer(),
            GestureDetector(
              onTap: onViewAll,
              child: Row(
                children: [
                  Text(
                    viewAllLabel,
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
        SizedBox(height: 10.h),
        ...sorted.asMap().entries.map(
          (e) => _StaggeredEntry(
            index: e.key,
            controller: _ctrl,
            child: _dateRow(e.value),
          ),
        ),
      ],
    );
  }

  Widget _dateRow(DateTime date) {
    final status = statusFor(date);
    final color = statusColor(status);
    return Container(
      margin: EdgeInsets.only(bottom: 10.h),
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: _borderColor),
      ),
      child: Row(
        children: [
          Column(
            children: [
              Text(
                date.day.toString().padLeft(2, '0'),
                style: GoogleFonts.inter(
                  fontSize: 15.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              Text(
                _monthNamesShort[date.month - 1].toUpperCase(),
                style: GoogleFonts.inter(fontSize: 8.5.sp, color: _muted),
              ),
            ],
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Text(
              _weekdayFullName[date.weekday] ?? '',
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                fontWeight: FontWeight.w600,
                color: _darkText,
              ),
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 7.w,
                height: 7.w,
                decoration: BoxDecoration(color: color, shape: BoxShape.circle),
              ),
              SizedBox(width: 6.w),
              Text(
                statusLabel(status),
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ── Week view ───────────────────────────────────────────────────────────
  Widget _buildWeekView() {
    final days = List.generate(7, (i) => _weekAnchor.add(Duration(days: i)));
    final label =
        '${_monthNamesShort[_weekAnchor.month - 1]} ${_weekAnchor.day.toString().padLeft(2, '0')} – '
        '${_monthNamesShort[days.last.month - 1]} ${days.last.day.toString().padLeft(2, '0')}, ${days.last.year}';
    var present = 0, absent = 0, onLeave = 0, holiday = 0;
    for (final d in days) {
      switch (statusFor(d)) {
        case DayStatus.present:
          present++;
          break;
        case DayStatus.absent:
          absent++;
          break;
        case DayStatus.onLeave:
          onLeave++;
          break;
        case DayStatus.holiday:
          holiday++;
          break;
      }
    }
    final tally = MonthTally(
      present: present,
      absent: absent,
      onLeave: onLeave,
      holiday: holiday,
      totalDays: 7,
    );

    return Column(
      key: const ValueKey('week'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _navHeader(label, () => _shiftWeek(-1), () => _shiftWeek(1)),
        SizedBox(height: 14.h),
        Row(
          children: days
              .asMap()
              .entries
              .map(
                (e) => Expanded(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 2.w),
                    child: _StaggeredEntry(
                      index: e.key,
                      controller: _ctrl,
                      child: _weekDayCell(e.value),
                    ),
                  ),
                ),
              )
              .toList(),
        ),
        SizedBox(height: 12.h),
        _legendRow(),
        SizedBox(height: 16.h),
        _summaryCards(tally),
        SizedBox(height: 20.h),
        _detailsList(
          title: 'Attendance Details',
          onViewAll: _openViewAll,
          viewAllLabel: 'View All',
          dates: days,
        ),
      ],
    );
  }

  Widget _weekDayCell(DateTime date) {
    final status = statusFor(date);
    final color = statusColor(status);
    final isToday = date.year == _today.year &&
        date.month == _today.month &&
        date.day == _today.day;
    return Container(
      padding: EdgeInsets.symmetric(vertical: 10.h),
      decoration: BoxDecoration(
        color: isToday ? kPresentColor.withOpacity(0.1) : Colors.white,
        borderRadius: BorderRadius.circular(10.r),
        border: Border.all(
          color: isToday ? kPresentColor.withOpacity(0.4) : _borderColor,
        ),
      ),
      child: Column(
        children: [
          Text(
            _weekdayShort[date.weekday - 1],
            style: GoogleFonts.inter(fontSize: 9.5.sp, color: _muted),
          ),
          SizedBox(height: 4.h),
          Text(
            '${date.day}',
            style: GoogleFonts.inter(
              fontSize: 13.5.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          SizedBox(height: 5.h),
          Container(
            width: 6.w,
            height: 6.w,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
        ],
      ),
    );
  }

  // ── Month view ──────────────────────────────────────────────────────────
  Widget _buildMonthView() {
    final year = _monthAnchor.year;
    final month = _monthAnchor.month;
    final daysInMonth = DateTime(year, month + 1, 0).day;
    final firstWeekdaySunFirst = DateTime(year, month, 1).weekday % 7;
    final tally = tallyForMonth(year, month, hasData: true);
    final label = '${_monthNamesFull[month - 1]} $year';

    return Column(
      key: const ValueKey('month'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _navHeader(label, () => _shiftMonth(-1), () => _shiftMonth(1)),
        SizedBox(height: 14.h),
        Row(
          children: _weekdayShortSunFirst
              .map(
                (w) => Expanded(
                  child: Center(
                    child: Text(
                      w,
                      style: GoogleFonts.inter(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w600,
                        color: _muted,
                      ),
                    ),
                  ),
                ),
              )
              .toList(),
        ),
        SizedBox(height: 6.h),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: firstWeekdaySunFirst + daysInMonth,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 7,
            mainAxisSpacing: 4.h,
            crossAxisSpacing: 2.w,
            childAspectRatio: 0.8,
          ),
          itemBuilder: (context, index) {
            if (index < firstWeekdaySunFirst) return const SizedBox.shrink();
            final day = index - firstWeekdaySunFirst + 1;
            final date = DateTime(year, month, day);
            final isToday = year == _today.year &&
                month == _today.month &&
                day == _today.day;
            final color = statusColor(statusFor(date));
            return Container(
              decoration: BoxDecoration(
                color: isToday ? kPresentColor.withOpacity(0.12) : null,
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '$day',
                    style: GoogleFonts.inter(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w600,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 3.h),
                  Container(
                    width: 5.w,
                    height: 5.w,
                    decoration: BoxDecoration(
                      color: color,
                      shape: BoxShape.circle,
                    ),
                  ),
                ],
              ),
            );
          },
        ),
        SizedBox(height: 12.h),
        _legendRow(),
        SizedBox(height: 16.h),
        _summaryCards(tally),
        SizedBox(height: 20.h),
        _detailsList(
          title: 'Attendance Records',
          onViewAll: _openViewAll,
          viewAllLabel: 'Month Summary',
          dates: List.generate(daysInMonth, (i) => DateTime(year, month, i + 1)),
        ),
      ],
    );
  }

  // ── Year view ───────────────────────────────────────────────────────────
  Widget _buildYearView() {
    final yearTally = List.generate(
      12,
      (i) => tallyForMonth(_year, i + 1, hasData: (_year < _today.year) ||
          (_year == _today.year && i + 1 <= _today.month)),
    );
    final totalPresent = yearTally.fold<int>(0, (a, b) => a + b.present);
    final totalAbsent = yearTally.fold<int>(0, (a, b) => a + b.absent);
    final totalLeave = yearTally.fold<int>(0, (a, b) => a + b.onLeave);
    final totalHoliday = yearTally.fold<int>(0, (a, b) => a + b.holiday);
    final grandTally = MonthTally(
      present: totalPresent,
      absent: totalAbsent,
      onLeave: totalLeave,
      holiday: totalHoliday,
      totalDays: 365,
    );

    return Column(
      key: const ValueKey('year'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _navHeader('$_year', () => _shiftYear(-1), () => _shiftYear(1)),
        SizedBox(height: 14.h),
        _summaryCards(grandTally, big: true),
        SizedBox(height: 20.h),
        Row(
          children: [
            Text(
              'Monthly Overview',
              style: GoogleFonts.inter(
                fontSize: 14.5.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
          ],
        ),
        SizedBox(height: 8.h),
        _legendRow(),
        SizedBox(height: 14.h),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: 12,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            mainAxisSpacing: 10.h,
            crossAxisSpacing: 10.w,
            childAspectRatio: 0.7,
          ),
          itemBuilder: (context, index) {
            final tally = yearTally[index];
            return _StaggeredEntry(
              index: index,
              controller: _ctrl,
              child: _monthCard(index + 1, tally),
            );
          },
        ),
      ],
    );
  }

  Widget _monthCard(int month, MonthTally tally) {
    return Container(
      padding: EdgeInsets.symmetric(vertical: 10.h, horizontal: 6.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _borderColor),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            _monthNamesFull[month - 1],
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.inter(
              fontSize: 11.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          SizedBox(height: 5.h),
          SizedBox(
            width: 52.w,
            height: 52.w,
            child: CustomPaint(
              painter: _RingPainter(
                present: tally.present,
                absent: tally.absent,
                onLeave: tally.onLeave,
                total: tally.totalDays,
              ),
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${tally.totalDays}',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    Text(
                      'Days',
                      style: GoogleFonts.inter(fontSize: 7.sp, color: _muted),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SizedBox(height: 6.h),
          _monthCountRow(kPresentColor, tally.present),
          SizedBox(height: 2.h),
          _monthCountRow(kAbsentColor, tally.absent),
          SizedBox(height: 2.h),
          _monthCountRow(kOnLeaveColor, tally.onLeave),
        ],
      ),
    );
  }

  Widget _monthCountRow(Color color, int value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 6.w,
          height: 6.w,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        SizedBox(width: 5.w),
        Text(
          '$value',
          style: GoogleFonts.inter(
            fontSize: 10.5.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
      ],
    );
  }
}

class _RingPainter extends CustomPainter {
  final int present;
  final int absent;
  final int onLeave;
  final int total;

  _RingPainter({
    required this.present,
    required this.absent,
    required this.onLeave,
    required this.total,
  });

  @override
  void paint(Canvas canvas, Size size) {
    const strokeWidth = 6.0;
    final center = size.center(Offset.zero);
    final radius = (size.shortestSide - strokeWidth) / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);

    final trackPaint = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(rect, 0, 2 * math.pi, false, trackPaint);

    if (total <= 0) return;
    var start = -math.pi / 2;
    void drawSegment(int value, Color color) {
      if (value <= 0) return;
      final sweep = (value / total) * 2 * math.pi;
      canvas.drawArc(
        rect,
        start,
        sweep,
        false,
        Paint()
          ..color = color
          ..style = PaintingStyle.stroke
          ..strokeWidth = strokeWidth
          ..strokeCap = StrokeCap.round,
      );
      start += sweep;
    }

    drawSegment(present, kPresentColor);
    drawSegment(absent, kAbsentColor);
    drawSegment(onLeave, kOnLeaveColor);
  }

  @override
  bool shouldRepaint(covariant _RingPainter oldDelegate) =>
      oldDelegate.present != present ||
      oldDelegate.absent != absent ||
      oldDelegate.onLeave != onLeave ||
      oldDelegate.total != total;
}

/// Staggers each item's entrance off the shared [controller] — later items
/// start fading/sliding in slightly after earlier ones.
class _StaggeredEntry extends StatelessWidget {
  const _StaggeredEntry({
    required this.index,
    required this.controller,
    required this.child,
  });

  final int index;
  final AnimationController controller;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final start = (index * 0.06).clamp(0.0, 0.7);
    final end = (start + 0.4).clamp(0.0, 1.0);
    final curved = CurvedAnimation(
      parent: controller,
      curve: Interval(start, end, curve: Curves.easeOutCubic),
    );
    return FadeTransition(
      opacity: curved,
      child: SlideTransition(
        position: Tween<Offset>(
          begin: const Offset(0, 0.1),
          end: Offset.zero,
        ).animate(curved),
        child: child,
      ),
    );
  }
}
