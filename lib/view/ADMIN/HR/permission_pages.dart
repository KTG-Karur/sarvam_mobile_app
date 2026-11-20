import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:intl/intl.dart';

import 'package:sarvam/services/hr_api_service.dart';
// The four request states (pending / approved / rejected / cancelled) look the same
// for every HR request, so the status colours and labels are shared.
import 'package:sarvam/view/ADMIN/HR/regularization_pages.dart' show RegularizationStatus, RegularizationStatusX;

// ─────────────────────────────────────────────────────────────────────────────
// Permission — a few hours off within one day. Apply + My Permissions.
// Same endpoints as the web (Permission Management > Apply Permission):
//   GET  /api/hr/permission                own requests
//   GET  /api/payroll/permission-types     the types to choose from
//   POST /api/hr/permission/apply          submit
//   POST /api/hr/permission/{id}/cancel
// The server enforces the rules (valid type, to-time after from-time, no
// overlap with another request that day, approval flow, hours quota).
// ─────────────────────────────────────────────────────────────────────────────

const _green = Color(0xFF0D6842);
const _navy = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);
const _border = Color(0xFFE2E8F0);
const _bg = Color(0xFFF8FAFC);

class PermissionItem {
  final String id;
  final DateTime date; // IST calendar day
  final String typeName;
  final String fromTime;
  final String toTime;
  final String hours;
  final String reason;
  final RegularizationStatus status;
  final String? approverName;
  final String? remarks;
  final DateTime? appliedAt;
  final DateTime? decidedAt;
  final String? pendingStage;

  const PermissionItem({
    required this.id,
    required this.date,
    required this.typeName,
    required this.fromTime,
    required this.toTime,
    required this.hours,
    required this.reason,
    required this.status,
    this.approverName,
    this.remarks,
    this.appliedAt,
    this.decidedAt,
    this.pendingStage,
  });

  factory PermissionItem.fromJson(Map<String, dynamic> json) {
    String? approver;
    final by = json['approvedBy'];
    if (by is Map) {
      final full = '${by['firstName'] ?? ''} ${by['lastName'] ?? ''}'.trim();
      approver = full.isEmpty ? null : full;
    }
    final stage = json['approval'];
    final status = switch (json['status']?.toString().toUpperCase()) {
      'APPROVED' => RegularizationStatus.approved,
      'REJECTED' => RegularizationStatus.rejected,
      'CANCELLED' => RegularizationStatus.cancelled,
      _ => RegularizationStatus.pending,
    };
    final hoursRaw = double.tryParse(json['hours']?.toString() ?? '');
    return PermissionItem(
      id: json['id']?.toString() ?? '',
      date: _istDay(json['date']) ?? DateTime.now(),
      typeName: (json['permissionType'] is Map ? json['permissionType']['permissionType'] : null)?.toString() ?? 'Permission',
      fromTime: json['fromTime']?.toString() ?? '--:--',
      toTime: json['toTime']?.toString() ?? '--:--',
      hours: hoursRaw == null ? '' : (hoursRaw % 1 == 0 ? hoursRaw.toInt().toString() : hoursRaw.toStringAsFixed(2)),
      reason: json['reason']?.toString() ?? '',
      status: status,
      approverName: approver,
      remarks: json['approvalRemarks']?.toString(),
      appliedAt: DateTime.tryParse(json['appliedAt']?.toString() ?? '')?.toLocal(),
      decidedAt: DateTime.tryParse(json['approvedAt']?.toString() ?? '')?.toLocal(),
      pendingStage: status == RegularizationStatus.pending && stage is Map && stage['stageName'] != null
          ? '${stage['stageName']} (${stage['stageNumber']} of ${stage['totalStages']})'
          : null,
    );
  }

  /// The API stores a business day as IST midnight in UTC, so read it in IST
  /// rather than in the phone's time zone.
  static DateTime? _istDay(dynamic raw) {
    final parsed = DateTime.tryParse(raw?.toString() ?? '');
    if (parsed == null) return null;
    final ist = parsed.toUtc().add(const Duration(hours: 5, minutes: 30));
    return DateTime(ist.year, ist.month, ist.day);
  }
}

String _hhmm(TimeOfDay t) => '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

int _minutes(TimeOfDay t) => t.hour * 60 + t.minute;

String _time12(String hhmm) {
  final parts = hhmm.split(':');
  final h = parts.length > 1 ? int.tryParse(parts[0]) : null;
  final m = parts.length > 1 ? int.tryParse(parts[1]) : null;
  if (h == null || m == null) return hhmm;
  final hour12 = h % 12 == 0 ? 12 : h % 12;
  return '$hour12:${m.toString().padLeft(2, '0')} ${h < 12 ? 'AM' : 'PM'}';
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
// Apply Permission
// ─────────────────────────────────────────────────────────────────────────────

class ApplyPermissionPage extends StatefulWidget {
  const ApplyPermissionPage({super.key});

  @override
  State<ApplyPermissionPage> createState() => _ApplyPermissionPageState();
}

class _ApplyPermissionPageState extends State<ApplyPermissionPage> {
  final _reasonCtrl = TextEditingController();
  List<Map<String, dynamic>> _types = const [];
  bool _loading = true;
  String? _loadError;
  bool _submitting = false;

  String? _typeId;
  DateTime? _date;
  TimeOfDay? _from;
  TimeOfDay? _to;

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
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final raw = await HrApiService.permissionTypes();
      if (!mounted) return;
      setState(() {
        _types = raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loading = false;
      });
    } on HrApiException catch (e) {
      if (mounted) setState(() { _loadError = e.message; _loading = false; });
    } catch (_) {
      if (mounted) setState(() { _loadError = 'Could not load permission types.'; _loading = false; });
    }
  }

  DateTime get _today {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? _today,
      firstDate: _today.subtract(const Duration(days: 90)),
      lastDate: _today.add(const Duration(days: 90)),
      helpText: 'Select the day for the permission',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime({required bool from}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime: (from ? _from : _to) ?? (from ? const TimeOfDay(hour: 10, minute: 0) : const TimeOfDay(hour: 11, minute: 0)),
    );
    if (picked != null) setState(() => from ? _from = picked : _to = picked);
  }

  /// "1h 30m" for the chosen times, or null until both are valid.
  String? get _duration {
    if (_from == null || _to == null) return null;
    final diff = _minutes(_to!) - _minutes(_from!);
    if (diff <= 0) return null;
    final h = diff ~/ 60;
    final m = diff % 60;
    return [if (h > 0) '${h}h', if (m > 0) '${m}m'].join(' ');
  }

  String? _validate() {
    if (_typeId == null) return 'Please select a permission type';
    if (_date == null) return 'Please select the date';
    if (_from == null || _to == null) return 'Please select the from and to time';
    if (_minutes(_to!) <= _minutes(_from!)) return 'To time must be after from time';
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
      final message = await HrApiService.applyPermission(
        permissionTypeId: _typeId!,
        date: DateFormat('yyyy-MM-dd').format(_date!),
        fromTime: _hhmm(_from!),
        toTime: _hhmm(_to!),
        reason: _reasonCtrl.text,
      );
      if (!mounted) return;
      _toast(message);
      // Show the request in "My Permissions" straight away.
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const MyPermissionPage()),
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

  BoxDecoration get _box => BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: _border),
      );

  Widget _label(String text) => Padding(
        padding: EdgeInsets.only(bottom: 6.h),
        child: Text(text, style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _navy)),
      );

  Widget _pickerTile({required IconData icon, required String text, required bool filled, required VoidCallback onTap}) {
    return InkWell(
      borderRadius: BorderRadius.circular(12.r),
      onTap: onTap,
      child: Container(
        height: 48.h,
        padding: EdgeInsets.symmetric(horizontal: 12.w),
        decoration: _box,
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: _appBar(
        context,
        'Apply Permission',
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const MyPermissionPage())),
            child: Text('My Requests', style: TextStyle(color: _green, fontWeight: FontWeight.w700, fontSize: 13.sp)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: _green))
          : _loadError != null
              ? Center(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 32.w),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.cloud_off_rounded, size: 44.sp, color: const Color(0xFFCBD5E1)),
                        SizedBox(height: 10.h),
                        Text(_loadError!, textAlign: TextAlign.center, style: TextStyle(fontSize: 13.sp, color: _muted)),
                        TextButton(onPressed: _load, child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : GestureDetector(
                  onTap: () => FocusScope.of(context).unfocus(),
                  child: ListView(
                    padding: EdgeInsets.fromLTRB(16.w, 14.h, 16.w, 28.h),
                    children: [
                      Container(
                        padding: EdgeInsets.all(12.w),
                        decoration: BoxDecoration(color: const Color(0xFFE8F5E9), borderRadius: BorderRadius.circular(12.r)),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Icon(Icons.info_outline_rounded, color: _green, size: 18.sp),
                            SizedBox(width: 8.w),
                            Expanded(
                              child: Text(
                                'Use permission for a few hours off within one day. '
                                'It goes for approval; you can cancel it while it is still pending.',
                                style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF14532D), height: 1.35),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(height: 16.h),
                      _label('Permission type'),
                      Container(
                        padding: EdgeInsets.symmetric(horizontal: 12.w),
                        decoration: _box,
                        child: DropdownButtonHideUnderline(
                          child: DropdownButton<String>(
                            isExpanded: true,
                            value: _typeId,
                            hint: Text('Select type', style: TextStyle(fontSize: 13.sp, color: _muted)),
                            items: [
                              for (final t in _types)
                                DropdownMenuItem<String>(
                                  value: t['id']?.toString(),
                                  child: Text(t['permissionType']?.toString() ?? '-', style: TextStyle(fontSize: 13.sp, color: _navy)),
                                ),
                            ],
                            onChanged: (v) => setState(() => _typeId = v),
                          ),
                        ),
                      ),
                      if (_types.isEmpty)
                        Padding(
                          padding: EdgeInsets.only(top: 6.h),
                          child: Text(
                            'No permission types are set up yet. Please contact HR.',
                            style: TextStyle(fontSize: 11.sp, color: const Color(0xFFDC2626)),
                          ),
                        ),
                      SizedBox(height: 14.h),
                      _label('Date'),
                      _pickerTile(
                        icon: Icons.calendar_month_rounded,
                        text: _date == null ? 'Select date' : DateFormat('EEE, dd MMM yyyy').format(_date!),
                        filled: _date != null,
                        onTap: _pickDate,
                      ),
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
                      if (_duration != null)
                        Padding(
                          padding: EdgeInsets.only(top: 8.h),
                          child: Text(
                            'Duration: $_duration',
                            style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _green),
                          ),
                        ),
                      SizedBox(height: 14.h),
                      _label('Reason (optional)'),
                      Container(
                        decoration: _box,
                        child: TextField(
                          controller: _reasonCtrl,
                          maxLines: 3,
                          maxLength: 300,
                          textCapitalization: TextCapitalization.sentences,
                          style: TextStyle(fontSize: 13.sp, color: _navy),
                          decoration: InputDecoration(
                            hintText: 'e.g. Bank work / doctor appointment',
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
                            disabledBackgroundColor: _green.withValues(alpha: 0.5),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                            elevation: 0,
                          ),
                          child: _submitting
                              ? SizedBox(width: 20.w, height: 20.w, child: const CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white))
                              : Text('Submit Request', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: Colors.white)),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// My Permissions
// ─────────────────────────────────────────────────────────────────────────────

class MyPermissionPage extends StatefulWidget {
  const MyPermissionPage({super.key});

  @override
  State<MyPermissionPage> createState() => _MyPermissionPageState();
}

class _MyPermissionPageState extends State<MyPermissionPage> {
  List<PermissionItem> _items = const [];
  bool _loading = true;
  String? _error;
  String _filter = 'All';
  String? _cancellingId;

  static const _filters = ['All', 'Pending', 'Approved', 'Rejected', 'Cancelled'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final raw = await HrApiService.myPermissions();
      final items = raw.whereType<Map>().map((e) => PermissionItem.fromJson(Map<String, dynamic>.from(e))).toList();
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

  List<PermissionItem> get _visible => _filter == 'All' ? _items : _items.where((e) => e.status.label == _filter).toList();

  int _count(String f) => f == 'All' ? _items.length : _items.where((e) => e.status.label == f).length;

  Future<void> _cancel(PermissionItem item) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        title: Text('Cancel request?', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15.sp)),
        content: Text(
          'Cancel your permission request for ${DateFormat('dd MMM yyyy').format(item.date)} '
          '(${_time12(item.fromTime)} – ${_time12(item.toTime)})?',
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
      final message = await HrApiService.cancelPermission(item.id);
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
      SnackBar(content: Text(text), backgroundColor: error ? const Color(0xFFDC2626) : _green, behavior: SnackBarBehavior.floating),
    );
  }

  Future<void> _openApply() async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => const ApplyPermissionPage()));
    if (mounted) _load();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: _appBar(
        context,
        'My Permissions',
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
            child: Text('Track your permission requests', style: TextStyle(fontSize: 13.sp, color: _muted, fontWeight: FontWeight.w500)),
          ),
          SizedBox(height: 12.h),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w),
            child: SingleChildScrollView(scrollDirection: Axis.horizontal, child: Row(children: _filters.map(_chip).toList())),
          ),
          SizedBox(height: 12.h),
          Expanded(child: _body()),
        ],
      ),
    );
  }

  Widget _body() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _green));
    if (_error != null && _items.isEmpty) return _message(Icons.cloud_off_rounded, _error!);
    final items = _visible;
    if (items.isEmpty) {
      return _message(Icons.timer_off_rounded, _filter == 'All' ? 'No permission requests yet' : 'No $_filter requests');
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: _green,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 24.h),
        itemCount: items.length,
        separatorBuilder: (_, __) => SizedBox(height: 10.h),
        itemBuilder: (context, i) => _PermissionCard(
          item: items[i],
          cancelling: _cancellingId == items[i].id,
          onCancel: () => _cancel(items[i]),
        ),
      ),
    );
  }

  Widget _message(IconData icon, String text) {
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
                  child: Text(text, textAlign: TextAlign.center, style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600, color: _muted)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String label) {
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
            style: TextStyle(fontSize: 12.5.sp, fontWeight: FontWeight.w700, color: selected ? Colors.white : _muted),
          ),
        ),
      ),
    );
  }
}

class _PermissionCard extends StatelessWidget {
  const _PermissionCard({required this.item, required this.onCancel, this.cancelling = false});

  final PermissionItem item;
  final VoidCallback onCancel;
  final bool cancelling;

  @override
  Widget build(BuildContext context) {
    final fmtStamp = DateFormat('dd MMM yyyy, hh:mm a');
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14.r), border: Border.all(color: _border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  DateFormat('EEE, dd MMM yyyy').format(item.date),
                  style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _navy),
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                decoration: BoxDecoration(color: item.status.bg, borderRadius: BorderRadius.circular(20.r)),
                child: Text(item.status.label, style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w800, color: item.status.fg)),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          Wrap(
            spacing: 14.w,
            runSpacing: 6.h,
            children: [
              _fact(Icons.label_outline_rounded, item.typeName),
              _fact(
                Icons.schedule_rounded,
                '${_time12(item.fromTime)} – ${_time12(item.toTime)}${item.hours.isEmpty ? '' : '  (${item.hours} h)'}',
              ),
            ],
          ),
          if (item.reason.trim().isNotEmpty) ...[
            SizedBox(height: 8.h),
            Text(item.reason, style: TextStyle(fontSize: 12.5.sp, color: _navy, height: 1.35)),
          ],
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
              '${item.status.label}${item.approverName != null ? ' by ${item.approverName}' : ''} · ${fmtStamp.format(item.decidedAt!)}',
              style: TextStyle(fontSize: 11.sp, color: _muted),
            ),
          ],
          if (item.remarks != null && item.remarks!.trim().isNotEmpty) ...[
            SizedBox(height: 4.h),
            Text('Remarks: ${item.remarks}', style: TextStyle(fontSize: 11.5.sp, color: _muted)),
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
                label: Text('Cancel request', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: const Color(0xFFDC2626))),
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
