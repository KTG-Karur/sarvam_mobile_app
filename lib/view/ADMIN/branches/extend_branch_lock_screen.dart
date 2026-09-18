import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_hub_controller.dart';

class ExtendBranchLockScreen extends StatefulWidget {
  const ExtendBranchLockScreen({super.key});

  @override
  State<ExtendBranchLockScreen> createState() => _ExtendBranchLockScreenState();
}

class _ExtendBranchLockScreenState extends State<ExtendBranchLockScreen> {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  late AdminHubController _controller;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _controller = Get.isRegistered<AdminHubController>()
        ? Get.find<AdminHubController>()
        : Get.put(AdminHubController());

    _controller.loadBranchLocks();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      body: Column(
        children: [
          _buildMetricCards(),
          _buildSearchHeader(),
          Expanded(child: _buildBranchLockList()),
        ],
      ),
    );
  }

  Widget _buildMetricCards() {
    return Obx(() {
      final total = _controller.branchLocks.length;
      final active = _controller.branchLocks.where((l) => l.writableNow).length;
      final locked = total - active;

      return Padding(
        padding: EdgeInsets.fromLTRB(16.w, 16.w, 16.w, 0),
        child: Row(
          children: [
            Expanded(
              child: _buildMetricItem(
                label: 'TOTAL BRANCHES',
                value: '$total',
                icon: Icons.storefront_rounded,
                iconBg: _green,
                iconColor: Colors.white,
              ),
            ),
            SizedBox(width: 8.w),
            Expanded(
              child: _buildMetricItem(
                label: 'ACTIVE (OPEN)',
                value: '$active',
                icon: Icons.lock_open_rounded,
                iconBg: const Color(0xFFECFDF5),
                iconColor: const Color(0xFF047857),
              ),
            ),
            SizedBox(width: 8.w),
            Expanded(
              child: _buildMetricItem(
                label: 'LOCKED',
                value: '$locked',
                icon: Icons.lock_rounded,
                iconBg: Colors.amber.shade50,
                iconColor: Colors.amber.shade800,
              ),
            ),
          ],
        ),
      );
    });
  }

  Widget _buildMetricItem({
    required String label,
    required String value,
    required IconData icon,
    required Color iconBg,
    required Color iconColor,
  }) {
    return Container(
      padding: EdgeInsets.all(12.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: _green.withValues(alpha: 0.15)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: GoogleFonts.inter(
                    fontSize: 9.sp,
                    fontWeight: FontWeight.w800,
                    color: _muted,
                    letterSpacing: 0.5,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                SizedBox(height: 4.h),
                Text(
                  value,
                  style: GoogleFonts.inter(
                    fontSize: 18.sp,
                    fontWeight: FontWeight.w800,
                    color: _darkText,
                  ),
                ),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: iconColor, size: 18.sp),
          ),
        ],
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: _darkText,
      elevation: 0,
      title: Row(
        children: [
          Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [_green, _greenLight],
              ),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(
              Icons.lock_clock_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Extend Branch Lock',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          onPressed: () => _controller.loadBranchLocks(),
          icon: Icon(Icons.refresh_rounded, color: _green, size: 22.sp),
          tooltip: 'Refresh',
        ),
      ],
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.all(16.w),
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _searchQuery = val.trim().toLowerCase()),
        decoration: InputDecoration(
          hintText: 'Search branch by name or code...',
          hintStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          prefixIcon: const Icon(Icons.search, color: _muted),
          contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10.r),
            borderSide: BorderSide(color: Colors.grey.shade300),
          ),
        ),
      ),
    );
  }

  Widget _buildBranchLockList() {
    return RefreshIndicator(
      onRefresh: () async => _controller.loadBranchLocks(),
      color: _green,
      child: Obx(() {
        if (_controller.isLoading.value && _controller.branchLocks.isEmpty) {
          return const Center(child: CircularProgressIndicator(color: _green));
        }
        if (_controller.branchLocks.isEmpty) {
          return _buildEmptyState('No Branch Lock Records', 'No active branch lock records found in registry.');
        }

        final filtered = _controller.branchLocks.where((l) {
          if (_searchQuery.isEmpty) return true;
          return l.branchName.toLowerCase().contains(_searchQuery) ||
              l.branchCode.toLowerCase().contains(_searchQuery);
        }).toList();

        if (filtered.isEmpty) {
          return _buildEmptyState('No Matches Found', 'No branch locks match your search term.');
        }

        return ListView.separated(
          padding: EdgeInsets.all(16.w),
          itemCount: filtered.length,
          separatorBuilder: (_, __) => SizedBox(height: 12.h),
          itemBuilder: (context, index) {
            final lock = filtered[index];
            return _buildBranchLockCard(lock);
          },
        );
      }),
    );
  }

  Widget _buildBranchLockCard(BranchLockModel lock) {
    final isWritable = lock.writableNow;
    final isExtended = lock.isManuallyExtended;

    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: isWritable
                      ? const Color(0xFFECFDF5)
                      : Colors.amber.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10.r),
                ),
                child: Icon(
                  isWritable ? Icons.lock_open_rounded : Icons.lock_rounded,
                  color: isWritable ? const Color(0xFF047857) : Colors.amber.shade800,
                  size: 22.sp,
                ),
              ),
              SizedBox(width: 12.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${lock.branchCode}  ${lock.branchName}',
                      style: GoogleFonts.inter(
                        fontSize: 15.sp,
                        fontWeight: FontWeight.w700,
                        color: _darkText,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      'Code: ${lock.branchCode}',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w600,
                        color: _muted,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 8.w),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                decoration: BoxDecoration(
                  color: isWritable ? const Color(0xFFECFDF5) : Colors.amber.shade50,
                  borderRadius: BorderRadius.circular(20.r),
                  border: Border.all(
                    color: isWritable ? const Color(0xFFA7F3D0) : Colors.amber.shade300,
                  ),
                ),
                child: Text(
                  isWritable ? 'Writable' : 'Locked',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: isWritable ? const Color(0xFF047857) : Colors.amber.shade900,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 12.h),
          Divider(color: Colors.grey.shade100, height: 1),
          SizedBox(height: 12.h),
          Row(
            children: [
              Expanded(
                child: _buildDetailItem(
                  'Working Date',
                  _formatDate(lock.currentWorkingDate),
                  Icons.calendar_today_rounded,
                ),
              ),
              Expanded(
                child: _buildDetailItem(
                  'Effective Lock Time',
                  _formatTime(lock.effectiveWindowEndAt),
                  Icons.schedule_rounded,
                ),
              ),
            ],
          ),
          if (isExtended) ...[
            SizedBox(height: 10.h),
            Container(
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(8.r),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(Icons.stars_rounded, color: Colors.blue.shade700, size: 14.sp),
                      SizedBox(width: 4.w),
                      Text(
                        'Manually Extended',
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.w700,
                          color: Colors.blue.shade900,
                        ),
                      ),
                    ],
                  ),
                  if (lock.manualOverrideReason != null && lock.manualOverrideReason!.isNotEmpty) ...[
                    SizedBox(height: 2.h),
                    Text(
                      'Reason: ${lock.manualOverrideReason}',
                      style: GoogleFonts.inter(
                        fontSize: 11.sp,
                        color: Colors.blue.shade800,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          SizedBox(height: 14.h),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _showExtendLockBottomSheet(lock),
              style: OutlinedButton.styleFrom(
                foregroundColor: _green,
                side: const BorderSide(color: _green),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
                padding: EdgeInsets.symmetric(vertical: 10.h),
              ),
              icon: const Icon(Icons.more_time_rounded),
              label: Text(
                'Extend Lock Time',
                style: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 13.sp),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailItem(String label, String value, IconData icon) {
    return Row(
      children: [
        Icon(icon, size: 16.sp, color: _muted),
        SizedBox(width: 6.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: GoogleFonts.inter(fontSize: 10.sp, color: _muted),
              ),
              Text(
                value,
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showExtendLockBottomSheet(BranchLockModel lock) {
    DateTime selectedDate = DateTime.now().add(const Duration(days: 1));
    TimeOfDay selectedTime = const TimeOfDay(hour: 18, minute: 30);
    final reasonCtrl = TextEditingController();

    Get.bottomSheet(
      StatefulBuilder(
        builder: (context, setModalState) {
          return Container(
            padding: EdgeInsets.all(20.w),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Extend Branch Lock',
                        style: GoogleFonts.inter(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                      IconButton(
                        onPressed: () => Get.back(),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  Text(
                    '${lock.branchCode} - ${lock.branchName}',
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _green, fontWeight: FontWeight.w600),
                  ),
                  SizedBox(height: 16.h),
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Override Date',
                              style: GoogleFonts.inter(fontSize: 12.sp, fontWeight: FontWeight.w600, color: _muted),
                            ),
                            SizedBox(height: 6.h),
                            InkWell(
                              onTap: () async {
                                final d = await showDatePicker(
                                  context: context,
                                  initialDate: selectedDate,
                                  firstDate: DateTime.now(),
                                  lastDate: DateTime.now().add(const Duration(days: 30)),
                                );
                                if (d != null) {
                                  setModalState(() => selectedDate = d);
                                }
                              },
                              child: Container(
                                padding: EdgeInsets.all(12.w),
                                decoration: BoxDecoration(
                                  border: Border.all(color: Colors.grey.shade300),
                                  borderRadius: BorderRadius.circular(8.r),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(Icons.calendar_today, size: 16, color: _green),
                                    SizedBox(width: 8.w),
                                    Text(
                                      '${selectedDate.day}/${selectedDate.month}/${selectedDate.year}',
                                      style: GoogleFonts.inter(fontSize: 13.sp, fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Override Time',
                              style: GoogleFonts.inter(fontSize: 12.sp, fontWeight: FontWeight.w600, color: _muted),
                            ),
                            SizedBox(height: 6.h),
                            InkWell(
                              onTap: () async {
                                final t = await showTimePicker(
                                  context: context,
                                  initialTime: selectedTime,
                                );
                                if (t != null) {
                                  setModalState(() => selectedTime = t);
                                }
                              },
                              child: Container(
                                padding: EdgeInsets.all(12.w),
                                decoration: BoxDecoration(
                                  border: Border.all(color: Colors.grey.shade300),
                                  borderRadius: BorderRadius.circular(8.r),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(Icons.access_time, size: 16, color: _green),
                                    SizedBox(width: 8.w),
                                    Text(
                                      selectedTime.format(context),
                                      style: GoogleFonts.inter(fontSize: 13.sp, fontWeight: FontWeight.w600),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 14.h),
                  TextField(
                    controller: reasonCtrl,
                    maxLines: 2,
                    decoration: InputDecoration(
                      labelText: 'Override Reason (Optional)',
                      hintText: 'e.g. Extended working hours for EOD verification',
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10.r)),
                    ),
                  ),
                  SizedBox(height: 20.h),
                  Obx(
                    () => ElevatedButton(
                      onPressed: _controller.isSaving.value
                          ? null
                          : () async {
                              final dt = DateTime(
                                selectedDate.year,
                                selectedDate.month,
                                selectedDate.day,
                                selectedTime.hour,
                                selectedTime.minute,
                              );
                              final isoString = dt.toUtc().toIso8601String();
                              await _controller.extendBranchLock(
                                lock.branchId,
                                isoString,
                                reasonCtrl.text.trim(),
                              );
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _green,
                        minimumSize: Size.fromHeight(46.h),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                      ),
                      child: _controller.isSaving.value
                          ? SizedBox(
                              width: 20.w,
                              height: 20.w,
                              child: const CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                            )
                          : Text(
                              'Confirm Extension',
                              style: GoogleFonts.inter(fontSize: 14.sp, fontWeight: FontWeight.w700, color: Colors.white),
                            ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
      isScrollControlled: true,
    );
  }

  String _formatDate(String dateStr) {
    if (dateStr.isEmpty) return 'N/A';
    final dt = DateTime.tryParse(dateStr);
    if (dt == null) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final day = dt.day.toString().padLeft(2, '0');
    final month = months[dt.month - 1];
    return '$day $month ${dt.year}';
  }

  String _formatTime(String dateStr) {
    if (dateStr.isEmpty) return 'N/A';
    final dt = DateTime.tryParse(dateStr);
    if (dt == null) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final day = dt.day.toString().padLeft(2, '0');
    final month = months[dt.month - 1];
    final hr = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final min = dt.minute.toString().padLeft(2, '0');
    final ampm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$day $month ${dt.year} $hr:$min $ampm';
  }

  Widget _buildEmptyState(String title, String desc) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(32.w),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.lock_clock_outlined, size: 56.sp, color: Colors.grey.shade400),
            SizedBox(height: 16.h),
            Text(
              title,
              style: GoogleFonts.inter(
                fontSize: 16.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            SizedBox(height: 6.h),
            Text(
              desc,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                color: _muted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
