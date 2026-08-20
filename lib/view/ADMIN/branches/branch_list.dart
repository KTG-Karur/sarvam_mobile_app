import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_user_controller.dart';

/// Branches — lists branches (active + inactive) with their areas.
class BranchList extends StatefulWidget {
  const BranchList({super.key});

  @override
  State<BranchList> createState() => _BranchListState();
}

class _BranchListState extends State<BranchList> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  late AdminUserController _controller;

  // Animation controllers
  late AnimationController _headerController;
  late Animation<double> _headerAnimation;
  late Animation<Offset> _headerSlideAnimation;
  late AnimationController _fabController;
  late Animation<double> _fabAnimation;

  @override
  void initState() {
    super.initState();

    // Initialize header animation
    _headerController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    _headerAnimation = CurvedAnimation(
      parent: _headerController,
      curve: Curves.easeOut,
    );
    _headerSlideAnimation =
        Tween<Offset>(begin: Offset(0, -0.3), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _headerController,
            curve: Curves.easeOutCubic,
          ),
        );
    _headerController.forward();

    // Initialize FAB animation
    _fabController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    _fabAnimation = CurvedAnimation(
      parent: _fabController,
      curve: Curves.easeOutBack,
    );
    _fabController.forward();

    _controller = Get.isRegistered<AdminUserController>()
        ? Get.find<AdminUserController>()
        : Get.put(AdminUserController());
    _controller.loadBranches();
  }

  @override
  void dispose() {
    _headerController.dispose();
    _fabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      floatingActionButton: ScaleTransition(
        scale: _fabAnimation,
        child: FloatingActionButton(
          onPressed: () {
            // Navigate to create branch
            Get.snackbar(
              'Info',
              'Create branch functionality coming soon',
              snackPosition: SnackPosition.BOTTOM,
              backgroundColor: _green,
              colorText: Colors.white,
              margin: EdgeInsets.all(16.w),
              borderRadius: 12.r,
            );
          },
          backgroundColor: _green,
          elevation: 4,
          child: const Icon(Icons.add, color: Colors.white),
        ),
      ),
      body: RefreshIndicator(
        color: _green,
        onRefresh: _controller.loadBranches,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.branches.isEmpty) {
            return _buildLoadingState();
          }
          if (_controller.branches.isEmpty) {
            return _buildEmptyState();
          }
          return SlideTransition(
            position: _headerSlideAnimation,
            child: FadeTransition(
              opacity: _headerAnimation,
              child: ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(
                  parent: BouncingScrollPhysics(),
                ),
                padding: EdgeInsets.all(16.w),
                itemCount: _controller.branches.length,
                separatorBuilder: (_, __) => SizedBox(height: 12.h),
                itemBuilder: (_, i) =>
                    _buildBranchTile(_controller.branches[i], i),
              ),
            ),
          );
        }),
      ),
    );
  }

  // ============== APP BAR ==============
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
                colors: [Color(0xFF0D6842), Color(0xFF1A8A5A)],
              ),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(
              Icons.storefront_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Branches',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
        ],
      ),
      actions: [
        Container(
          margin: EdgeInsets.only(right: 16.w),
          padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
          decoration: BoxDecoration(
            color: _green.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Row(
            children: [
              Icon(Icons.store_rounded, color: _green, size: 14.sp),
              SizedBox(width: 4.w),
              Obx(
                () => AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: Text(
                    '${_controller.branches.length}',
                    key: ValueKey(_controller.branches.length),
                    style: GoogleFonts.inter(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w700,
                      color: _green,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  // ============== BRANCH TILE ==============
  Widget _buildBranchTile(Map<String, dynamic> branch, int index) {
    final areas = branch['areas'] as List? ?? [];
    final isActive = branch['isActive'] ?? true;
    final address = branch['address'] ?? '';
    final code = branch['code'] ?? '';
    final name = branch['name'] ?? 'Unnamed Branch';

    return TweenAnimationBuilder(
      duration: Duration(milliseconds: 300 + (index * 50)),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(30 * (1 - value), 0),
            child: child,
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          color: _cardBg,
          borderRadius: BorderRadius.circular(16.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(16.r),
          child: InkWell(
            borderRadius: BorderRadius.circular(16.r),
            splashColor: _green.withOpacity(0.08),
            highlightColor: _green.withOpacity(0.04),
            onTap: () {
              _showBranchDetails(branch);
            },
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            colors: [
                              isActive ? _green : Colors.grey,
                              isActive ? _greenLight : Colors.grey.shade400,
                            ],
                          ),
                          borderRadius: BorderRadius.circular(12.r),
                          boxShadow: [
                            BoxShadow(
                              color: (isActive ? _green : Colors.grey)
                                  .withOpacity(0.2),
                              blurRadius: 8,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Icon(
                          Icons.storefront_rounded,
                          color: Colors.white,
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
                                    name,
                                    style: GoogleFonts.inter(
                                      fontSize: 15.sp,
                                      fontWeight: FontWeight.w700,
                                      color: _darkText,
                                    ),
                                  ),
                                ),
                                Container(
                                  padding: EdgeInsets.symmetric(
                                    horizontal: 8.w,
                                    vertical: 3.h,
                                  ),
                                  decoration: BoxDecoration(
                                    color: _green.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(6.r),
                                  ),
                                  child: Text(
                                    code,
                                    style: GoogleFonts.inter(
                                      fontSize: 11.sp,
                                      fontWeight: FontWeight.w700,
                                      color: _green,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 4.h),
                            Row(
                              children: [
                                _buildStatusChip(isActive),
                                if (address.isNotEmpty) ...[
                                  SizedBox(width: 8.w),
                                  Container(
                                    padding: EdgeInsets.symmetric(
                                      horizontal: 8.w,
                                      vertical: 2.h,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.blue.withOpacity(0.08),
                                      borderRadius: BorderRadius.circular(20.r),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Icon(
                                          Icons.location_on_rounded,
                                          size: 10.sp,
                                          color: Colors.blue,
                                        ),
                                        SizedBox(width: 4.w),
                                        Text(
                                          'Has Address',
                                          style: GoogleFonts.inter(
                                            fontSize: 9.sp,
                                            color: Colors.blue,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
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
                  if (address.isNotEmpty) ...[
                    SizedBox(height: 8.h),
                    Container(
                      padding: EdgeInsets.all(8.w),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(8.r),
                        border: Border.all(color: Colors.grey.shade200),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.location_on_rounded,
                            size: 14.sp,
                            color: _muted.withOpacity(0.5),
                          ),
                          SizedBox(width: 6.w),
                          Expanded(
                            child: Text(
                              address,
                              style: GoogleFonts.inter(
                                fontSize: 12.sp,
                                color: _muted,
                                height: 1.3,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  if (areas.isNotEmpty) ...[
                    SizedBox(height: 8.h),
                    Wrap(
                      spacing: 6.w,
                      runSpacing: 6.h,
                      children: [
                        ...areas.map(
                          (area) => _buildAreaChip(area['name'] ?? ''),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============== STATUS CHIP ==============
  Widget _buildStatusChip(bool isActive) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
      decoration: BoxDecoration(
        color: isActive ? const Color(0xFFE4F5EB) : const Color(0xFFFEE2E2),
        borderRadius: BorderRadius.circular(20.r),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6.w,
            height: 6.w,
            decoration: BoxDecoration(
              color: isActive ? _green : const Color(0xFFDC2626),
              shape: BoxShape.circle,
            ),
          ),
          SizedBox(width: 4.w),
          Text(
            isActive ? 'Active' : 'Inactive',
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              color: isActive ? _green : const Color(0xFFDC2626),
            ),
          ),
        ],
      ),
    );
  }

  // ============== AREA CHIP ==============
  Widget _buildAreaChip(String areaName) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [_green.withOpacity(0.08), _green.withOpacity(0.04)],
        ),
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(color: _green.withOpacity(0.15)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.location_city_rounded, size: 10.sp, color: _green),
          SizedBox(width: 4.w),
          Text(
            areaName,
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              color: _green,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  // ============== LOADING STATE ==============
  Widget _buildLoadingState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          SizedBox(
            width: 40.w,
            height: 40.w,
            child: CircularProgressIndicator(color: _green, strokeWidth: 3),
          ),
          SizedBox(height: 16.h),
          Text(
            'Loading branches...',
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  // ============== EMPTY STATE ==============
  Widget _buildEmptyState() {
    return SlideTransition(
      position: _headerSlideAnimation,
      child: FadeTransition(
        opacity: _headerAnimation,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(height: 80.h),
            Center(
              child: Column(
                children: [
                  Container(
                    padding: EdgeInsets.all(24.w),
                    decoration: BoxDecoration(
                      color: _green.withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.storefront_outlined,
                      size: 52.sp,
                      color: _muted,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'No Branches Found',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Add branches to manage your organization locations',
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 24.h),
                  ElevatedButton.icon(
                    onPressed: () {
                      Get.snackbar(
                        'Info',
                        'Create branch functionality coming soon',
                        snackPosition: SnackPosition.BOTTOM,
                        backgroundColor: _green,
                        colorText: Colors.white,
                        margin: EdgeInsets.all(16.w),
                        borderRadius: 12.r,
                      );
                    },
                    icon: const Icon(Icons.add_rounded),
                    label: Text(
                      'Add Branch',
                      style: GoogleFonts.inter(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _green,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(
                        horizontal: 24.w,
                        vertical: 12.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12.r),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ============== BRANCH DETAILS DIALOG ==============
  void _showBranchDetails(Map<String, dynamic> branch) {
    final areas = branch['areas'] as List? ?? [];
    final isActive = branch['isActive'] ?? true;
    final address = branch['address'] ?? '';
    final code = branch['code'] ?? '';
    final name = branch['name'] ?? 'Unnamed Branch';
    final contact = branch['contact'] ?? '';
    final email = branch['email'] ?? '';

    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (context) => Dialog(
        elevation: 0,
        backgroundColor: Colors.transparent,
        child: TweenAnimationBuilder(
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOutBack,
          tween: Tween<double>(begin: 0.0, end: 1.0),
          builder: (context, value, child) {
            return Transform.scale(
              scale: value,
              child: Container(
                padding: EdgeInsets.all(24.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20.r),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.15),
                      blurRadius: 30,
                      spreadRadius: 5,
                    ),
                  ],
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: EdgeInsets.all(12.w),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: [
                                isActive ? _green : Colors.grey,
                                isActive ? _greenLight : Colors.grey.shade400,
                              ],
                            ),
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                          child: Icon(
                            Icons.storefront_rounded,
                            color: Colors.white,
                            size: 24.sp,
                          ),
                        ),
                        SizedBox(width: 12.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                style: GoogleFonts.inter(
                                  fontSize: 18.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                              Row(
                                children: [
                                  Container(
                                    padding: EdgeInsets.symmetric(
                                      horizontal: 8.w,
                                      vertical: 2.h,
                                    ),
                                    decoration: BoxDecoration(
                                      color: _green.withOpacity(0.1),
                                      borderRadius: BorderRadius.circular(6.r),
                                    ),
                                    child: Text(
                                      code,
                                      style: GoogleFonts.inter(
                                        fontSize: 12.sp,
                                        color: _green,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                  SizedBox(width: 8.w),
                                  _buildStatusChip(isActive),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 20.h),
                    if (address.isNotEmpty)
                      _buildDetailRow(
                        'Address',
                        address,
                        Icons.location_on_rounded,
                      ),
                    if (contact.isNotEmpty)
                      _buildDetailRow('Contact', contact, Icons.phone_rounded),
                    if (email.isNotEmpty)
                      _buildDetailRow('Email', email, Icons.email_rounded),
                    if (areas.isNotEmpty) ...[
                      SizedBox(height: 12.h),
                      Text(
                        'Service Areas',
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w600,
                          color: _darkText,
                        ),
                      ),
                      SizedBox(height: 8.h),
                      Wrap(
                        spacing: 6.w,
                        runSpacing: 6.h,
                        children: [
                          ...areas.map(
                            (area) => _buildAreaChip(area['name'] ?? ''),
                          ),
                        ],
                      ),
                    ],
                    SizedBox(height: 20.h),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => Navigator.pop(context),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          foregroundColor: Colors.white,
                          padding: EdgeInsets.symmetric(vertical: 12.h),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                        ),
                        child: Text(
                          'Close',
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, IconData icon) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Row(
        children: [
          Icon(icon, size: 16.sp, color: _muted),
          SizedBox(width: 10.w),
          Text(
            '$label:',
            style: GoogleFonts.inter(
              fontSize: 13.sp,
              color: _muted,
              fontWeight: FontWeight.w500,
            ),
          ),
          SizedBox(width: 8.w),
          Expanded(
            child: Text(
              value,
              style: GoogleFonts.inter(
                fontSize: 13.sp,
                color: _darkText,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
