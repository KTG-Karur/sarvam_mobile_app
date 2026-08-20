import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/centre_controller.dart';
import 'package:sarvam/view/FDO/loan_disbursement/center_details.dart';
import 'package:sarvam/view/FDO/loan_disbursement/create_new_center.dart';
import 'package:sarvam/utils/center_formatter.dart';

/// Centers list — the "home" for center management: shows existing centers
/// first, with "Create New Center" reached from here (mirrors the web app's
/// Center Management page), rather than the create form being a dead-end
/// action with no way to see what's already there.
class CenterList extends StatefulWidget {
  const CenterList({super.key});

  @override
  State<CenterList> createState() => _CenterListState();
}

class _CenterListState extends State<CenterList>
    with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _darkGreen = Color(0xFF0B4A2C);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _border = Color(0xFFE1EEE6);
  static const _pageBg = Color(0xFFF2FAF5);

  final CentreController _controller = Get.isRegistered<CentreController>()
      ? Get.find<CentreController>()
      : Get.put(CentreController());

  final TextEditingController _searchCtrl = TextEditingController();
  String _search = '';
  String _statusFilter = 'ALL';
  double _refreshTurns = 0;

  late final AnimationController _pageAnimController;
  late final Animation<double> _pageFade;
  late final Animation<Offset> _pageSlide;

  static const _statusFilters = [
    {'label': 'All Status', 'value': 'ALL'},
    {'label': 'Pending Approval', 'value': 'PENDING_APPROVAL'},
    {'label': 'Approved', 'value': 'APPROVED'},
    {'label': 'Rejected', 'value': 'REJECTED'},
  ];

  @override
  void initState() {
    super.initState();
    _controller.getCenters();
    _searchCtrl.addListener(() {
      setState(() => _search = _searchCtrl.text.trim().toLowerCase());
    });

    _pageAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 450),
    );
    _pageFade = CurvedAnimation(
      parent: _pageAnimController,
      curve: Curves.easeOut,
    );
    _pageSlide = Tween<Offset>(
      begin: const Offset(0, 0.05),
      end: Offset.zero,
    ).animate(_pageFade);
    _pageAnimController.forward();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    _pageAnimController.dispose();
    super.dispose();
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

  String _meetingInfo(Map center) {
    final day = _field(center, 'meetingDay', '');
    final time = _field(center, 'meetingTime', '');
    if (day.isEmpty && time.isEmpty) return '—';
    if (time.isEmpty) return day;
    if (day.isEmpty) return time;
    return '$day  $time';
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
        _field(center, 'contactPerson', ''),
        _field(center, 'contactNumber', ''),
      ].join(' ').toLowerCase();
      return haystack.contains(_search);
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 20.h),
          child: FadeTransition(
            opacity: _pageFade,
            child: SlideTransition(
              position: _pageSlide,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeader(),
                  SizedBox(height: 16.h),
                  _buildSearchAndFilter(),
                  SizedBox(height: 16.h),
                  _buildCentersCard(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Container(
            padding: EdgeInsets.all(8.w),
            decoration: const BoxDecoration(
              color: Colors.white,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.arrow_back_ios_new_rounded,
              size: 17.sp,
              color: _darkText,
            ),
          ),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: Text(
            'Center Management',
            style: TextStyle(
              fontSize: 21.sp,
              fontWeight: FontWeight.w800,
              color: _darkGreen,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
        SizedBox(width: 8.w),
        ElevatedButton.icon(
          onPressed: () async {
            await Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => const CreateNewCenter()));
            if (mounted) _controller.getCenters();
          },
          icon: Icon(Icons.add_rounded, size: 18.sp, color: Colors.white),
          label: Text(
            'Create New Center',
            style: TextStyle(
              fontSize: 13.sp,
              fontWeight: FontWeight.w700,
              color: Colors.white,
            ),
          ),
          style: ElevatedButton.styleFrom(
            backgroundColor: _green,
            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 10.h),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8.r),
            ),
          ),
        ),
      ],
    );
  }

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
              style: TextStyle(fontSize: 14.sp, color: _darkText),
              decoration: InputDecoration(
                isDense: true,
                border: InputBorder.none,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 10.w,
                  vertical: 12.h,
                ),
                hintText: 'Search centers...',
                hintStyle: TextStyle(fontSize: 13.sp, color: _muted),
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: _muted,
                  size: 20.sp,
                ),
              ),
            ),
          ),
        ),
        SizedBox(width: 8.w),
        _buildStatusFilterButton(),
        SizedBox(width: 8.w),
        Obx(
          () => GestureDetector(
            onTap: _controller.isLoading.value
                ? null
                : () {
                    setState(() => _refreshTurns += 1);
                    _controller.getCenters();
                  },
            child: Container(
              padding: EdgeInsets.all(12.w),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8.r),
                border: Border.all(color: _border),
              ),
              child: _controller.isLoading.value
                  ? SizedBox(
                      width: 15.w,
                      height: 15.w,
                      child: const CircularProgressIndicator(
                        color: _green,
                        strokeWidth: 2,
                      ),
                    )
                  : AnimatedRotation(
                      turns: _refreshTurns,
                      duration: const Duration(milliseconds: 450),
                      curve: Curves.easeOut,
                      child: Icon(
                        Icons.refresh_rounded,
                        size: 17.sp,
                        color: _darkText,
                      ),
                    ),
            ),
          ),
        ),
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
              child: Text(f['label']!, style: TextStyle(fontSize: 14.sp)),
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
            Icon(Icons.filter_list_rounded, size: 18.sp, color: _green),
            SizedBox(width: 5.w),
            Text(
              current['label']!,
              style: TextStyle(
                fontSize: 13.5.sp,
                fontWeight: FontWeight.w600,
                color: _darkText,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCentersCard() {
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
        final Widget content;
        if (_controller.isLoading.value && filtered.isEmpty) {
          content = Padding(
            key: const ValueKey('loading'),
            padding: EdgeInsets.symmetric(vertical: 40.h),
            child: const Center(
              child: CircularProgressIndicator(color: _green),
            ),
          );
        } else if (filtered.isEmpty) {
          content = Padding(
            key: const ValueKey('empty'),
            padding: EdgeInsets.symmetric(vertical: 32.h),
            child: Center(
              child: Text(
                'No centers found.',
                style: TextStyle(fontSize: 13.5.sp, color: _muted),
              ),
            ),
          );
        } else {
          content = ListView.separated(
            key: ValueKey('list-$_statusFilter-$_search'),
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: filtered.length,
            separatorBuilder: (_, __) => SizedBox(height: 10.h),
            itemBuilder: (context, index) => _AnimatedListItem(
              index: index,
              child: _buildCenterRow(filtered[index] as Map),
            ),
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${filtered.length} center(s)',
              style: TextStyle(fontSize: 12.5.sp, color: _muted),
            ),
            SizedBox(height: 12.h),
            AnimatedSwitcher(
              duration: const Duration(milliseconds: 300),
              child: content,
            ),
          ],
        );
      }),
    );
  }

  Widget _buildCenterRow(Map center) {
    final id = _centerId(center);
    final code = _field(center, 'code', '');
    final name = _field(center, 'name', 'Unnamed Center');
    final address = _field(center, 'address');
    final status = _field(center, 'status', 'PENDING_APPROVAL');
    final fdo = _fdoName(center);
    final km = center['kmFromBranch'] != null
        ? '${center['kmFromBranch']} KM'
        : '—';
    final contactPerson = _field(center, 'contactPerson');
    final contactNumber = _field(center, 'contactNumber');
    final meeting = _meetingInfo(center);

    return InkWell(
      onTap: id.isEmpty
          ? null
          : () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => CenterDetails(centerId: id)),
            ),
      borderRadius: BorderRadius.circular(10.r),
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
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        formatCenterDisplay(name, code),
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w800,
                          color: _darkText,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        address,
                        style: TextStyle(fontSize: 12.sp, color: _muted),
                      ),
                    ],
                  ),
                ),
                _statusBadge(status),
              ],
            ),
            SizedBox(height: 8.h),
            const Divider(height: 1, color: Color(0xFFF1F5F9)),
            SizedBox(height: 8.h),
            Row(
              children: [
                Icon(Icons.badge_outlined, size: 15.sp, color: _green),
                SizedBox(width: 5.w),
                Expanded(
                  child: Text(
                    'FDO: $fdo',
                    style: TextStyle(fontSize: 12.sp, color: _darkText),
                  ),
                ),
                Icon(Icons.groups_outlined, size: 15.sp, color: _green),
                SizedBox(width: 5.w),
                Text(
                  km,
                  style: TextStyle(fontSize: 12.sp, color: _darkText),
                ),
              ],
            ),
            SizedBox(height: 6.h),
            Row(
              children: [
                Icon(Icons.event_outlined, size: 15.sp, color: _green),
                SizedBox(width: 5.w),
                Expanded(
                  child: Text(
                    'Meeting: $meeting',
                    style: TextStyle(fontSize: 12.sp, color: _darkText),
                  ),
                ),
              ],
            ),
            SizedBox(height: 6.h),
            Row(
              children: [
                Icon(Icons.call_outlined, size: 15.sp, color: _green),
                SizedBox(width: 5.w),
                Expanded(
                  child: Text(
                    '$contactPerson  •  $contactNumber',
                    style: TextStyle(fontSize: 12.sp, color: _darkText),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Icon(Icons.chevron_right_rounded, size: 18.sp, color: _muted),
              ],
            ),
          ],
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
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10.r),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.sp,
          fontWeight: FontWeight.w800,
          color: textColor,
        ),
      ),
    );
  }
}

/// Fades and slides a center row in on first build, staggered by [index]
/// so the list reads as a cascade rather than popping in all at once.
class _AnimatedListItem extends StatefulWidget {
  const _AnimatedListItem({required this.index, required this.child});

  final int index;
  final Widget child;

  @override
  State<_AnimatedListItem> createState() => _AnimatedListItemState();
}

class _AnimatedListItemState extends State<_AnimatedListItem>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 320),
    );
    _fade = CurvedAnimation(parent: _controller, curve: Curves.easeOut);
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.12),
      end: Offset.zero,
    ).animate(_fade);

    final delay = Duration(milliseconds: 40 * widget.index.clamp(0, 10));
    Future.delayed(delay, () {
      if (mounted) _controller.forward();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
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
