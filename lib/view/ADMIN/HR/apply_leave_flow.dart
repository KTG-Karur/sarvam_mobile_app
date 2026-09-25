import 'dart:io' as io;
import 'dart:typed_data';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:lottie/lottie.dart';
import 'package:sarvam/controller/leave_controller.dart';
import 'package:sarvam/view/ADMIN/HR/my_leave_pages.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Shared leave-request draft passed between flow screens
// ─────────────────────────────────────────────────────────────────────────────

class LeaveRequestDraft {
  String? leaveTypeCode;
  String? leaveTypeLabel;
  DateTime? fromDate;
  DateTime? toDate;
  String duration = 'Full Day'; // Full Day | First Half | Second Half
  String reason = '';
  String? attachmentName;
  String? fileKey;

  double currentBalance = 0;
  int? attachmentRequiredAboveDays;

  double get leaveDays {
    if (fromDate == null || toDate == null) return 0;
    final days = toDate!.difference(fromDate!).inDays + 1;
    if (duration != 'Full Day') {
      return days - 0.5;
    }
    return days.toDouble();
  }

  bool get isAttachmentMandatory {
    if (attachmentRequiredAboveDays == null) return false;
    return leaveDays > attachmentRequiredAboveDays!;
  }

  String get dateRangeText {
    if (fromDate == null || toDate == null) return '';
    final fmt = DateFormat('dd MMM yyyy');
    return '${fmt.format(fromDate!)} – ${fmt.format(toDate!)}';
  }

  double get remainingBalance {
    final used = leaveDays.toDouble();
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
  final LeaveController _controller = Get.put(LeaveController());
  final _draft = LeaveRequestDraft();
  final _reasonCtrl = TextEditingController();

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate({required bool isFrom}) async {
    final now = DateTime.now();
    DateTime initial = isFrom
        ? (_draft.fromDate ?? now)
        : (_draft.toDate ?? _draft.fromDate ?? now);
    final first = isFrom ? now : (_draft.fromDate ?? now);

    final List<DateTime> blockedDates = _controller.leaveApplications
        .where((app) => app['status'] != 'CANCELLED')
        .expand((app) {
      final start = DateTime.tryParse(app['fromDate'])?.toLocal();
      final end = DateTime.tryParse(app['toDate'])?.toLocal();
      if (start == null || end == null) return <DateTime>[];
      final days = <DateTime>[];
      for (int i = 0; i <= end.difference(start).inDays; i++) {
        days.add(DateTime(start.year, start.month, start.day + i));
      }
      return days;
    }).toList();

    // Ensure initialDate is not before firstDate
    if (initial.isBefore(first)) {
      initial = first;
    }

    // If initialDate is blocked, find the next available non-blocked date
    while (blockedDates.any((bd) => bd.year == initial.year && bd.month == initial.month && bd.day == initial.day)) {
      initial = initial.add(const Duration(days: 1));
    }

    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: now.add(const Duration(days: 365)),
      selectableDayPredicate: (day) {
        final d = DateTime(day.year, day.month, day.day);
        return !blockedDates.any((bd) => bd.year == d.year && bd.month == d.month && bd.day == d.day);
      },
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
        if (_draft.duration != 'Full Day' || (_draft.toDate != null && _draft.toDate!.isBefore(picked))) {
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
    if (_draft.isAttachmentMandatory && _draft.fileKey == null) {
      _toast(
          'Attachment is required for ${_draft.leaveTypeLabel} exceeding ${_draft.attachmentRequiredAboveDays} days');
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
                  Obx(() {
                    if (_controller.isLoading.value) {
                      return const Center(
                        child: CircularProgressIndicator(color: _green),
                      );
                    }
                    if (_controller.leaveBalances.isEmpty) {
                      return Text(
                        'No leave balances available.',
                        style: TextStyle(fontSize: 12.sp, color: _muted),
                      );
                    }
                    return Row(
                      children: _controller.leaveBalances.map((b) {
                        final typeName = b['leaveType']?.toString() ?? 'Leave';
                        final typeId = b['typeId']?.toString() ?? '';
                        final balance = double.tryParse(b['remainingBalance']?.toString() ?? '0') ?? 0;
                        final isLast = _controller.leaveBalances.indexOf(b) ==
                            _controller.leaveBalances.length - 1;

                        return Expanded(
                          child: Padding(
                            padding: EdgeInsets.only(right: isLast ? 0 : 8.w),
                            child: _balanceChip(
                              typeId,
                              typeName,
                              balance,
                              typeName.toUpperCase().contains('PRIVILEGE') ? _cream : _lightGreen,
                            ),
                          ),
                        );
                      }).toList(),
                    );
                  }),
                  SizedBox(height: 20.h),
                  _label('Leave Type'),
                  SizedBox(height: 8.h),
                  _leaveTypeDropdown(),
                  SizedBox(height: 16.h),
                  _label('Duration'),
                  SizedBox(height: 8.h),
                  _durationSelector(),
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
                              onTap: _draft.duration == 'Full Day' ? () => _openCalendarPicker() : null,
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
                      onPressed: _draft.duration == 'Full Day' ? _openCalendarPicker : null,
                      icon: Icon(
                        Icons.calendar_month_rounded,
                        size: 16.sp,
                        color: _draft.duration == 'Full Day' ? _green : _muted.withOpacity(0.5),
                      ),
                      label: Text(
                        'Open calendar',
                        style: TextStyle(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w600,
                          color: _draft.duration == 'Full Day' ? _green : _muted.withOpacity(0.5),
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 8.h),
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
                  _label(_draft.isAttachmentMandatory ? 'Attachment (Required)' : 'Attachment (Optional)'),
                  SizedBox(height: 8.h),
                  _attachmentSelector(),
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

  Widget _balanceChip(String code, String name, double days, Color bg) {
    final displayDays = days % 1 == 0 ? days.toInt().toString() : days.toString();
    return Container(
      padding: EdgeInsets.symmetric(vertical: 12.h, horizontal: 8.w),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Column(
        children: [
          Text(
            name.toUpperCase(),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 11.sp,
              fontWeight: FontWeight.w800,
              color: _green,
            ),
          ),
          SizedBox(height: 4.h),
          Text(
            '$displayDays Days',
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.w700,
              color: _navy,
            ),
          ),
        ],
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
        child: Obx(() {
          return DropdownButton<String>(
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
            items: _controller.leaveTypes.map((t) {
              final id = t['id']?.toString() ?? '';
              final name = t['leaveType']?.toString() ?? '';

              // Find matching balance to check if it should be enabled
              final matchingBalance = _controller.leaveBalances.firstWhere(
                (b) =>
                    (b['id']?.toString() ?? '') == id ||
                    (b['typeId']?.toString() ?? '') == id,
                orElse: () => null,
              );
              final balanceVal = matchingBalance != null
                  ? (double.tryParse(matchingBalance['remainingBalance']?.toString() ?? '0') ?? 0)
                  : 0.0;
              final isEnabled = balanceVal > 0;

              return DropdownMenuItem(
                value: id,
                enabled: isEnabled,
                child: Text(
                  name.toUpperCase() + (isEnabled ? '' : ' (NO BALANCE)'),
                  style: TextStyle(
                    fontSize: 13.5.sp,
                    color: isEnabled ? _navy : _muted.withOpacity(0.5),
                  ),
                ),
              );
            }).toList(),
            onChanged: (v) {
              if (v == null) return;
              final selectedType = _controller.leaveTypes.firstWhere(
                (t) => (t['id']?.toString() ?? '') == v,
                orElse: () => null,
              );
              final name = selectedType != null
                  ? (selectedType['leaveType']?.toString() ?? '')
                  : v;

              // Find matching balance if any to set currentBalance
              final matchingBalance = _controller.leaveBalances.firstWhere(
                (b) =>
                    (b['id']?.toString() ?? '') == v ||
                    (b['typeId']?.toString() ?? '') == v,
                orElse: () => null,
              );
              final balanceVal = matchingBalance != null
                  ? (double.tryParse(matchingBalance['remainingBalance']?.toString() ?? '0') ?? 0)
                  : 0.0;

              final reqDays = selectedType != null ? selectedType['attachmentRequiredAboveDays'] : null;

              setState(() {
                _draft.leaveTypeCode = v;
                _draft.leaveTypeLabel = name.toUpperCase();
                _draft.currentBalance = balanceVal;
                _draft.attachmentRequiredAboveDays = (reqDays != null) ? int.tryParse(reqDays.toString()) : null;
              });
            },
          );
        }),
      ),
    );
  }

  Widget _dateField({required DateTime? value, required VoidCallback? onTap}) {
    final text = value == null
        ? 'Select'
        : DateFormat('dd MMM yyyy').format(value);
    final isDisabled = onTap == null;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 14.h),
        decoration: BoxDecoration(
          color: isDisabled ? const Color(0xFFF1F5F9) : const Color(0xFFF8FAFC),
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
                  color: isDisabled ? _muted.withOpacity(0.5) : (value == null ? _muted : _navy),
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Icon(Icons.calendar_today_rounded, size: 16.sp, color: isDisabled ? _muted.withOpacity(0.3) : _green),
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
              onTap: () => setState(() {
                _draft.duration = opt;
                if (opt != 'Full Day' && _draft.fromDate != null) {
                  _draft.toDate = _draft.fromDate;
                }
              }),
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

  Widget _attachmentSelector() {
    return InkWell(
      onTap: _pickAttachment,
      borderRadius: BorderRadius.circular(12.r),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 16.h),
        decoration: BoxDecoration(
          color: const Color(0xFFF8FAFC),
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: const Color(0xFFE2E8F0)),
        ),
        child: Row(
          children: [
            Icon(
              _draft.attachmentName != null ? Icons.description_rounded : Icons.file_upload_outlined,
              color: _green,
              size: 20.sp,
            ),
            SizedBox(width: 12.w),
            Expanded(
              child: Text(
                _draft.attachmentName ?? 'Upload document (PDF, PNG, JPG)',
                style: TextStyle(
                  fontSize: 13.sp,
                  color: _draft.attachmentName != null ? _navy : _muted,
                  fontWeight: _draft.attachmentName != null ? FontWeight.w600 : FontWeight.w400,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (_draft.attachmentName != null)
              GestureDetector(
                onTap: () {
                  setState(() {
                    _draft.attachmentName = null;
                    _draft.fileKey = null;
                  });
                },
                child: Padding(
                  padding: EdgeInsets.only(left: 8.w),
                  child: Icon(Icons.cancel_rounded, color: Colors.red[400], size: 20.sp),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickAttachment() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png'],
        withData: true,
      );

      if (result != null) {
        final pickedFile = result.files.single;
        Uint8List? bytes = pickedFile.bytes;
        if (bytes == null && pickedFile.path != null) {
          bytes = await io.File(pickedFile.path!).readAsBytes();
        }

        if (bytes != null) {
          // Check file size (max 5MB)
          if (bytes.length > 5 * 1024 * 1024) {
            _toast('File size exceeds 5MB limit');
            return;
          }

          // Show loading screen
          showDialog(
            context: context,
            barrierDismissible: false,
            builder: (_) => const Center(
              child: CircularProgressIndicator(color: _green),
            ),
          );

          try {
            final uploadData = await _controller.uploadAttachment(bytes, pickedFile.name);
            if (mounted) Navigator.of(context).pop(); // Dismiss loading screen

            if (uploadData != null) {
              setState(() {
                _draft.fileKey = uploadData['fileKey'];
                _draft.attachmentName = uploadData['fileName'];
              });
              _toast('File uploaded successfully');
            }
          } catch (e) {
            if (mounted) Navigator.of(context).pop();
            _toast('Upload failed');
          }
        }
      }
    } catch (e) {
      _toast('Error picking or uploading file');
    }
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
  final LeaveController _controller = Get.find<LeaveController>();
  late DateTime _visibleMonth;
  DateTime? _start;
  DateTime? _end;
  late List<DateTime> _blockedDates;

  @override
  void initState() {
    super.initState();
    _start = widget.draft.fromDate;
    _end = widget.draft.toDate;
    _visibleMonth = DateTime(
      (_start ?? DateTime.now()).year,
      (_start ?? DateTime.now()).month,
    );

    _blockedDates = _controller.leaveApplications
        .where((app) => app['status'] != 'CANCELLED')
        .expand((app) {
      final start = DateTime.tryParse(app['fromDate'] ?? '')?.toLocal();
      final end = DateTime.tryParse(app['toDate'] ?? '')?.toLocal();
      if (start == null || end == null) return <DateTime>[];
      final days = <DateTime>[];
      for (int i = 0; i <= end.difference(start).inDays; i++) {
        days.add(DateTime(start.year, start.month, start.day + i));
      }
      return days;
    }).toList();
  }

  void _prevMonth() => setState(() {
    _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month - 1);
  });

  void _nextMonth() => setState(() {
    _visibleMonth = DateTime(_visibleMonth.year, _visibleMonth.month + 1);
  });

  bool _isBlocked(DateTime day) {
    final d = DateTime(day.year, day.month, day.day);
    return _blockedDates.any((bd) => bd.year == d.year && bd.month == d.month && bd.day == d.day);
  }

  void _onDayTap(DateTime day) {
    if (_isBlocked(day)) return;

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
        // If range contains any blocked dates, don't allow selecting it
        bool hasBlocked = false;
        for (int i = 0; i <= d.difference(_start!).inDays; i++) {
          if (_isBlocked(DateTime(_start!.year, _start!.month, _start!.day + i))) {
            hasBlocked = true;
            break;
          }
        }
        if (hasBlocked) {
          _start = d;
          _end = null;
        } else {
          _end = d;
        }
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
      final blocked = _isBlocked(date);

      days.add(
        GestureDetector(
          onTap: (past || blocked) ? null : () => _onDayTap(date),
          child: Container(
            margin: EdgeInsets.all(3.w),
            decoration: BoxDecoration(
              color: selected
                  ? (edge ? _green : _green.withValues(alpha: 0.18))
                  : (blocked ? Colors.grey.withValues(alpha: 0.1) : Colors.transparent),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              '$d',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w500,
                color: (past || blocked)
                    ? const Color(0xFFCBD5E1)
                    : selected && edge
                    ? Colors.white
                    : selected
                    ? _green
                    : _navy,
                decoration: blocked ? TextDecoration.lineThrough : null,
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
        '${draft.leaveTypeLabel}',
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
      if (draft.attachmentName != null)
        (
          Icons.attach_file_rounded,
          'Attachment',
          draft.attachmentName!,
          const Color(0xFF64748B),
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
                          '${draft.currentBalance % 1 == 0 ? draft.currentBalance.toInt() : draft.currentBalance} Days',
                        ),
                        Divider(height: 18.h, color: const Color(0xFFE2E8F0)),
                        _balanceRow('Leave Days', '${draft.leaveDays} Days'),
                        Divider(height: 18.h, color: const Color(0xFFE2E8F0)),
                        _balanceRow(
                          'Remaining Balance',
                          '${draft.remainingBalance % 1 == 0 ? draft.remainingBalance.toInt() : draft.remainingBalance} Days',
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
                child: Obx(() {
                  final LeaveController controller = Get.find<LeaveController>();
                  return ElevatedButton(
                    onPressed: controller.isLoading.value
                        ? null
                        : () async {
                            final isHalfDay = draft.duration != 'Full Day';
                            String? session;
                            if (draft.duration == 'First Half') session = 'FIRST_HALF';
                            if (draft.duration == 'Second Half') session = 'SECOND_HALF';

                            final success = await controller.applyLeave(
                              leaveTypeId: draft.leaveTypeCode ?? '',
                              fromDate: DateFormat('yyyy-MM-dd').format(draft.fromDate!),
                              toDate: DateFormat('yyyy-MM-dd').format(draft.toDate!),
                              reason: draft.reason,
                              isHalfDay: isHalfDay,
                              halfDaySession: session,
                              attachments: draft.fileKey != null
                                  ? [
                                      {
                                        "fileKey": draft.fileKey!,
                                        "fileName": draft.attachmentName!,
                                      }
                                    ]
                                  : null,
                            );

                            if (success) {
                              Navigator.of(context).pushReplacement(
                                MaterialPageRoute(
                                  builder: (_) => LeaveSubmittedPage(draft: draft),
                                ),
                              );
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Failed to submit leave request. Please try again.'),
                                  backgroundColor: Colors.red,
                                ),
                              );
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14.r),
                      ),
                    ),
                    child: controller.isLoading.value
                        ? SizedBox(
                            height: 20.h,
                            width: 20.h,
                            child: const CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2,
                            ),
                          )
                        : Text(
                            'Submit Leave',
                            style: TextStyle(
                              fontSize: 15.sp,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                  );
                }),
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
                                  '${draft.leaveTypeLabel}',
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