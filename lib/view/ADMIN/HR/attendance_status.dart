// ignore_for_file: deprecated_member_use

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/attendance_controller.dart';

import 'view_all_attendance.dart';

/// DayStatus enum for attendance types
enum DayStatus { present, halfDay, absent, onLeave, holiday }

const kPresentColor = Color(0xFF16A34A);
const kHalfDayColor = Color(0xFF6366F1);
const kAbsentColor = Color(0xFFEF4444);
const kOnLeaveColor = Color(0xFFF59E0B);
const kHolidayColor = Color(0xFF64748B);

String statusLabel(DayStatus s) {
  switch (s) {
    case DayStatus.present:
      return 'Present';
    case DayStatus.halfDay:
      return 'Half Day';
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
    case DayStatus.halfDay:
      return kHalfDayColor;
    case DayStatus.absent:
      return kAbsentColor;
    case DayStatus.onLeave:
      return kOnLeaveColor;
    case DayStatus.holiday:
      return kHolidayColor;
  }
}

DayStatus mapDisplayStatus(String? status) {
  switch (status?.toUpperCase()) {
    case 'PRESENT':
      return DayStatus.present;
    case 'HALF_DAY':
      return DayStatus.halfDay;
    case 'ABSENT':
      return DayStatus.absent;
    case 'ON_LEAVE':
      return DayStatus.onLeave;
    case 'HOLIDAY':
      return DayStatus.holiday;
    default:
      return DayStatus.present;
  }
}

class MonthTally {
  final int present;
  final int halfDay;
  final int absent;
  final int onLeave;
  final int holiday;
  final int totalDays;
  const MonthTally({
    required this.present,
    required this.halfDay,
    required this.absent,
    required this.onLeave,
    required this.holiday,
    required this.totalDays,
  });

  int get tracked => present + halfDay + absent + onLeave + holiday;
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

enum _RangeTab { week, month }

/// AttendanceStatus — HR module screen for a field officer's own attendance,
/// switchable between Week / Month views, with a link into the full
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
  static final _today = DateTime.now();

  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  final AttendanceController _attendanceController = Get.put(AttendanceController());

  _RangeTab _tab = _RangeTab.week;
  late DateTime _weekAnchor;
  late DateTime _monthAnchor;

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
    _fetchData();
  }

  void _fetchData() {
    if (_tab == _RangeTab.week) {
      final tillDate = _weekAnchor.add(const Duration(days: 6));
      _attendanceController.fetchSummary(
        fromDate: _attendanceController.formatDate(_weekAnchor),
        tillDate: _attendanceController.formatDate(tillDate),
      );
      _attendanceController.fetchLedger(
        fromDate: _attendanceController.formatDate(_weekAnchor),
        tillDate: _attendanceController.formatDate(tillDate),
      );
    } else {
      _attendanceController.fetchSummary(
        month: _monthAnchor.month,
        year: _monthAnchor.year,
      );
      final lastDay = DateTime(_monthAnchor.year, _monthAnchor.month + 1, 0);
      _attendanceController.fetchLedger(
        fromDate: _attendanceController.formatDate(_monthAnchor),
        tillDate: _attendanceController.formatDate(lastDay),
      );
    }
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
    _fetchData();
  }

  void _shiftWeek(int deltaWeeks) {
    setState(() {
      _weekAnchor = _weekAnchor.add(Duration(days: 7 * deltaWeeks));
    });
    _ctrl.forward(from: 0);
    _fetchData();
  }

  void _shiftMonth(int delta) {
    setState(() {
      _monthAnchor = DateTime(_monthAnchor.year, _monthAnchor.month + delta);
    });
    _ctrl.forward(from: 0);
    _fetchData();
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
        _legendItem(kHalfDayColor, 'Half Day'),
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
      (Icons.timelapse_rounded, tally.halfDay, 'Half Day', kHalfDayColor),
      (Icons.event_busy_rounded, tally.onLeave, 'On Leave', kOnLeaveColor),
      (Icons.event_available_rounded, tally.holiday, 'Holiday', kHolidayColor),
    ];
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: items.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 5,
        mainAxisSpacing: 8.w,
        crossAxisSpacing: 4.w,
        childAspectRatio: 0.65,
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
    required List<dynamic> records,
  }) {
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
        ...records.asMap().entries.map(
          (e) => _StaggeredEntry(
            index: e.key,
            controller: _ctrl,
            child: _dateRow(e.value),
          ),
        ),
      ],
    );
  }

  Widget _dateRow(dynamic record) {
    final DateTime date = DateTime.parse(record['date']);
    final status = mapDisplayStatus(record['displayStatus']);
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
              record['dayOfWeek'] ?? '',
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

    return Obx(() {
      final s = _attendanceController.summary;
      final tally = MonthTally(
        present: (s['presentDays'] ?? 0).toInt(),
        halfDay: (s['halfDays'] ?? 0).toInt(),
        absent: (s['absentDays'] ?? 0).toInt(),
        onLeave: (s['leaveDays'] ?? 0).toInt(),
        holiday: (s['holidays'] ?? 0).toInt(),
        totalDays: (s['totalLoggedDays'] ?? 7).toInt(),
      );

      final records = _attendanceController.ledgerRecords;

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
                        child: _weekDayCell(e.value, records),
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
            records: records,
          ),
        ],
      );
    });
  }

  Widget _weekDayCell(DateTime date, List<dynamic> records) {
    final String dateStr = _attendanceController.formatDate(date);
    final record = records.firstWhere((r) => r['date'] == dateStr, orElse: () => null);
    final status = mapDisplayStatus(record?['displayStatus']);
    final color = record != null ? statusColor(status) : Colors.transparent;

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
    final label = '${_monthNamesFull[month - 1]} $year';

    return Obx(() {
      final s = _attendanceController.summary;
      final tally = MonthTally(
        present: (s['presentDays'] ?? 0).toInt(),
        halfDay: (s['halfDays'] ?? 0).toInt(),
        absent: (s['absentDays'] ?? 0).toInt(),
        onLeave: (s['leaveDays'] ?? 0).toInt(),
        holiday: (s['holidays'] ?? 0).toInt(),
        totalDays: (s['totalLoggedDays'] ?? daysInMonth).toInt(),
      );

      final records = _attendanceController.ledgerRecords;

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
              final String dateStr = _attendanceController.formatDate(date);
              final record = records.firstWhere((r) => r['date'] == dateStr, orElse: () => null);

              final isToday = year == _today.year &&
                  month == _today.month &&
                  day == _today.day;
              final status = mapDisplayStatus(record?['displayStatus']);
              final color = record != null ? statusColor(status) : Colors.transparent;

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
            records: records,
          ),
        ],
      );
    });
  }
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
