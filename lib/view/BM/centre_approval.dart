import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/centre_controller.dart';
import 'package:sarvam/view/FDO/loan_disbursement/center_details.dart';

class CentreApproval extends StatefulWidget {
  const CentreApproval({super.key});

  @override
  State<CentreApproval> createState() => _CentreApprovalState();
}

class _CentreApprovalState extends State<CentreApproval> {
  static const _green = Color(0xFF0D6842);
  static const _darkGreen = Color(0xFF0B4A2C);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE1EEE6);
  static const _pageBg = Color(0xFFF2FAF5);
  static const _tableHeaderBg = Color(0xFFEAF6EE);

  final CentreController _controller = Get.isRegistered<CentreController>()
      ? Get.find<CentreController>()
      : Get.put(CentreController());

  final TextEditingController _searchCtrl = TextEditingController();
  String _search = '';
  String _statusFilter = 'ALL';
  String _fallbackBranch = '';
  int _navIndex = 0;

  static const _statusFilters = [
    {'label': 'All Status', 'value': 'ALL'},
    {'label': 'Pending Approval', 'value': 'PENDING_APPROVAL'},
    {'label': 'Approved', 'value': 'APPROVED'},
    {'label': 'Rejected', 'value': 'REJECTED'},
  ];

  @override
  void initState() {
    super.initState();
    _loadFallbackBranch();
    _controller.getCenters();
    _searchCtrl.addListener(() {
      setState(() => _search = _searchCtrl.text.trim().toLowerCase());
    });
  }

  Future<void> _loadFallbackBranch() async {
    final prefs = await SharedPreferences.getInstance();
    if (mounted) {
      setState(() => _fallbackBranch = prefs.getString('branchName') ?? '');
    }
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _confirmApprove(String centerId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Dialog(
        insetPadding: EdgeInsets.symmetric(horizontal: 20.w),
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: 430.w),
          child: Padding(
            padding: EdgeInsets.fromLTRB(20.w, 16.h, 20.w, 16.h),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.check_circle_outline_rounded,
                      color: _green,
                      size: 19.sp,
                    ),
                    SizedBox(width: 8.w),
                    Expanded(
                      child: Text(
                        'Approve Center',
                        style: TextStyle(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w800,
                          color: _green,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      icon: Icon(
                        Icons.close_rounded,
                        color: _muted,
                        size: 18.sp,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
                SizedBox(height: 4.h),
                Text(
                  'Approve this center? It will become active and available for operations.',
                  style: TextStyle(
                    fontSize: 11.5.sp,
                    color: _muted,
                    height: 1.35,
                  ),
                ),
                SizedBox(height: 16.h),
                Align(
                  alignment: Alignment.centerRight,
                  child: Wrap(
                    spacing: 8.w,
                    children: [
                      OutlinedButton(
                        onPressed: () => Navigator.pop(dialogContext, false),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: _darkText,
                          side: const BorderSide(color: _border),
                        ),
                        child: const Text('Cancel'),
                      ),
                      ElevatedButton.icon(
                        onPressed: () => Navigator.pop(dialogContext, true),
                        icon: const Icon(Icons.thumb_up_outlined, size: 17),
                        label: const Text('Confirm Approve'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          foregroundColor: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    if (confirmed == true) {
      await _controller.approveCenter(centerId, 'APPROVE');
    }
  }

  Future<void> _confirmReject(String centerId) async {
    final reasonCtrl = TextEditingController();
    try {
      final reason = await showDialog<String>(
        context: context,
        builder: (dialogContext) => Dialog(
          insetPadding: EdgeInsets.symmetric(horizontal: 20.w),
          backgroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10.r),
          ),
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: 430.w),
            child: Padding(
              padding: EdgeInsets.fromLTRB(20.w, 16.h, 20.w, 20.h),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(
                        Icons.cancel_outlined,
                        color: const Color(0xFFDC2626),
                        size: 19.sp,
                      ),
                      SizedBox(width: 8.w),
                      Expanded(
                        child: Text(
                          'Reject Center',
                          style: TextStyle(
                            fontSize: 16.sp,
                            fontWeight: FontWeight.w800,
                            color: const Color(0xFFDC2626),
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        icon: Icon(
                          Icons.close_rounded,
                          color: _muted,
                          size: 18.sp,
                        ),
                        visualDensity: VisualDensity.compact,
                      ),
                    ],
                  ),
                  SizedBox(height: 4.h),
                  Text(
                    'Please provide a reason for rejecting this center.',
                    style: TextStyle(
                      fontSize: 11.5.sp,
                      color: _muted,
                      height: 1.35,
                    ),
                  ),
                  SizedBox(height: 14.h),
                  Text(
                    'Rejection Reason  *',
                    style: TextStyle(
                      fontSize: 11.5.sp,
                      fontWeight: FontWeight.w700,
                      color: const Color(0xFFDC2626),
                    ),
                  ),
                  SizedBox(height: 6.h),
                  TextField(
                    controller: reasonCtrl,
                    autofocus: true,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: 'Enter the reason for rejection...',
                      hintStyle: TextStyle(fontSize: 11.5.sp, color: _muted),
                      filled: true,
                      fillColor: const Color(0xFFFFFBFB),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8.r),
                        borderSide: const BorderSide(color: Color(0xFFFCA5A5)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8.r),
                        borderSide: const BorderSide(color: Color(0xFFFCA5A5)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8.r),
                        borderSide: const BorderSide(
                          color: Color(0xFFDC2626),
                          width: 2,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Wrap(
                      spacing: 8.w,
                      children: [
                        OutlinedButton(
                          onPressed: () => Navigator.pop(dialogContext),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: _darkText,
                            side: const BorderSide(color: _border),
                          ),
                          child: const Text('Cancel'),
                        ),
                        ElevatedButton.icon(
                          onPressed: () {
                            final trimmed = reasonCtrl.text.trim();
                            if (trimmed.isEmpty) {
                              Get.snackbar(
                                'Reason required',
                                'Please enter a rejection reason.',
                                snackPosition: SnackPosition.BOTTOM,
                                backgroundColor: Colors.redAccent,
                                colorText: Colors.white,
                              );
                              return;
                            }
                            Navigator.pop(dialogContext, trimmed);
                          },
                          icon: const Icon(Icons.thumb_down_outlined, size: 17),
                          label: const Text('Confirm Reject'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFF87171),
                            foregroundColor: Colors.white,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      if (reason != null && reason.isNotEmpty) {
        await _controller.approveCenter(
          centerId,
          'REJECT',
          rejectionReason: reason,
        );
      }
    } finally {
      reasonCtrl.dispose();
    }
  }

  String _field(Map center, String key, [String fallback = '—']) {
    final value = center[key];
    if (value == null || value.toString().trim().isEmpty) return fallback;
    return value.toString();
  }

  String _centerId(Map center) => "${center['id'] ?? center['centerId'] ?? ''}";

  String _fdoName(Map center) {
    final direct = center['fdoName'];
    if (direct != null && direct.toString().trim().isNotEmpty) {
      return direct.toString();
    }
    final fdo = center['fdo'];
    if (fdo is Map) {
      final name = "${fdo['firstName'] ?? ''} ${fdo['lastName'] ?? ''}".trim();
      if (name.isNotEmpty) return name;
    }
    return '—';
  }

  String _branchName(Map center) {
    final direct = center['branchName'] ?? center['branch'];
    if (direct is String && direct.trim().isNotEmpty) return direct;
    if (direct is Map) {
      final name = direct['name'];
      if (name != null && name.toString().trim().isNotEmpty) {
        return name.toString();
      }
    }
    return _fallbackBranch.isNotEmpty ? _fallbackBranch : '—';
  }

  String _formatDate(dynamic isoString) {
    if (isoString == null || isoString.toString().isEmpty) return '—';
    try {
      final dateTime = DateTime.parse(isoString.toString());
      return DateFormat('dd MMM yyyy').format(dateTime);
    } catch (_) {
      return isoString.toString();
    }
  }

  String _meetingInfo(Map center) {
    final day = _field(center, 'meetingDay', '');
    final time = _field(center, 'meetingTime', '');
    final place = _field(center, 'meetingPlace', '');
    final parts = <String>[];
    if (day.isNotEmpty) parts.add(day);
    if (time.isNotEmpty) parts.add(time);
    if (place.isNotEmpty) parts.add(place);
    if (parts.isEmpty) return '—';
    return parts.join(' • ');
  }

  List<dynamic> get _filteredCenters {
    return _controller.centersList.where((raw) {
      final center = raw as Map;
      final status = _field(center, 'status', 'PENDING_APPROVAL');
      if (_statusFilter != 'ALL' && status != _statusFilter) return false;
      if (_search.isEmpty) return true;
      final haystack = [
        _field(center, 'name', ''),
        _field(center, 'code', ''),
        _fdoName(center),
        _branchName(center),
        _field(center, 'contactPerson', ''),
        _field(center, 'meetingPlace', ''),
      ].join(' ').toLowerCase();
      return haystack.contains(_search);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        bottom: false,
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 20.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              SizedBox(height: 4.h),
              Padding(
                padding: EdgeInsets.only(left: 40.w),
                child: Text(
                  'Review and approve or reject center creation requests.',
                  style: TextStyle(fontSize: 11.5.sp, color: _muted),
                ),
              ),
              SizedBox(height: 16.h),
              _buildSearchAndFilter(),
              SizedBox(height: 16.h),
              _buildRequestsCard(),
              SizedBox(height: 16.h),
              _buildFooterNote(),
            ],
          ),
        ),
      ),
    );
  }

  // Header: back button + shield icon + title + Refresh button
  Widget _buildHeader() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.05),
                  blurRadius: 4,
                  offset: const Offset(0, 1),
                ),
              ],
            ),
            child: Icon(
              Icons.arrow_back_ios_new_rounded,
              size: 15.sp,
              color: _darkText,
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Container(
          padding: EdgeInsets.all(6.w),
          decoration: BoxDecoration(
            color: _green,
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Icon(Icons.gpp_good_rounded, size: 16.sp, color: Colors.white),
        ),
        SizedBox(width: 8.w),
        Expanded(
          child: Text(
            'Center Approval',
            style: TextStyle(
              fontSize: 19.sp,
              fontWeight: FontWeight.w800,
              color: _darkGreen,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        SizedBox(width: 8.w),
        Obx(
          () => OutlinedButton.icon(
            onPressed: _controller.isLoading.value
                ? null
                : () => _controller.getCenters(),
            icon: _controller.isLoading.value
                ? SizedBox(
                    width: 14.w,
                    height: 14.w,
                    child: const CircularProgressIndicator(
                      color: _green,
                      strokeWidth: 2,
                    ),
                  )
                : Icon(Icons.refresh_rounded, size: 16.sp, color: _darkText),
            label: Text(
              'Refresh',
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            style: OutlinedButton.styleFrom(
              backgroundColor: Colors.white,
              side: const BorderSide(color: Color(0xFFCBD5E1)),
              padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8.r),
              ),
            ),
          ),
        ),
      ],
    );
  }

  // Search input + status filter button, side by side
  Widget _buildSearchAndFilter() {
    return Row(
      children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8.r),
              border: Border.all(color: _border),
            ),
            child: TextField(
              controller: _searchCtrl,
              style: TextStyle(fontSize: 12.5.sp, color: _darkText),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 10.w,
                  vertical: 12.h,
                ),
                hintText: 'Search by center name, code, FDO, branch...',
                hintStyle: TextStyle(fontSize: 11.5.sp, color: _muted),
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: _muted,
                  size: 18.sp,
                ),
              ),
            ),
          ),
        ),
        SizedBox(width: 8.w),
        _buildStatusFilterButton(),
      ],
    );
  }

  Widget _buildStatusFilterButton() {
    final current = _statusFilters.firstWhere(
      (f) => f['value'] == _statusFilter,
    );
    return PopupMenuButton<String>(
      onSelected: (value) => setState(() => _statusFilter = value),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
      itemBuilder: (context) => _statusFilters
          .map(
            (f) => PopupMenuItem<String>(
              value: f['value'],
              child: Text(f['label']!, style: TextStyle(fontSize: 12.5.sp)),
            ),
          )
          .toList(),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 12.h),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(8.r),
          border: Border.all(color: _border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.filter_list_rounded, size: 16.sp, color: _green),
            SizedBox(width: 5.w),
            Text(
              current['label']!,
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w600,
                color: _darkText,
              ),
            ),
            SizedBox(width: 2.w),
            Icon(Icons.keyboard_arrow_down_rounded, size: 18.sp, color: _muted),
          ],
        ),
      ),
    );
  }

  // Requests card: header + table header row + list
  Widget _buildRequestsCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _border),
      ),
      child: Obx(() {
        final filtered = _filteredCenters;
        final currentLabel = _statusFilters.firstWhere(
          (f) => f['value'] == _statusFilter,
        )['label'];
        final subtitle = _statusFilter == 'ALL'
            ? '${filtered.length} requests found'
            : '${filtered.length} $currentLabel';

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.w),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE4F5EA),
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                  child: Icon(
                    Icons.description_outlined,
                    color: _green,
                    size: 16.sp,
                  ),
                ),
                SizedBox(width: 10.w),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Center Requests',
                      style: TextStyle(
                        fontSize: 14.5.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      subtitle,
                      style: TextStyle(fontSize: 10.5.sp, color: _muted),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: 14.h),
            if (filtered.isNotEmpty) _buildTableHeaderRow(),
            SizedBox(height: 10.h),
            if (_controller.isLoading.value && filtered.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: 40.h),
                child: const Center(
                  child: CircularProgressIndicator(color: _green),
                ),
              )
            else if (filtered.isEmpty)
              Padding(
                padding: EdgeInsets.symmetric(vertical: 32.h),
                child: Center(
                  child: Text(
                    'No center requests found.',
                    style: TextStyle(fontSize: 12.sp, color: _muted),
                  ),
                ),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: filtered.length,
                separatorBuilder: (_, __) => SizedBox(height: 10.h),
                itemBuilder: (context, index) =>
                    _buildRequestRow(filtered[index] as Map),
              ),
          ],
        );
      }),
    );
  }

  Widget _buildTableHeaderRow() {
    TextStyle style = TextStyle(
      fontSize: 10.5.sp,
      fontWeight: FontWeight.w800,
      color: _darkGreen,
    );
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: _tableHeaderBg,
        borderRadius: BorderRadius.circular(8.r),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 16.w,
            child: Text('#', style: style),
          ),
          SizedBox(width: 8.w),
          Expanded(flex: 3, child: Text('Center Name', style: style)),
          Expanded(flex: 2, child: Text('FDO', style: style)),
          Expanded(flex: 2, child: Text('Branch', style: style)),
          SizedBox(
            width: 66.w,
            child: Text('Status', textAlign: TextAlign.right, style: style),
          ),
        ],
      ),
    );
  }

  Widget _buildRequestRow(Map center) {
    final id = _centerId(center);
    final code = _field(center, 'code', '');
    final name = _field(center, 'name', 'Unnamed Center');
    final status = _field(center, 'status', 'PENDING_APPROVAL');
    final branch = _branchName(center);
    final fdo = _fdoName(center);
    final contactNumber = _field(center, 'contactNumber');
    final km = center['kmFromBranch'] != null
        ? '${center['kmFromBranch']} KM'
        : '—';
    final created = _formatDate(center['createdAt']);
    final meeting = _meetingInfo(center);
    final isPending = status == 'PENDING_APPROVAL';
    final index = _filteredCenters.indexOf(center) + 1;

    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(10.r),
      child: InkWell(
        borderRadius: BorderRadius.circular(10.r),
        onTap: id.isEmpty
            ? null
            : () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => CenterDetails(centerId: id)),
              ),
        child: Container(
          padding: EdgeInsets.all(12.w),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(10.r),
            border: Border.all(color: _border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 16.w,
                    child: Text(
                      '$index',
                      style: TextStyle(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.w800,
                        color: _darkText,
                      ),
                    ),
                  ),
                  SizedBox(width: 8.w),
                  Expanded(
                    flex: 3,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            fontWeight: FontWeight.w800,
                            color: _darkText,
                          ),
                        ),
                        if (code.isNotEmpty) ...[
                          SizedBox(height: 2.h),
                          Text(
                            'Code: $code',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 9.5.sp,
                              fontWeight: FontWeight.w600,
                              color: _green,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: Text(
                      fdo,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.sp, color: _darkText),
                    ),
                  ),
                  Expanded(
                    flex: 2,
                    child: Text(
                      branch,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 11.sp, color: _darkText),
                    ),
                  ),
                  SizedBox(
                    width: 66.w,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        if (isPending)
                          GestureDetector(
                            onTap: id.isEmpty
                                ? null
                                : () => _confirmApprove(id),
                            child: _statusBadge(status),
                          )
                        else
                          _statusBadge(status),
                        SizedBox(height: 6.h),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            InkWell(
                              onTap: id.isEmpty
                                  ? null
                                  : () => Navigator.push(
                                      context,
                                      MaterialPageRoute(
                                        builder: (_) =>
                                            CenterDetails(centerId: id),
                                      ),
                                    ),
                              child: Icon(
                                Icons.visibility_outlined,
                                size: 16.sp,
                                color: _green,
                              ),
                            ),
                            if (isPending) ...[
                              SizedBox(width: 10.w),
                              InkWell(
                                onTap: id.isEmpty
                                    ? null
                                    : () => _confirmReject(id),
                                child: Icon(
                                  Icons.delete_outline_rounded,
                                  size: 16.sp,
                                  color: const Color(0xFFDC2626),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              SizedBox(height: 10.h),
              const Divider(height: 1, color: Color(0xFFF1F5F9)),
              SizedBox(height: 10.h),
              Row(
                children: [
                  Icon(Icons.event_outlined, size: 13.sp, color: _green),
                  SizedBox(width: 5.w),
                  Expanded(
                    child: Text(
                      'Meeting: $meeting',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 10.5.sp, color: _darkText),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 6.h),
              Row(
                children: [
                  Icon(Icons.call_outlined, size: 13.sp, color: _green),
                  SizedBox(width: 5.w),
                  Text(
                    contactNumber,
                    style: TextStyle(fontSize: 10.5.sp, color: _darkText),
                  ),
                  SizedBox(width: 14.w),
                  Icon(Icons.groups_outlined, size: 13.sp, color: _green),
                  SizedBox(width: 5.w),
                  Text(
                    km,
                    style: TextStyle(fontSize: 10.5.sp, color: _darkText),
                  ),
                  const Spacer(),
                  Icon(
                    Icons.calendar_today_outlined,
                    size: 12.sp,
                    color: _green,
                  ),
                  SizedBox(width: 5.w),
                  Text(
                    created,
                    style: TextStyle(fontSize: 10.5.sp, color: _darkText),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusBadge(String status) {
    final isApproved = status == 'APPROVED';
    final isPending = status == 'PENDING_APPROVAL';

    final Color bgColor = isApproved
        ? const Color(0xFFE1F5E7)
        : (isPending ? const Color(0xFFFDEDD3) : const Color(0xFFFEF2F2));
    final Color textColor = isApproved
        ? const Color(0xFF08753A)
        : (isPending ? const Color(0xFFB45309) : const Color(0xFFB91C1C));
    final String label = isApproved
        ? 'Approved'
        : (isPending ? 'Pending Approval' : 'Rejected');

    return Container(
      padding: EdgeInsets.symmetric(horizontal: 7.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Text(
        label,
        textAlign: TextAlign.right,
        style: TextStyle(
          fontSize: 8.5.sp,
          fontWeight: FontWeight.w800,
          color: textColor,
        ),
      ),
    );
  }

  Widget _buildFooterNote() {
    return Column(
      children: [
        const Divider(color: Color(0xFFE1EEE6)),
        SizedBox(height: 10.h),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.shield_outlined, size: 13.sp, color: _muted),
            SizedBox(width: 6.w),
            Text(
              'Secure Center Management System',
              style: TextStyle(fontSize: 11.sp, color: _muted),
            ),
          ],
        ),
      ],
    );
  }

  // Bottom navigation bar
  Widget _buildBottomNav() {
    final items = [
      (Icons.grid_view_rounded, 'Dashboard'),
      (Icons.description_outlined, 'Requests'),
      (Icons.apartment_outlined, 'Centers'),
      (Icons.person_outline_rounded, 'Profile'),
    ];
    return SafeArea(
      top: false,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 8,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        padding: EdgeInsets.symmetric(vertical: 8.h),
        child: Row(
          children: List.generate(items.length, (index) {
            final selected = _navIndex == index;
            final (icon, label) = items[index];
            return Expanded(
              child: GestureDetector(
                onTap: () {
                  setState(() => _navIndex = index);
                  if (index == 0) {
                    Navigator.maybePop(context);
                  } else if (index != 1) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('$label coming soon')),
                    );
                  }
                },
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 20.sp, color: selected ? _green : _muted),
                    SizedBox(height: 3.h),
                    Text(
                      label,
                      style: TextStyle(
                        fontSize: 9.5.sp,
                        fontWeight: selected
                            ? FontWeight.w700
                            : FontWeight.w500,
                        color: selected ? _green : _muted,
                      ),
                    ),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
