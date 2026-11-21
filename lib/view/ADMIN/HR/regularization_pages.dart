import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:intl/intl.dart';

import 'package:sarvam/services/hr_api_service.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Attendance regularization — Apply + My Regularizations.
// Same endpoints as the web (Attendance Regularization > Apply Regularization):
//   GET  /api/hr/regularization            own requests
//   GET  /api/hr/regularization/config     how many days back are allowed
//   GET  /api/hr/shifts                    optional shift
//   POST /api/hr/regularization/apply      submit
//   POST /api/hr/regularization/{id}/cancel
// The server enforces every rule (past day only, day limit, holiday / leave /
// duplicate checks, approval flow); the screens only mirror the obvious ones.
// ─────────────────────────────────────────────────────────────────────────────

const _green = Color(0xFF0D6842);
const _navy = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE2E8F0);
const _bg = Color(0xFFF8FAFC);
const _amber = Color(0xFFF59E0B);

enum RegularizationStatus { pending, approved, rejected, cancelled }

extension RegularizationStatusX on RegularizationStatus {
  String get label => switch (this) {
        RegularizationStatus.pending => 'Pending',
        RegularizationStatus.approved => 'Approved',
        RegularizationStatus.rejected => 'Rejected',
        RegularizationStatus.cancelled => 'Cancelled',
      };

  Color get fg => switch (this) {
        RegularizationStatus.pending => const Color(0xFFB45309),
        RegularizationStatus.approved => const Color(0xFF0D6842),
        RegularizationStatus.rejected => const Color(0xFFDC2626),
        RegularizationStatus.cancelled => const Color(0xFF64748B),
      };

  Color get bg => switch (this) {
        RegularizationStatus.pending => const Color(0xFFFEF3C7),
        RegularizationStatus.approved => const Color(0xFFDCFCE7),
        RegularizationStatus.rejected => const Color(0xFFFEE2E2),
        RegularizationStatus.cancelled => const Color(0xFFF1F5F9),
      };
}

class RegularizationItem {
  final String id;
  final DateTime date; // the regularized day (IST calendar day)
  final String requestedStatus; // PRESENT | HALF_DAY
  final String fromTime;
  final String toTime;
  final String hours;
  final String reason;
  final RegularizationStatus status;
  final String? shiftName;
  final String? decisionRemarks;
  final String? decidedBy;
  final DateTime? appliedAt;
  final DateTime? decidedAt;
  final String? pendingStage; // e.g. "Branch Manager (1 of 2)"
  final String? employeeName; // shown only when someone applied on behalf

  const RegularizationItem({
    required this.id,
    required this.date,
    required this.requestedStatus,
    required this.fromTime,
    required this.toTime,
    required this.hours,
    required this.reason,
    required this.status,
    this.shiftName,
    this.decisionRemarks,
    this.decidedBy,
    this.appliedAt,
    this.decidedAt,
    this.pendingStage,
    this.employeeName,
  });

  String get typeLabel => requestedStatus == 'HALF_DAY' ? 'Half Day' : 'Present';

  factory RegularizationItem.fromJson(Map<String, dynamic> json) {
    String? name(dynamic user) {
      if (user is! Map) return null;
      final full = '${user['firstName'] ?? ''} ${user['lastName'] ?? ''}'.trim();
      return full.isEmpty ? null : full;
    }

    final stage = json['approval'];
    String? pendingStage;
    if (stage is Map && stage['stageName'] != null) {
      pendingStage = '${stage['stageName']} (${stage['stageNumber']} of ${stage['totalStages']})';
    }
    final hoursRaw = double.tryParse(json['workingHours']?.toString() ?? '');
    final status = switch (json['status']?.toString().toUpperCase()) {
      'APPROVED' => RegularizationStatus.approved,
      'REJECTED' => RegularizationStatus.rejected,
      'CANCELLED' => RegularizationStatus.cancelled,
      _ => RegularizationStatus.pending,
    };
    return RegularizationItem(
      id: json['id']?.toString() ?? '',
      date: _istDay(json['date']) ?? DateTime.now(),
      requestedStatus: json['requestedStatus']?.toString() ?? 'PRESENT',
      fromTime: json['fromTime']?.toString() ?? '--:--',
      toTime: json['toTime']?.toString() ?? '--:--',
      hours: hoursRaw == null ? '' : (hoursRaw % 1 == 0 ? hoursRaw.toInt().toString() : hoursRaw.toStringAsFixed(2)),
      reason: json['reason']?.toString() ?? '',
      status: status,
      shiftName: (json['shift'] is Map) ? json['shift']['name']?.toString() : null,
      decisionRemarks: json['decisionRemarks']?.toString(),
      decidedBy: name(json['decidedBy']),
      appliedAt: DateTime.tryParse(json['appliedAt']?.toString() ?? '')?.toLocal(),
      decidedAt: DateTime.tryParse(json['decidedAt']?.toString() ?? '')?.toLocal(),
      pendingStage: status == RegularizationStatus.pending ? pendingStage : null,
      employeeName: name(json['employee']),
    );
  }

  /// The API stores a business day as IST midnight in UTC (e.g. 18:30Z the day
  /// before), so read it in IST instead of the phone's time zone.
  static DateTime? _istDay(dynamic raw) {
    final parsed = DateTime.tryParse(raw?.toString() ?? '');
    if (parsed == null) return null;
    final ist = parsed.toUtc().add(const Duration(hours: 5, minutes: 30));
    return DateTime(ist.year, ist.month, ist.day);
  }
}

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

TimeOfDay? _parseHhmm(String? value) {
  if (value == null) return null;
  final parts = value.split(':');
  if (parts.length < 2) return null;
  final h = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (h == null || m == null || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return TimeOfDay(hour: h, minute: m);
}

String _time12(String hhmm) {
  final t = _parseHhmm(hhmm);
  if (t == null) return hhmm;
  final hour12 = t.hourOfPeriod == 0 ? 12 : t.hourOfPeriod;
  return '$hour12:${t.minute.toString().padLeft(2, '0')} ${t.period == DayPeriod.am ? 'AM' : 'PM'}';
}

PreferredSizeWidget _appBar(BuildContext context, String title, {List<Widget>? actions}) {
  return AppBar(
    backgroundColor: Colors.white,
    elevation: 0,
    surfaceTintColor: Colors.white,
    leading: IconButton(
      icon: Icon(Icons.arrow_back_ios_new_rounded, size: 20.sp, color: _navy),
      onPressed: () => Navigator.of(context).maybePop(),
    ),
    titleSpacing: 0,
    title: Text(title, style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800, color: _navy)),
    actions: actions,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply Regularization
// ─────────────────────────────────────────────────────────────────────────────

class ApplyRegularizationPage extends StatefulWidget {
  const ApplyRegularizationPage({super.key});

  @override
  State<ApplyRegularizationPage> createState() => _ApplyRegularizationPageState();
}

class _ApplyRegularizationPageState extends State<ApplyRegularizationPage> {
  final _reasonCtrl = TextEditingController();
  int _maxDays = 7;
  List<Map<String, dynamic>> _shifts = const [];
  bool _loading = true;
  bool _submitting = false;

  DateTime? _date;
  String _type = 'PRESENT'; // PRESENT | HALF_DAY
  TimeOfDay? _from;
  TimeOfDay? _to;
  String? _shiftId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reasonCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final results = await Future.wait([
      HrApiService.regularizationMaxDays(),
      HrApiService.activeShifts(),
    ]);
    if (!mounted) return;
    setState(() {
      _maxDays = results[0] as int;
      _shifts = (results[1] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      _loading = false;
    });
  }

  DateTime get _today {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  Future<void> _pickDate() async {
    final yesterday = _today.subtract(const Duration(days: 1));
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? yesterday,
      firstDate: _today.subtract(Duration(days: _maxDays)),
      lastDate: yesterday,
      helpText: 'Select the day to regularize',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime({required bool from}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: (from ? _from : _to) ?? (from ? const TimeOfDay(hour: 9, minute: 0) : const TimeOfDay(hour: 18, minute: 0)),
    );
    if (picked != null) setState(() => from ? _from = picked : _to = picked);
  }

  void _onShiftChanged(String? id) {
    setState(() {
      _shiftId = id;
      // Selecting a shift fills the working times from it (still editable).
      final shift = _shifts.where((s) => s['id']?.toString() == id).firstOrNull;
      if (shift != null) {
        _from = _parseHhmm(shift['shiftStart']?.toString()) ?? _from;
        _to = _parseHhmm(shift['shiftEnd']?.toString()) ?? _to;
      }
    });
  }

  String? _validate() {
    if (_date == null) return 'Please select the date to regularize';
    if (_from == null || _to == null) return 'Please select the from and to time';
    if (_to!.hour * 60 + _to!.minute <= _from!.hour * 60 + _from!.minute) return 'To time must be after from time';
    if (_reasonCtrl.text.trim().length < 3) return 'Please give a reason for the regularization';
    return null;
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus();
    final problem = _validate();
    if (problem != null) {
      _toast(problem, error: true);
      return;
    }
    setState(() => _submitting = true);
    try {
      final message = await HrApiService.applyRegularization(
        date: DateFormat('yyyy-MM-dd').format(_date!),
        requestedStatus: _type,
        fromTime: _hhmm(_from!),
        toTime: _hhmm(_to!),
        reason: _reasonCtrl.text.trim(),
        shiftId: _shiftId,
      );
      if (!mounted) return;
      _toast(message);
      // Show the request in "My Regularizations" straight away.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MyRegularizationPage()),
      );
    } on HrApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) _toast('Could not submit the request. Please try again.', error: true);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  void _toast(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? const Color(0xFFDC2626) : _green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: _appBar(
        context,
        'Apply Regularization',
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => const MyRegularizationPage()),
            ),
            child: Text('My Requests', style: TextStyle(color: _green, fontWeight: FontWeight.w700, fontSize: 13.sp)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _green))
          : GestureDetector(
              onTap: () => FocusScope.of(context).unfocus(),
              child: ListView(
                padding: EdgeInsets.fromLTRB(16.w, 14.h, 16.w, 28.h),
                children: [
                  Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF3C7),
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.info_outline_rounded, color: _amber, size: 18.sp),
                        SizedBox(width: 8.w),
                        Expanded(
                          child: Text(
                            'Use this to correct a missed or wrong punch on a past day. '
                            'You can regularize the last $_maxDays days (not today). '
                            'The request goes for approval and attendance is updated once approved.',
                            style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF92400E), height: 1.35),
                          ),
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 16.h),
                  _label('Date to regularize'),
                  _pickerTile(
                    icon: Icons.calendar_month_rounded,
                    text: _date == null ? 'Select date' : DateFormat('EEE, dd MMM yyyy').format(_date!),
                    filled: _date != null,
                    onTap: _pickDate,
                  ),
                  SizedBox(height: 14.h),
                  _label('Mark as'),
                  Row(
                    children: [
                      Expanded(child: _typeChip('PRESENT', 'Present')),
                      SizedBox(width: 10.w),
                      Expanded(child: _typeChip('HALF_DAY', 'Half Day')),
                    ],
                  ),
                  if (_shifts.isNotEmpty) ...[
                    SizedBox(height: 14.h),
                    _label('Shift (optional)'),
                    Container(
                      padding: EdgeInsets.symmetric(horizontal: 12.w),
                      decoration: _boxDecoration(),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String?>(
                          isExpanded: true,
                          value: _shiftId,
                          hint: Text('No shift selected', style: TextStyle(fontSize: 13.sp, color: _muted)),
                          items: [
                            DropdownMenuItem<String?>(
                              value: null,
                              child: Text('No shift selected', style: TextStyle(fontSize: 13.sp, color: _muted)),
                            ),
                            for (final s in _shifts)
                              DropdownMenuItem<String?>(
                                value: s['id']?.toString(),
                                child: Text(
                                  '${s['name']}  (${_time12(s['shiftStart']?.toString() ?? '')} – ${_time12(s['shiftEnd']?.toString() ?? '')})',
                                  style: TextStyle(fontSize: 13.sp, color: _navy),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                          ],
                          onChanged: _onShiftChanged,
                        ),
                      ),
                    ),
                  ],
                  SizedBox(height: 14.h),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('From time'),
                            _pickerTile(
                              icon: Icons.login_rounded,
                              text: _from == null ? 'Select' : _time12(_hhmm(_from!)),
                              filled: _from != null,
                              onTap: () => _pickTime(from: true),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: 10.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            _label('To time'),
                            _pickerTile(
                              icon: Icons.logout_rounded,
                              text: _to == null ? 'Select' : _time12(_hhmm(_to!)),
                              filled: _to != null,
                              onTap: () => _pickTime(from: false),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 14.h),
                  _label('Reason'),
                  Container(
                    decoration: _boxDecoration(),
                    child: TextField(
                      controller: _reasonCtrl,
                      maxLines: 4,
                      maxLength: 500,
                      textCapitalization: TextCapitalization.sentences,
                      style: TextStyle(fontSize: 13.sp, color: _navy),
                      decoration: InputDecoration(
                        hintText: 'e.g. Forgot to punch in / phone battery was dead',
                        hintStyle: TextStyle(fontSize: 12.5.sp, color: _muted),
                        border: InputBorder.none,
                        counterText: '',
                        contentPadding: EdgeInsets.all(12.w),
                      ),
                    ),
                  ),
                  SizedBox(height: 22.h),
                  SizedBox(
                    height: 48.h,
                    child: ElevatedButton(
                      onPressed: _submitting ? null : _submit,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _green,
                        disabledBackgroundColor: _green.withOpacity(0.5),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                        elevation: 0,
                      ),
                      child: _submitting
                          ? SizedBox(
                              width: 20.w,
                              height: 20.w,
                              child: const CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                            )
                          : Text(
                              'Submit Request',
                              style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: Colors.white),
                            ),
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  BoxDecoration _boxDecoration() => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: _border),
      );

  Widget _label(String text) => Padding(
        padding: EdgeInsets.only(bottom: 6.h),
        child: Text(text, style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _navy)),
      );

  Widget _pickerTile({
    required IconData icon,
    required String text,
    required bool filled,
    required VoidCallback onTap,
  }) {
    return InkWell(
      borderRadius: BorderRadius.circular(12.r),
      onTap: onTap,
      child: Container(
        height: 48.h,
        padding: EdgeInsets.symmetric(horizontal: 12.w),
        decoration: _boxDecoration(),
        child: Row(
          children: [
            Icon(icon, size: 18.sp, color: _green),
            SizedBox(width: 8.w),
            Expanded(
              child: Text(
                text,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 13.sp,
                  fontWeight: filled ? FontWeight.w700 : FontWeight.w500,
                  color: filled ? _navy : _muted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _typeChip(String value, String label) {
    final selected = _type == value;
    return InkWell(
      borderRadius: BorderRadius.circular(12.r),
      onTap: () => setState(() => _type = value),
      child: Container(
        height: 44.h,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? _green : Colors.white,
          borderRadius: BorderRadius.circular(12.r),
          border: Border.all(color: selected ? _green : _border),
        ),
        child: Text(
          label,
          style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700, color: selected ? Colors.white : _muted),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// My Regularizations
// ─────────────────────────────────────────────────────────────────────────────

class MyRegularizationPage extends StatefulWidget {
  const MyRegularizationPage({super.key});

  @override
  State<MyRegularizationPage> createState() => _MyRegularizationPageState();
}

class _MyRegularizationPageState extends State<MyRegularizationPage> {
  List<RegularizationItem> _items = const [];
  bool _loading = true;
  String? _error;
  String _filter = 'All'; // All | Pending | Approved | Rejected | Cancelled
  String? _cancellingId;

  static const _filters = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final raw = await HrApiService.myRegularizations();
      final items = raw
          .whereType<Map>()
          .map((e) => RegularizationItem.fromJson(Map<String, dynamic>.from(e)))
          .toList();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
        _loading = false;
      });
    } on HrApiException catch (e) {
      if (mounted) setState(() { _error = e.message; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _error = 'Could not load your requests. Pull down to retry.'; _loading = false; });
    }
  }

  List<RegularizationItem> get _visible => _filter == 'All'
      ? _items
      : _items.where((e) => e.status.label == _filter).toList();

  int _count(String filter) =>
      filter == 'All' ? _items.length : _items.where((e) => e.status.label == filter).length;

  Future<void> _cancel(RegularizationItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        title: Text('Cancel request?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15.sp)),
        content: Text(
          'Cancel your regularization request for ${DateFormat('dd MMM yyyy').format(item.date)}?',
          style: TextStyle(fontSize: 12.5.sp, color: _muted),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep')),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Cancel request', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() => _cancellingId = item.id);
    try {
      final message = await HrApiService.cancelRegularization(item.id);
      if (!mounted) return;
      _toast(message);
      await _load();
    } on HrApiException catch (e) {
      if (mounted) _toast(e.message, error: true);
    } catch (_) {
      if (mounted) _toast('Could not cancel the request. Please try again.', error: true);
    } finally {
      if (mounted) setState(() => _cancellingId = null);
    }
  }

  void _toast(String text, {bool error = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(text),
        backgroundColor: error ? const Color(0xFFDC2626) : _green,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _openApply() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ApplyRegularizationPage()),
    );
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: _appBar(
        context,
        'My Regularizations',
        actions: [
          IconButton(
            tooltip: 'Apply',
            icon: Icon(Icons.add_circle_rounded, color: _green, size: 24.sp),
            onPressed: _openApply,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 12.h),
            child: Text(
              'Track your attendance regularization requests',
              style: TextStyle(fontSize: 13.sp, color: _muted, fontWeight: FontWeight.w500),
            ),
          ),
          SizedBox(height: 12.h),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: _filters.map(_filterChip).toList()),
            ),
          ),
          SizedBox(height: 12.h),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _green));

    final items = _visible;
    if (_error != null && _items.isEmpty) {
      return _scrollableMessage(Icons.cloud_off_rounded, _error!);
    }
    if (items.isEmpty) {
      return _scrollableMessage(
        Icons.event_available_rounded,
        _filter == 'All' ? 'No regularization requests yet' : 'No $_filter requests',
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 24.h),
        itemCount: items.length,
        separatorBuilder: (_, __) => SizedBox(height: 10.h),
        itemBuilder: (context, i) => _RegularizationCard(
          item: items[i],
          cancelling: _cancellingId == items[i].id,
          onCancel: () => _cancel(items[i]),
        ),
      ),
    );
  }

  Widget _scrollableMessage(IconData icon, String text) {
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(height: 120.h),
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 48.sp, color: const Color(0xFFCBD5E1)),
                SizedBox(height: 10.h),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: 32.w),
                  child: Text(
                    text,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: _muted),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String label) {
    final selected = _filter == label;
    return Padding(
      padding: EdgeInsets.only(right: 8.w),
      child: GestureDetector(
        onTap: () => setState(() => _filter = label),
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 8.h),
          decoration: BoxDecoration(
            color: selected ? _green : Colors.white,
            borderRadius: BorderRadius.circular(20.r),
            border: Border.all(color: selected ? _green : _border),
          ),
          child: Text(
            '$label (${_count(label)})',
            style: TextStyle(
              fontSize: 12.5.sp,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : _muted,
            ),
          ),
        ),
      ),
    );
  }
}

class _RegularizationCard extends StatelessWidget {
  const _RegularizationCard({required this.item, required this.onCancel, this.cancelling = false});

  final RegularizationItem item;
  final VoidCallback onCancel;
  final bool cancelling;

  @override
  Widget build(BuildContext context) {
    final fmtDay = DateFormat('EEE, dd MMM yyyy');
    final fmtStamp = DateFormat('dd MMM yyyy, hh:mm a');
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  fmtDay.format(item.date),
                  style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _navy),
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                decoration: BoxDecoration(color: item.status.bg, borderRadius: BorderRadius.circular(20.r)),
                child: Text(
                  item.status.label,
                  style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w800, color: item.status.fg),
                ),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          Wrap(
            spacing: 14.w,
            runSpacing: 6.h,
            children: [
              _fact(Icons.verified_user_outlined, item.typeLabel),
              _fact(
                Icons.schedule_rounded,
                '${_time12(item.fromTime)} – ${_time12(item.toTime)}${item.hours.isEmpty ? '' : '  (${item.hours} h)'}',
              ),
              if (item.shiftName != null) _fact(Icons.work_history_outlined, item.shiftName!),
            ],
          ),
          if (item.employeeName != null && item.status != RegularizationStatus.cancelled) ...[
            SizedBox(height: 6.h),
            Text('For: ${item.employeeName}', style: TextStyle(fontSize: 11.5.sp, color: _muted)),
          ],
          SizedBox(height: 8.h),
          Text(item.reason, style: TextStyle(fontSize: 12.5.sp, color: _navy, height: 1.35)),
          if (item.pendingStage != null) ...[
            SizedBox(height: 8.h),
            Text(
              'Waiting for: ${item.pendingStage}',
              style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: const Color(0xFFB45309)),
            ),
          ],
          if (item.decidedAt != null && item.status != RegularizationStatus.pending) ...[
            SizedBox(height: 8.h),
            Text(
              '${item.status.label}${item.decidedBy != null ? ' by ${item.decidedBy}' : ''} · ${fmtStamp.format(item.decidedAt!)}',
              style: TextStyle(fontSize: 11.sp, color: _muted),
            ),
          ],
          if (item.decisionRemarks != null && item.decisionRemarks!.trim().isNotEmpty) ...[
            SizedBox(height: 4.h),
            Text('Remarks: ${item.decisionRemarks}', style: TextStyle(fontSize: 11.5.sp, color: _muted)),
          ],
          if (item.appliedAt != null) ...[
            SizedBox(height: 6.h),
            Text('Applied ${fmtStamp.format(item.appliedAt!)}', style: TextStyle(fontSize: 10.5.sp, color: _muted)),
          ],
          if (item.status == RegularizationStatus.pending) ...[
            SizedBox(height: 10.h),
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: cancelling ? null : onCancel,
                icon: cancelling
                    ? SizedBox(width: 14.w, height: 14.w, child: const CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFDC2626)))
                    : Icon(Icons.close_rounded, size: 16.sp, color: const Color(0xFFDC2626)),
                label: Text(
                  'Cancel request',
                  style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: const Color(0xFFDC2626)),
                ),
                style: OutlinedButton.styleFrom(
                  side: const BorderSide(color: Color(0xFFFCA5A5)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _fact(IconData icon, String text) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14.sp, color: _green),
          SizedBox(width: 5.w),
          Flexible(child: Text(text, style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600, color: _navy))),
        ],
      );
}
