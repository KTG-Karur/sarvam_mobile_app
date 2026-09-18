// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

import 'attendance_status.dart';

/// ViewAllAttendance — the full, searchable/filterable attendance history for
/// the current month (and beyond). Reached from AttendanceStatus' "View All" /
/// "Month Summary" links.
class ViewAllAttendance extends StatefulWidget {
  const ViewAllAttendance({super.key});

  @override
  State<ViewAllAttendance> createState() => _ViewAllAttendanceState();
}

class _ViewAllAttendanceState extends State<ViewAllAttendance>
    with SingleTickerProviderStateMixin {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _greenAccent = Color(0xFF0D6842);
  static const _borderColor = Color(0xFFE2E8F0);

  late final AnimationController _ctrl;
  late final Animation<double> _fade;

  final _searchCtrl = TextEditingController();
  DayStatus? _filter;
  DateTime _month = DateTime(2026, 9);

  List<DateTime> get _allDates {
    final daysInMonth = DateTime(_month.year, _month.month + 1, 0).day;
    return List.generate(
      daysInMonth,
      (i) => DateTime(_month.year, _month.month, daysInMonth - i),
    );
  }

  List<DateTime> get _filteredDates {
    var dates = _allDates;
    if (_filter != null) {
      dates = dates.where((d) => statusFor(d) == _filter).toList();
    }
    final query = _searchCtrl.text.trim();
    if (query.isNotEmpty) {
      dates = dates.where((d) => d.day.toString().contains(query)).toList();
    }
    return dates;
  }

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _ctrl.forward();
    _searchCtrl.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  void _setFilter(DayStatus? status) {
    setState(() => _filter = status);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _month,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
      helpText: 'Jump to month',
    );
    if (picked != null) {
      setState(() {
        _month = DateTime(picked.year, picked.month);
        _ctrl.forward(from: 0);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(context),
            FadeTransition(
              opacity: _fade,
              child: Column(
                children: [
                  _buildSearchBar(),
                  SizedBox(height: 10.h),
                  _buildFilterChips(),
                  SizedBox(height: 12.h),
                  _buildMonthRow(),
                ],
              ),
            ),
            Expanded(
              child: _filteredDates.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 20.h),
                      itemCount: _filteredDates.length,
                      itemBuilder: (context, index) {
                        return _StaggeredRow(
                          index: index,
                          child: _dateRow(_filteredDates[index]),
                        );
                      },
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
                  'View All Attendance',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  'Complete attendance history',
                  style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Search ──────────────────────────────────────────────────────────────
  Widget _buildSearchBar() {
    return Padding(
      padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 0),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12.w),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: _borderColor),
        ),
        child: Row(
          children: [
            Icon(Icons.search_rounded, color: _muted, size: 19.sp),
            SizedBox(width: 8.w),
            Expanded(
              child: TextField(
                controller: _searchCtrl,
                keyboardType: TextInputType.number,
                style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                decoration: InputDecoration(
                  hintText: 'Search by date',
                  hintStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(vertical: 12.h),
                ),
              ),
            ),
            if (_searchCtrl.text.isNotEmpty)
              GestureDetector(
                onTap: () => _searchCtrl.clear(),
                child: Icon(Icons.close_rounded, color: _muted, size: 17.sp),
              ),
          ],
        ),
      ),
    );
  }

  // ── Filter chips ────────────────────────────────────────────────────────
  Widget _buildFilterChips() {
    final chips = <(String, DayStatus?, Color)>[
      ('All', null, _greenAccent),
      ('Present', DayStatus.present, kPresentColor),
      ('Absent', DayStatus.absent, kAbsentColor),
      ('On Leave', DayStatus.onLeave, kOnLeaveColor),
      ('Holiday', DayStatus.holiday, kHolidayColor),
    ];
    return SizedBox(
      height: 36.h,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: EdgeInsets.symmetric(horizontal: 16.w),
        itemCount: chips.length,
        separatorBuilder: (_, __) => SizedBox(width: 8.w),
        itemBuilder: (context, index) {
          final (label, status, color) = chips[index];
          final selected = _filter == status;
          return GestureDetector(
            onTap: () => _setFilter(status),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: EdgeInsets.symmetric(horizontal: 14.w),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: selected ? color : Colors.white,
                borderRadius: BorderRadius.circular(20.r),
                border: Border.all(
                  color: selected ? color : _borderColor,
                ),
              ),
              child: Text(
                label,
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: selected ? Colors.white : _darkText,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // ── Month row ───────────────────────────────────────────────────────────
  Widget _buildMonthRow() {
    const monthNames = [
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
    return Padding(
      padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 8.h),
      child: Row(
        children: [
          Text(
            '${monthNames[_month.month - 1]} ${_month.year}',
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          Icon(Icons.keyboard_arrow_down_rounded, color: _muted, size: 18.sp),
          const Spacer(),
          Material(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10.r),
            child: InkWell(
              borderRadius: BorderRadius.circular(10.r),
              onTap: _pickDate,
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 7.h),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(10.r),
                  border: Border.all(color: _borderColor),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.calendar_today_rounded,
                      size: 13.sp,
                      color: _greenAccent,
                    ),
                    SizedBox(width: 6.w),
                    Text(
                      'Select Date',
                      style: GoogleFonts.inter(
                        fontSize: 11.5.sp,
                        fontWeight: FontWeight.w600,
                        color: _greenAccent,
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

  Widget _dateRow(DateTime date) {
    const monthAbbr = [
      'JAN',
      'FEB',
      'MAR',
      'APR',
      'MAY',
      'JUN',
      'JUL',
      'AUG',
      'SEP',
      'OCT',
      'NOV',
      'DEC',
    ];
    const weekdayFull = {
      DateTime.monday: 'Monday',
      DateTime.tuesday: 'Tuesday',
      DateTime.wednesday: 'Wednesday',
      DateTime.thursday: 'Thursday',
      DateTime.friday: 'Friday',
      DateTime.saturday: 'Saturday',
      DateTime.sunday: 'Sunday',
    };
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
                monthAbbr[date.month - 1],
                style: GoogleFonts.inter(fontSize: 8.5.sp, color: _muted),
              ),
            ],
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Text(
              weekdayFull[date.weekday] ?? '',
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                fontWeight: FontWeight.w600,
                color: _darkText,
              ),
            ),
          ),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 6.h),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(20.r),
            ),
            child: Row(
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
                    fontSize: 11.5.sp,
                    fontWeight: FontWeight.w700,
                    color: color,
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: 4.w),
          Icon(Icons.chevron_right_rounded, color: _muted, size: 18.sp),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.search_off_rounded, color: _muted, size: 40.sp),
          SizedBox(height: 10.h),
          Text(
            'No records found',
            style: GoogleFonts.inter(
              fontSize: 13.sp,
              fontWeight: FontWeight.w600,
              color: _muted,
            ),
          ),
        ],
      ),
    );
  }
}

/// Staggers each list row's entrance — later rows fade/slide in slightly
/// after earlier ones.
class _StaggeredRow extends StatefulWidget {
  const _StaggeredRow({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<_StaggeredRow> createState() => _StaggeredRowState();
}

class _StaggeredRowState extends State<_StaggeredRow>
    with SingleTickerProviderStateMixin {
  late final AnimationController _ctrl;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _fade = CurvedAnimation(parent: _ctrl, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.1),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _ctrl, curve: Curves.easeOutCubic));
    Future.delayed(Duration(milliseconds: 20 * widget.index.clamp(0, 15)), () {
      if (mounted) _ctrl.forward();
    });
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _fade,
      child: SlideTransition(position: _slide, child: widget.child),
    );
  }
}
