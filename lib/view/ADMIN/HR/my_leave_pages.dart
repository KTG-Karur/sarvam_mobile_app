import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/services/hr_api_service.dart';

// ─────────────────────────────────────────────────────────────────────────────
// Models
// ─────────────────────────────────────────────────────────────────────────────

enum LeaveStatus { pending, approved, rejected }

extension LeaveStatusX on LeaveStatus {
  String get label {
    switch (this) {
      case LeaveStatus.pending:
        return 'Pending';
      case LeaveStatus.approved:
        return 'Approved';
      case LeaveStatus.rejected:
        return 'Rejected';
    }
  }

  Color get fg {
    switch (this) {
      case LeaveStatus.pending:
        return const Color(0xFFB45309);
      case LeaveStatus.approved:
        return const Color(0xFF0D6842);
      case LeaveStatus.rejected:
        return const Color(0xFFDC2626);
    }
  }

  Color get bg {
    switch (this) {
      case LeaveStatus.pending:
        return const Color(0xFFFEF3C7);
      case LeaveStatus.approved:
        return const Color(0xFFDCFCE7);
      case LeaveStatus.rejected:
        return const Color(0xFFFEE2E2);
    }
  }
}

class LeaveRequestItem {
  final String id;
  final String typeCode; // CL / SL / PL
  final String typeLabel;
  final DateTime fromDate;
  final DateTime toDate;
  final String durationLabel; // e.g. Full Day
  final String reason;
  final String? attachmentName;
  final DateTime appliedOn;
  final LeaveStatus status;
  final String? approverRole;
  final DateTime? decidedAt;
  final String? decisionNote;

  const LeaveRequestItem({
    required this.id,
    required this.typeCode,
    required this.typeLabel,
    required this.fromDate,
    required this.toDate,
    required this.durationLabel,
    required this.reason,
    required this.appliedOn,
    required this.status,
    this.attachmentName,
    this.approverRole,
    this.decidedAt,
    this.decisionNote,
  });

  int get leaveDays => toDate.difference(fromDate).inDays + 1;

  String get title => '$typeLabel ($typeCode)';

  String get dateRange {
    final fmt = DateFormat('dd MMM yyyy');
    return '${fmt.format(fromDate)} – ${fmt.format(toDate)}';
  }

  String get daysText => '$leaveDays Day${leaveDays > 1 ? 's' : ''}';
}

/// Fallback only while the authenticated request is loading. Never shown as
/// real HR data after a request completes.
final List<LeaveRequestItem> kDemoLeaveRequests = [
  LeaveRequestItem(
    id: '1',
    typeCode: 'CL',
    typeLabel: 'Casual Leave',
    fromDate: DateTime(2026, 9, 12),
    toDate: DateTime(2026, 9, 13),
    durationLabel: 'Full Day',
    reason: 'Personal work',
    appliedOn: DateTime(2026, 9, 10),
    status: LeaveStatus.approved,
    approverRole: 'Regional Manager',
    decidedAt: DateTime(2026, 9, 11, 10, 30),
    decisionNote: 'Your leave request has been approved.',
  ),
  LeaveRequestItem(
    id: '2',
    typeCode: 'SL',
    typeLabel: 'Sick Leave',
    fromDate: DateTime(2026, 9, 5),
    toDate: DateTime(2026, 9, 5),
    durationLabel: 'Full Day',
    reason: 'Fever and rest advised by doctor',
    appliedOn: DateTime(2026, 9, 4),
    status: LeaveStatus.rejected,
    approverRole: 'Branch Manager',
    decidedAt: DateTime(2026, 9, 4, 16, 15),
    decisionNote: 'Your leave request has been rejected.',
  ),
  LeaveRequestItem(
    id: '3',
    typeCode: 'PL',
    typeLabel: 'Privilege Leave',
    fromDate: DateTime(2026, 9, 20),
    toDate: DateTime(2026, 9, 22),
    durationLabel: 'Full Day',
    reason: 'Family function',
    appliedOn: DateTime(2026, 9, 15),
    status: LeaveStatus.pending,
  ),
  LeaveRequestItem(
    id: '4',
    typeCode: 'CL',
    typeLabel: 'Casual Leave',
    fromDate: DateTime(2026, 8, 18),
    toDate: DateTime(2026, 8, 18),
    durationLabel: 'First Half',
    reason: 'Bank work',
    appliedOn: DateTime(2026, 8, 16),
    status: LeaveStatus.approved,
    approverRole: 'Regional Manager',
    decidedAt: DateTime(2026, 8, 17, 9, 45),
    decisionNote: 'Your leave request has been approved.',
  ),
];

const _green = Color(0xFF0D6842);
const _navy = Color(0xFF0F172A);
const _muted = Color(0xFF64748B);

// ─────────────────────────────────────────────────────────────────────────────
// Screen 1 – My Leave Requests
// ─────────────────────────────────────────────────────────────────────────────

class MyLeaveRequestsPage extends StatefulWidget {
  const MyLeaveRequestsPage({super.key});

  @override
  State<MyLeaveRequestsPage> createState() => _MyLeaveRequestsPageState();
}

class _MyLeaveRequestsPageState extends State<MyLeaveRequestsPage> {
  String _filter = 'All'; // All | Pending | Approved | Rejected
  var _isLoading = true;
  String? _loadError;
  List<LeaveRequestItem> _requests = const [];

  @override
  void initState() {
    super.initState();
    _loadRequests();
  }

  Future<void> _loadRequests() async {
    setState(() {
      _isLoading = true;
      _loadError = null;
    });
    try {
      final rows = await HrApiService.myLeaveRequests();
      if (!mounted) return;
      setState(() => _requests = rows.map(_fromApi).toList());
    } catch (error) {
      if (!mounted) return;
      setState(() => _loadError = error.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  LeaveRequestItem _fromApi(dynamic raw) {
    final row = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    final type = row['leaveType'] is Map ? Map<String, dynamic>.from(row['leaveType']) : <String, dynamic>{};
    final approvedBy = row['approvedBy'] is Map ? Map<String, dynamic>.from(row['approvedBy']) : <String, dynamic>{};
    DateTime parseDate(dynamic value) => DateTime.tryParse(value?.toString() ?? '') ?? DateTime.now();
    final statusValue = row['status']?.toString().toUpperCase();
    final status = statusValue == 'APPROVED'
        ? LeaveStatus.approved
        : statusValue == 'REJECTED' || statusValue == 'CANCELLED'
            ? LeaveStatus.rejected
            : LeaveStatus.pending;
    final label = type['leaveType']?.toString() ?? 'Leave';
    final code = row['leaveTypeCode']?.toString() ?? label;
    final approverName = '${approvedBy['firstName'] ?? ''} ${approvedBy['lastName'] ?? ''}'.trim();
    return LeaveRequestItem(
      id: row['id']?.toString() ?? '', typeCode: code, typeLabel: label,
      fromDate: parseDate(row['fromDate']), toDate: parseDate(row['toDate']),
      durationLabel: 'Full Day', reason: row['reason']?.toString() ?? '',
      appliedOn: parseDate(row['appliedAt']), status: status,
      approverRole: approverName.isEmpty ? null : approverName,
      decidedAt: row['approvedAt'] == null ? null : parseDate(row['approvedAt']),
      decisionNote: row['approvalRemarks']?.toString(),
    );
  }

  List<LeaveRequestItem> get _filtered {
    if (_filter == 'All') return _requests;
    final status = LeaveStatus.values.firstWhere(
      (s) => s.label == _filter,
    );
    return _requests.where((e) => e.status == status).toList();
  }

  @override
  Widget build(BuildContext context) {
    final items = _filtered;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
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
          'My Leave Requests',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: _navy,
          ),
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            color: Colors.white,
            padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 12.h),
            child: Text(
              'View and track your leave applications',
              style: TextStyle(
                fontSize: 13.sp,
                color: _muted,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          SizedBox(height: 12.h),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 16.w),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: ['All', 'Pending', 'Approved', 'Rejected']
                    .map((f) => _filterChip(f))
                    .toList(),
              ),
            ),
          ),
          SizedBox(height: 12.h),
          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator())
                : _loadError != null
                    ? Center(child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.cloud_off_rounded, color: _muted, size: 44),
                          const SizedBox(height: 12), Text(_loadError!, textAlign: TextAlign.center),
                          const SizedBox(height: 12), OutlinedButton(onPressed: _loadRequests, child: const Text('Retry')),
                        ]),
                      ))
                : items.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.event_busy_rounded,
                          size: 48.sp,
                          color: const Color(0xFFCBD5E1),
                        ),
                        SizedBox(height: 10.h),
                        Text(
                          'No $_filter leave requests',
                          style: TextStyle(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                            color: _muted,
                          ),
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 24.h),
                    itemCount: items.length,
                    separatorBuilder: (_, __) => SizedBox(height: 10.h),
                    itemBuilder: (context, index) {
                      final item = items[index];
                      return _LeaveRequestCard(
                        item: item,
                        onTap: () {
                          Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) =>
                                  LeaveRequestDetailsPage(item: item),
                            ),
                          );
                        },
                      );
                    },
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
            border: Border.all(
              color: selected ? _green : const Color(0xFFE2E8F0),
            ),
          ),
          child: Text(
            label,
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

class _LeaveRequestCard extends StatelessWidget {
  final LeaveRequestItem item;
  final VoidCallback onTap;

  const _LeaveRequestCard({required this.item, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14.r),
        child: Container(
          padding: EdgeInsets.all(14.w),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14.r),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40.w,
                height: 40.w,
                decoration: BoxDecoration(
                  color: const Color(0xFFE8F5E9),
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Icon(
                  Icons.calendar_month_rounded,
                  color: _green,
                  size: 20.sp,
                ),
              ),
              SizedBox(width: 12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            item.title,
                            style: TextStyle(
                              fontSize: 14.sp,
                              fontWeight: FontWeight.w800,
                              color: _navy,
                            ),
                          ),
                        ),
                        _StatusBadge(status: item.status),
                      ],
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      item.dateRange,
                      style: TextStyle(
                        fontSize: 12.5.sp,
                        color: _muted,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      item.daysText,
                      style: TextStyle(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w700,
                        color: _navy,
                      ),
                    ),
                    SizedBox(height: 8.h),
                    Text(
                      'Applied on ${DateFormat('dd MMM yyyy').format(item.appliedOn)}',
                      style: TextStyle(
                        fontSize: 11.5.sp,
                        color: _muted,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 4.w),
              Padding(
                padding: EdgeInsets.only(top: 10.h),
                child: Icon(
                  Icons.chevron_right_rounded,
                  color: const Color(0xFF94A3B8),
                  size: 22.sp,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final LeaveStatus status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: status.bg,
        borderRadius: BorderRadius.circular(20.r),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 11.sp,
          fontWeight: FontWeight.w700,
          color: status.fg,
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Screen 2 – Leave Request Details
// ─────────────────────────────────────────────────────────────────────────────

class LeaveRequestDetailsPage extends StatelessWidget {
  final LeaveRequestItem item;
  const LeaveRequestDetailsPage({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final fmt = DateFormat('dd MMM yyyy');
    final detailRows = <(IconData, String, String)>[
      (Icons.event_available_rounded, 'Applied On', fmt.format(item.appliedOn)),
      (Icons.person_outline_rounded, 'Leave Type', item.title),
      (Icons.calendar_today_rounded, 'From Date', fmt.format(item.fromDate)),
      (Icons.event_rounded, 'To Date', fmt.format(item.toDate)),
      (
        Icons.schedule_rounded,
        'Duration',
        '${item.daysText} (${item.durationLabel})',
      ),
      (Icons.description_outlined, 'Reason', item.reason),
      (
        Icons.attach_file_rounded,
        'Attachment',
        item.attachmentName ?? 'No file attached',
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
          'Leave Request Details',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.w800,
            color: _navy,
          ),
        ),
      ),
      body: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(16.w, 8.h, 16.w, 28.h),
        physics: const BouncingScrollPhysics(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Summary card
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(14.w),
              decoration: BoxDecoration(
                color: const Color(0xFFE8F5E9),
                borderRadius: BorderRadius.circular(16.r),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48.w,
                    height: 48.w,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.7),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.calendar_month_rounded,
                      color: _green,
                      size: 24.sp,
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.title,
                          style: TextStyle(
                            fontSize: 15.sp,
                            fontWeight: FontWeight.w800,
                            color: _navy,
                          ),
                        ),
                        SizedBox(height: 2.h),
                        Text(
                          item.dateRange,
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            color: _muted,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        Text(
                          item.daysText,
                          style: TextStyle(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w700,
                            color: _navy,
                          ),
                        ),
                      ],
                    ),
                  ),
                  _StatusBadge(status: item.status),
                ],
              ),
            ),
            SizedBox(height: 20.h),
            ...detailRows.map(
              (r) => Padding(
                padding: EdgeInsets.only(bottom: 16.h),
                child: Row(
                  children: [
                    Container(
                      width: 36.w,
                      height: 36.w,
                      decoration: const BoxDecoration(
                        color: Color(0xFFE8F5E9),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(r.$1, color: _green, size: 18.sp),
                    ),
                    SizedBox(width: 12.w),
                    Expanded(
                      child: Text(
                        r.$2,
                        style: TextStyle(
                          fontSize: 13.sp,
                          color: _muted,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                    Flexible(
                      child: Text(
                        r.$3,
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          fontSize: 13.5.sp,
                          fontWeight: FontWeight.w700,
                          color: _navy,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (item.status != LeaveStatus.pending) ...[
              SizedBox(height: 4.h),
              Row(
                children: [
                  Icon(
                    item.status == LeaveStatus.approved
                        ? Icons.check_circle_rounded
                        : Icons.cancel_rounded,
                    color: item.status.fg,
                    size: 20.sp,
                  ),
                  SizedBox(width: 8.w),
                  Text(
                    'Approval Details',
                    style: TextStyle(
                      fontSize: 14.5.sp,
                      fontWeight: FontWeight.w800,
                      color: _navy,
                    ),
                  ),
                ],
              ),
              SizedBox(height: 12.h),
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(14.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14.r),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 18.r,
                          backgroundColor: const Color(0xFFE2E8F0),
                          child: Icon(
                            Icons.person_rounded,
                            color: _muted,
                            size: 20.sp,
                          ),
                        ),
                        SizedBox(width: 10.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                item.status == LeaveStatus.approved
                                    ? 'Approved by'
                                    : 'Rejected by',
                                style: TextStyle(
                                  fontSize: 11.5.sp,
                                  color: _muted,
                                ),
                              ),
                              Text(
                                item.approverRole ?? 'Manager',
                                style: TextStyle(
                                  fontSize: 14.sp,
                                  fontWeight: FontWeight.w800,
                                  color: _navy,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (item.decidedAt != null)
                          Text(
                            DateFormat('dd MMM yyyy, hh:mm a')
                                .format(item.decidedAt!),
                            style: TextStyle(
                              fontSize: 11.sp,
                              color: _muted,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                      ],
                    ),
                    SizedBox(height: 12.h),
                    Container(
                      width: double.infinity,
                      padding: EdgeInsets.symmetric(
                        horizontal: 12.w,
                        vertical: 10.h,
                      ),
                      decoration: BoxDecoration(
                        color: item.status.bg,
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      child: Text(
                        item.decisionNote ??
                            (item.status == LeaveStatus.approved
                                ? 'Your leave request has been approved.'
                                : 'Your leave request has been rejected.'),
                        style: TextStyle(
                          fontSize: 12.5.sp,
                          fontWeight: FontWeight.w600,
                          color: item.status.fg,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ] else ...[
              SizedBox(height: 8.h),
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(14.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(12.r),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.hourglass_top_rounded,
                      color: const Color(0xFFB45309),
                      size: 20.sp,
                    ),
                    SizedBox(width: 10.w),
                    Expanded(
                      child: Text(
                        'Your leave request is awaiting manager approval.',
                        style: TextStyle(
                          fontSize: 12.5.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFFB45309),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
