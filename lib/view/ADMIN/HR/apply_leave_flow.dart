import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:lottie/lottie.dart';
import 'package:sarvam/view/ADMIN/HR/my_leave_pages.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Shared leave-request draft passed between flow screens
// ─────────────────────────────────────────────────────────────────────────────

class LeaveRequestDraft {
  String? leaveTypeCode; // CL / SL / PL
  String? leaveTypeLabel;
  DateTime? fromDate;
  DateTime? toDate;
  String duration = 'Full Day'; // Full Day | First Half | Second Half
  String reason = '';
  String? attachmentName;

  static const balances = {'CL': 6, 'SL': 4, 'PL': 10};

  int get leaveDays {
    if (fromDate == null || toDate == null) return 0;
    final days = toDate!.difference(fromDate!).inDays + 1;
    if (duration != 'Full Day' && days == 1)
      return 1; // half-day still counts 1 UI day
    return days;
  }

  String get dateRangeText {
    if (fromDate == null || toDate == null) return '';
    final fmt = DateFormat('dd MMM yyyy');
    return '${fmt.format(fromDate!)} – ${fmt.format(toDate!)}';
  }

  int get currentBalance => balances[leaveTypeCode] ?? 0;

  int get remainingBalance {
    final used = leaveDays;
    return (currentBalance - used).clamp(0, 999);
  }
}

const _green = Color(0xFF0D6842);
const _navy = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);
const _lightGreen = Color(0xFFE8F5E9);
const _cream = Color(0xFFFFF8E1);
// Brand yellow/amber accent — same shade used for the beach icon, the PL
// chip, and the "Time" highlight word on the Apply Leave banner.
const _yellow = Color(0xFFF59E0B);

// ─────────────────────────────────────────────────────────────────────────────
// Screen 1 – Apply Leave
// ─────────────────────────────────────────────────────────────────────────────

class ApplyLeavePage extends StatefulWidget {
  const ApplyLeavePage({super.key});

  @override
  State<ApplyLeavePage> createState() => _ApplyLeavePageState();
}

class _ApplyLeavePageState extends State<ApplyLeavePage> {
  final _draft = LeaveRequestDraft();
  final _reasonCtrl = TextEditingController();
  static const _types = [
    ('CL', 'Casual Leave'),
    ('SL', 'Sick Leave'),
    ('PL', 'Privilege Leave'),
  ];

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    final initial = isFrom
        ? (_draft.fromDate ?? now)
        : (_draft.toDate ?? _draft.fromDate ?? now);
    final first = isFrom ? now : (_draft.fromDate ?? now);
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(first) ? first : initial,
      firstDate: first,
      lastDate: now.add(const Duration(days: 365)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: _green,
              onPrimary: Colors.white,
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked == null) return;
    setState(() {
      if (isFrom) {
        _draft.fromDate = picked;
        if (_draft.toDate != null && _draft.toDate!.isBefore(picked)) {
          _draft.toDate = picked;
        }
      } else {
        _draft.toDate = picked;
      }
    });
  }

  Future<void> _openCalendarPicker() async {
    final result = await Navigator.of(context).push<LeaveRequestDraft>(
      MaterialPageRoute(builder: (_) => SelectLeaveDatesPage(draft: _draft)),
    );
    if (result != null && mounted) setState(() {});
  }

  void _continue() {
    _draft.reason = _reasonCtrl.text.trim();
    if (_draft.leaveTypeCode == null) {
      _toast('Please select a leave type');
      return;
    }
    if (_draft.fromDate == null || _draft.toDate == null) {
      _toast('Please select from and to dates');
      return;
    }
    if (_draft.reason.isEmpty) {
      _toast('Please enter a reason for leave');
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ReviewLeaveRequestPage(draft: _draft)),
    );
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: _green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.white,
        leading: IconButton(
          icon: Icon(
            Icons.arrow_back_ios_new_rounded,
            size: 20.sp,
            color: _navy,
          ),
          onPressed: () => Get.back(),
        ),
        titleSpacing: 0,
        title: Text(
          'Apply Leave',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: _navy,
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 24.h),
              physics: const BouncingScrollPhysics(),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildBanner(),
                  SizedBox(height: 18.h),
                  Text(
                    'Available Leave Balance',
                    style: TextStyle(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w700,
                      color: _navy,
                    ),
                  ),
                  SizedBox(height: 10.h),
                  Row(
                    children: [
                      _balanceChip('CL', 'Casual Leave', 6, _lightGreen),
                      SizedBox(width: 8.w),
                      _balanceChip('SL', 'Sick Leave', 4, _lightGreen),
                      SizedBox(width: 8.w),
                      _balanceChip('PL', 'Privilege Leave', 10, _cream),
                    ],
                  ),
                  SizedBox(height: 20.h),
                  _label('Leave Type'),
                  SizedBox(height: 8.h),
                  _leaveTypeDropdown(),
                  SizedBox(height: 16.h),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('From Date'),
                            SizedBox(height: 8.h),
                            _dateField(
                              value: _draft.fromDate,
                              onTap: () => _pickDate(isFrom: true),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('To Date'),
                            SizedBox(height: 8.h),
                            _dateField(
                              value: _draft.toDate,
                              onTap: () => _openCalendarPicker(),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 8.h),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: _openCalendarPicker,
                      icon: Icon(
                        Icons.calendar_month_rounded,
                        size: 16.sp,
                        color: _green,
                      ),
                      label: Text(
                        'Open calendar',
                        style: TextStyle(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w600,
                          color: _green,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
                  _label('Duration'),
                  SizedBox(height: 8.h),
                  _durationSelector(),
                  SizedBox(height: 16.h),
                  _label('Reason for Leave'),
                  SizedBox(height: 8.h),
                  TextField(
                    controller: _reasonCtrl,
                    maxLength: 200,
                    maxLines: 4,
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      hintText: 'Enter reason for leave...',
                      hintStyle: TextStyle(fontSize: 13.sp, color: _muted),
                      filled: true,
                      fillColor: const Color(0xFFF8FAFC),
                      counterText: '${_reasonCtrl.text.length}/200',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12.r),
                        borderSide: const BorderSide(color: _green, width: 1.4),
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
                  _label('Attachment (Optional)'),
                  SizedBox(height: 8.h),
                  OutlinedButton.icon(
                    onPressed: () {
                      setState(() => _draft.attachmentName = null);
                      _toast('Attachment picker — coming soon');
                    },
                    icon: Icon(
                      Icons.attach_file_rounded,
                      color: _green,
                      size: 18.sp,
                    ),
                    label: Text(
                      _draft.attachmentName ?? 'Add Attachment',
                      style: TextStyle(
                        color: _green,
                        fontWeight: FontWeight.w600,
                        fontSize: 13.sp,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12.r),
                      ),
                      minimumSize: Size(double.infinity, 48.h),
                    ),
                  ),
                  SizedBox(height: 6.h),
                  Text(
                    'Supported files: PDF, JPG, PNG (Max 5 MB)',
                    style: TextStyle(fontSize: 11.sp, color: _muted),
                  ),
                ],
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 12.h),
              child: SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: _continue,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14.r),
                    ),
                  ),
                  child: Text(
                    'Continue  ›',
                    style: TextStyle(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBanner() {
    return ClipRRect(
      borderRadius: BorderRadius.circular(16.r),
      child: AspectRatio(
        aspectRatio: 1024 / 384,
        child: Image.asset(
          'assets/images/apply_leave_banner.png',
          fit: BoxFit.cover,
          width: double.infinity,
        ),
      ),
    );
  }

  Widget _balanceChip(String code, String name, int days, Color bg) {
    return Expanded(
      child: Container(
        padding: EdgeInsets.symmetric(vertical: 12.h, horizontal: 8.w),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: Column(
          children: [
            Text(
              code,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w800,
                color: _green,
              ),
            ),
            SizedBox(height: 2.h),
            Text(
              '$days Days',
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w700,
                color: _navy,
              ),
            ),
            Text(
              name.split(' ').first,
              style: TextStyle(fontSize: 9.5.sp, color: _muted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _label(String text) => Text(
    text,
    style: TextStyle(
      fontSize: 13.sp,
      fontWeight: FontWeight.w700,
      color: _navy,
    ),
  );

  Widget _leaveTypeDropdown() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12.w),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          isExpanded: true,
          value: _draft.leaveTypeCode,
          hint: Row(
            children: [
              Icon(
                Icons.beach_access_rounded,
                color: _yellow,
                size: 18.sp,
              ),
              SizedBox(width: 8.w),
              Text(
                'Select Leave Type',
                style: TextStyle(fontSize: 13.sp, color: _muted),
              ),
            ],
          ),
          icon: Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
          items: _types
              .map(
                (t) => DropdownMenuItem(
                  value: t.$1,
                  child: Text(
                    '${t.$2} (${t.$1})',
                    style: TextStyle(fontSize: 13.5.sp, color: _navy),
                  ),
                ),
              )
              .toList(),
          onChanged: (v) {
            if (v == null) return;
            setState(() {
              _draft.leaveTypeCode = v;
              _draft.leaveTypeLabel = _types.firstWhere((t) => t.$1 == v).$2;
            });
          },
        ),
      ),
    );
  }

  Widget _dateField({required DateTime? value, required VoidCallback onTap}) {
    final text = value == null
        ? 'Select'
        : DateFormat('dd MMM yyyy').format(value);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 14.h),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                text,
                style: TextStyle(
                  fontSize: 13.sp,
                  color: value == null ? _muted : _navy,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Icon(Icons.calendar_today_rounded, size: 16.sp, color: _green),
          ],
        ),
      ),
    );
  }

  Widget _durationSelector() {
    const options = ['Full Day', 'First Half', 'Second Half'];
    return Row(
      children: options.map((opt) {
        final selected = _draft.duration == opt;
        return Expanded(
          child: Padding(
            padding: EdgeInsets.only(right: opt == options.last ? 0 : 8.w),
            child: GestureDetector(
              onTap: () => setState(() => _draft.duration = opt),
              child: Container(
                padding: EdgeInsets.symmetric(vertical: 12.h),
                decoration: BoxDecoration(
                  color: selected ? _green : const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(10.r),
                  border: Border.all(
                    color: selected ? _green : const Color(0xFFE2E8F0),
                  ),
                ),
                child: Text(
                  opt,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 11.5.sp,
                    fontWeight: FontWeight.w700,
                    color: selected ? Colors.white : _muted,
                  ),
                ),
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 2 – Select Dates (calendar)
// ─────────────────────────────────────────────────────────────────────────────

class SelectLeaveDatesPage extends StatefulWidget {
  final LeaveRequestDraft draft;
  const SelectLeaveDatesPage({super.key, required this.draft});

  @override
  State<SelectLeaveDatesPage> createState() => _SelectLeaveDatesPageState();
}

class _SelectLeaveDatesPageState extends State<SelectLeaveDatesPage> {
  late DateTime _visibleMonth;
  DateTime? _start;
  DateTime? _end;

  @override
  void initState() {
    super.initState();
    _start = widget.draft.fromDate;
    _end = widget.draft.toDate;
    _visibleMonth = DateTime(
      (_start ?? DateTime.now()).year,
      (_start ?? DateTime.now()).month,
    );
  }

  void _prevMonth() => setState(() {
    _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month - 1);
  });

  void _nextMonth() => setState(() {
    _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month + 1);
  });

  void _onDayTap(DateTime day) {
    final today = DateTime.now();
    final d = DateTime(day.year, day.month, day.day);
    final t = DateTime(today.year, today.month, today.day);
    if (d.isBefore(t)) return;

    setState(() {
      if (_start == null || (_start != null && _end != null)) {
        _start = d;
        _end = null;
      } else if (d.isBefore(_start!)) {
        _start = d;
        _end = null;
      } else {
        _end = d;
      }
    });
  }

  bool _isSelected(DateTime day) {
    final d = DateTime(day.year, day.month, day.day);
    if (_start != null && _end == null) {
      return d == DateTime(_start!.year, _start!.month, _start!.day);
    }
    if (_start != null && _end != null) {
      final s = DateTime(_start!.year, _start!.month, _start!.day);
      final e = DateTime(_end!.year, _end!.month, _end!.day);
      return !d.isBefore(s) && !d.isAfter(e);
    }
    return false;
  }

  bool _isRangeEdge(DateTime day) {
    final d = DateTime(day.year, day.month, day.day);
    final s = _start == null
        ? null
        : DateTime(_start!.year, _start!.month, _start!.day);
    final e = _end == null
        ? null
        : DateTime(_end!.year, _end!.month, _end!.day);
    return d == s || d == e;
  }

  void _apply() {
    if (_start == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Please select at least one date'),
          backgroundColor: _green,
        ),
      );
      return;
    }
    widget.draft.fromDate = _start;
    widget.draft.toDate = _end ?? _start;
    Navigator.of(context).pop(widget.draft);
  }

  @override
  Widget build(BuildContext context) {
    final monthLabel = DateFormat('MMMM yyyy').format(_visibleMonth);
    final daysInMonth = DateUtils.getDaysInMonth(
      _visibleMonth.year,
      _visibleMonth.month,
    );
    final firstWeekday =
        DateTime(_visibleMonth.year, _visibleMonth.month, 1).weekday % 7;

    final days = <Widget>[];
    for (var i = 0; i < firstWeekday; i++) {
      days.add(const SizedBox.shrink());
    }
    for (var d = 1; d <= daysInMonth; d++) {
      final date = DateTime(_visibleMonth.year, _visibleMonth.month, d);
      final selected = _isSelected(date);
      final edge = _isRangeEdge(date);
      final past = date.isBefore(
        DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day),
      );
      days.add(
        GestureDetector(
          onTap: past ? null : () => _onDayTap(date),
          child: Container(
            margin: EdgeInsets.all(3.w),
            decoration: BoxDecoration(
              color: selected
                  ? (edge ? _green : _green.withValues(alpha: 0.18))
                  : Colors.transparent,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              '$d',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                color: past
                    ? const Color(0xFFCBD5E1)
                    : selected && edge
                    ? Colors.white
                    : selected
                    ? _green
                    : _navy,
              ),
            ),
          ),
        ),
      );
    }

    final rangeText = () {
      if (_start == null) return 'Select dates';
      final fmt = DateFormat('dd MMM yyyy');
      final end = _end ?? _start!;
      final count = end.difference(_start!).inDays + 1;
      return '${fmt.format(_start!)}  →  ${fmt.format(end)}   ·   $count Day${count > 1 ? 's' : ''}';
    }();

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.white,
        leading: IconButton(
          icon: Icon(
            Icons.arrow_back_ios_new_rounded,
            size: 20.sp,
            color: _navy,
          ),
          onPressed: () => Navigator.pop(context),
        ),
        titleSpacing: 0,
        title: Text(
          'Select Dates',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: _navy,
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      IconButton(
                        onPressed: _prevMonth,
                        icon: const Icon(Icons.chevron_left_rounded),
                      ),
                      Text(
                        monthLabel,
                        style: TextStyle(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w800,
                          color: _navy,
                        ),
                      ),
                      IconButton(
                        onPressed: _nextMonth,
                        icon: const Icon(Icons.chevron_right_rounded),
                      ),
                    ],
                  ),
                  SizedBox(height: 8.h),
                  Row(
                    children: ['S', 'M', 'T', 'W', 'T', 'F', 'S']
                        .map(
                          (w) => Expanded(
                            child: Center(
                              child: Text(
                                w,
                                style: TextStyle(
                                  fontSize: 12.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _muted,
                                ),
                              ),
                            ),
                          ),
                        )
                        .toList(),
                  ),
                  SizedBox(height: 8.h),
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 7,
                    children: days,
                  ),
                  SizedBox(height: 16.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(14.w),
                    decoration: BoxDecoration(
                      color: _lightGreen,
                      borderRadius: BorderRadius.circular(14.r),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.event_available_rounded,
                          color: _green,
                          size: 22.sp,
                        ),
                        SizedBox(width: 10.w),
                        Expanded(
                          child: Text(
                            rangeText,
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w700,
                              color: _navy,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 12.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0FDF4),
                      borderRadius: BorderRadius.circular(12.r),
                      border: Border.all(color: const Color(0xFFBBF7D0)),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.info_outline_rounded,
                          color: _green,
                          size: 18.sp,
                        ),
                        SizedBox(width: 8.w),
                        Expanded(
                          child: Text(
                            'Already applied or restricted dates will be disabled.',
                            style: TextStyle(
                              fontSize: 12.sp,
                              color: _green,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 12.h),
              child: SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: _apply,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14.r),
                    ),
                  ),
                  child: Text(
                    'Apply Dates  ›',
                    style: TextStyle(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 3 – Review Leave Request
// ─────────────────────────────────────────────────────────────────────────────

class ReviewLeaveRequestPage extends StatelessWidget {
  final LeaveRequestDraft draft;
  const ReviewLeaveRequestPage({super.key, required this.draft});

  @override
  Widget build(BuildContext context) {
    final rows = [
      (
        Icons.beach_access_rounded,
        'Leave Type',
        '${draft.leaveTypeLabel} (${draft.leaveTypeCode})',
        _yellow, // amber
      ),
      (
        Icons.calendar_today_rounded,
        'From Date',
        DateFormat('dd MMM yyyy').format(draft.fromDate!),
        const Color(0xFF3B82F6), // blue
      ),
      (
        Icons.event_rounded,
        'To Date',
        DateFormat('dd MMM yyyy').format(draft.toDate!),
        const Color(0xFF8B5CF6), // purple
      ),
      (
        Icons.schedule_rounded,
        'Duration',
        '${draft.leaveDays} Day${draft.leaveDays > 1 ? 's' : ''} (${draft.duration})',
        _green, // keep brand green here
      ),
      (
        Icons.notes_rounded,
        'Reason',
        draft.reason,
        const Color(0xFF64748B), // slate
      ),
      (
        Icons.attach_file_rounded,
        'Attachment',
        draft.attachmentName ?? 'No file attached',
        const Color(0xFFEF4444), // red
      ),
    ];

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        surfaceTintColor: Colors.white,
        leading: IconButton(
          icon: Icon(
            Icons.arrow_back_ios_new_rounded,
            size: 20.sp,
            color: _navy,
          ),
          onPressed: () => Navigator.pop(context),
        ),
        titleSpacing: 0,
        title: Text(
          'Review Leave Request',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: _navy,
          ),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 24.h),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: _lightGreen,
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.info_outline_rounded,
                          color: _green,
                          size: 18.sp,
                        ),
                        SizedBox(width: 8.w),
                        Expanded(
                          child: Text(
                            'Please review your leave details before submitting.',
                            style: TextStyle(
                              fontSize: 12.5.sp,
                              color: _green,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 16.h),
                  ...rows.map(
                    (r) => Padding(
                      padding: EdgeInsets.only(bottom: 14.h),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 36.w,
                            height: 36.w,
                            decoration: BoxDecoration(
                              color: r.$4.withValues(alpha: 0.12),
                              shape: BoxShape.circle,
                            ),
                            child: Icon(r.$1, color: r.$4, size: 18.sp),
                          ),
                          SizedBox(width: 12.w),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  r.$2,
                                  style: TextStyle(
                                    fontSize: 11.5.sp,
                                    color: _muted,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                                SizedBox(height: 2.h),
                                Text(
                                  r.$3,
                                  style: TextStyle(
                                    fontSize: 14.sp,
                                    fontWeight: FontWeight.w700,
                                    color: _navy,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Leave Balance After Approval',
                    style: TextStyle(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w800,
                      color: _navy,
                    ),
                  ),
                  SizedBox(height: 10.h),
                  Container(
                    width: double.infinity,
                    padding: EdgeInsets.all(14.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(14.r),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Column(
                      children: [
                        _balanceRow(
                          'Current Balance',
                          '${draft.currentBalance} Days',
                        ),
                        Divider(height: 18.h, color: const Color(0xFFE2E8F0)),
                        _balanceRow('Leave Days', '${draft.leaveDays} Days'),
                        Divider(height: 18.h, color: const Color(0xFFE2E8F0)),
                        _balanceRow(
                          'Remaining Balance',
                          '${draft.remainingBalance} Days',
                          highlight: true,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 12.h),
              child: SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).pushReplacement(
                      MaterialPageRoute(
                        builder: (_) => LeaveSubmittedPage(draft: draft),
                      ),
                    );
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14.r),
                    ),
                  ),
                  child: Text(
                    'Submit Leave',
                    style: TextStyle(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _balanceRow(String label, String value, {bool highlight = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 13.sp,
            color: _muted,
            fontWeight: FontWeight.w500,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            fontSize: 14.sp,
            fontWeight: FontWeight.w800,
            color: highlight ? _green : _navy,
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 4 – Leave Request Submitted (Lottie success)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Screen 4 – Leave Request Submitted (Lottie success)
// ─────────────────────────────────────────────────────────────────────────────

class LeaveSubmittedPage extends StatelessWidget {
  final LeaveRequestDraft draft;
  const LeaveSubmittedPage({super.key, required this.draft});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.symmetric(horizontal: 24.w),
                child: Column(
                  children: [
                    SizedBox(height: 40.h),
                    Lottie.asset(
                      'assets/lottie/success-check.json',
                      width: 160.w,
                      height: 160.w,
                      repeat: false,
                    ),
                    SizedBox(height: 8.h),
                    Text(
                      'Leave Request Submitted!',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 20.sp,
                        fontWeight: FontWeight.w900,
                        color: _yellow,
                      ),
                    ),
                    SizedBox(height: 8.h),
                    Text(
                      'Your leave request has been sent to your manager for approval.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 13.5.sp,
                        color: _muted,
                        height: 1.4,
                      ),
                    ),
                    SizedBox(height: 24.h),
                    Container(
                      width: double.infinity,
                      padding: EdgeInsets.all(16.w),
                      decoration: BoxDecoration(
                        color: _lightGreen,
                        borderRadius: BorderRadius.circular(16.r),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Container(
                            // width: 36.w,
                            // height: 36.w,
                            decoration: BoxDecoration(
                              color: Colors.transparent
                              // shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.calendar_today_rounded,
                              color: _yellow,
                              size: 38.sp,
                            ),
                          ),
                          SizedBox(width: 12.w),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${draft.leaveTypeLabel} (${draft.leaveTypeCode})',
                                  style: TextStyle(
                                    fontSize: 15.sp,
                                    fontWeight: FontWeight.w800,
                                    color: _green,
                                  ),
                                ),
                                SizedBox(height: 6.h),
                                Text(
                                  draft.dateRangeText,
                                  style: TextStyle(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.w600,
                                    color: _navy,
                                  ),
                                ),
                                SizedBox(height: 4.h),
                                Text(
                                  '${draft.leaveDays} Day${draft.leaveDays > 1 ? 's' : ''}',
                                  style: TextStyle(
                                    fontSize: 12.5.sp,
                                    color: _muted,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                    SizedBox(height: 28.h),
                    SizedBox(
                      width: double.infinity,
                      height: 52.h,
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.of(context).pushReplacement(
                            MaterialPageRoute(
                              builder: (_) => const MyLeaveRequestsPage(),
                            ),
                          );
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14.r),
                          ),
                        ),
                        child: Text(
                          'View My Leave',
                          style: TextStyle(
                            fontSize: 15.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                    SizedBox(height: 12.h),
                    SizedBox(
                      width: double.infinity,
                      height: 52.h,
                      child: OutlinedButton(
                        onPressed: () => Get.until((route) => route.isFirst),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: _green, width: 1.4),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14.r),
                          ),
                        ),
                        child: Text(
                          'Back to Home',
                          style: TextStyle(
                            fontSize: 15.sp,
                            fontWeight: FontWeight.w700,
                            color: _green,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: EdgeInsets.only(bottom: 20.h),
              child: Text(
                'People  ·  Progress  ·  Purpose',
                style: TextStyle(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _green.withValues(alpha: 0.7),
                  letterSpacing: 0.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}