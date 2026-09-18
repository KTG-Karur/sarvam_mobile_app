import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_user_controller.dart';

/// Role Manager — lists RBAC roles with their access metadata from
/// /api/admin/roles (module/permission scopes, priority, assignments).
class RoleList extends StatefulWidget {
  const RoleList({super.key});

  @override
  State<RoleList> createState() => _RoleListState();
}

class _RoleListState extends State<RoleList> with TickerProviderStateMixin {
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
    _controller.loadRbacRoles();
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
            // Navigate to create role
            Get.snackbar(
              'Info',
              'Create role functionality coming soon',
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
        onRefresh: _controller.loadRbacRoles,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.roles.isEmpty) {
            return _buildLoadingState();
          }
          if (_controller.roles.isEmpty) {
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
                itemCount: _controller.roles.length,
                separatorBuilder: (_, __) => SizedBox(height: 12.h),
                itemBuilder: (_, i) => _buildRoleTile(_controller.roles[i], i),
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
              Icons.admin_panel_settings_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Role Manager',
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
              Icon(Icons.verified_rounded, color: _green, size: 14.sp),
              SizedBox(width: 4.w),
              Obx(
                () => AnimatedSwitcher(
                  duration: const Duration(milliseconds: 300),
                  child: Text(
                    '${_controller.roles.length}',
                    key: ValueKey(_controller.roles.length),
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

  // ============== ROLE TILE ==============
  Widget _buildRoleTile(AdminRbacRole role, int index) {
    final chipColor = _parseHexColor(role.color);

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
            splashColor: (chipColor ?? _green).withOpacity(0.08),
            highlightColor: (chipColor ?? _green).withOpacity(0.04),
            onTap: () {
              _showRoleDetails(role);
            },
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Color indicator with animation
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: 6.w,
                    height: 60.h,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [
                          chipColor ?? _green,
                          (chipColor ?? _green).withOpacity(0.4),
                        ],
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                      ),
                      borderRadius: BorderRadius.circular(6.r),
                    ),
                  ),
                  SizedBox(width: 14.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                role.name,
                                style: GoogleFonts.inter(
                                  fontSize: 15.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                            ),
                            _buildPriorityBadge(role.priority),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 3.h,
                          ),
                          decoration: BoxDecoration(
                            color: (chipColor ?? _green).withOpacity(0.1),
                            borderRadius: BorderRadius.circular(6.r),
                          ),
                          child: Text(
                            '@${role.slug}',
                            style: GoogleFonts.inter(
                              fontSize: 11.5.sp,
                              color: chipColor ?? _green,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (role.legacyRole.isNotEmpty) ...[
                          SizedBox(height: 4.h),
                          Row(
                            children: [
                              Icon(
                                Icons.code_rounded,
                                size: 12.sp,
                                color: _muted,
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                'Role code: ${role.legacyRole}',
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: _muted,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ),
                        ],
                        if (role.description.isNotEmpty) ...[
                          SizedBox(height: 8.h),
                          Container(
                            padding: EdgeInsets.all(10.w),
                            decoration: BoxDecoration(
                              color: Colors.grey.shade50,
                              borderRadius: BorderRadius.circular(10.r),
                              border: Border.all(color: Colors.grey.shade200),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  Icons.format_quote_rounded,
                                  size: 14.sp,
                                  color: _muted.withOpacity(0.5),
                                ),
                                SizedBox(width: 6.w),
                                Expanded(
                                  child: Text(
                                    role.description,
                                    style: GoogleFonts.inter(
                                      fontSize: 12.sp,
                                      color: _muted,
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                        SizedBox(height: 10.h),
                        Wrap(
                          spacing: 6.w,
                          runSpacing: 6.h,
                          children: [
                            _buildMetaChip(
                              'Priority ${role.priority}',
                              Icons.timeline_rounded,
                              Colors.blue,
                            ),
                            if (role.isSubAdmin)
                              _buildMetaChip(
                                'Sub-Admin',
                                Icons.shield_rounded,
                                Colors.purple,
                              ),
                            _buildMetaChip(
                              '${_getPermissionCount(role)} permissions',
                              Icons.lock_outline_rounded,
                              Colors.green,
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  // Animated arrow
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    padding: EdgeInsets.all(6.w),
                    decoration: BoxDecoration(
                      color: (chipColor ?? _green).withOpacity(0.08),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: chipColor ?? _green,
                      size: 12.sp,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============== PRIORITY BADGE ==============
  Widget _buildPriorityBadge(int priority) {
    Color color;
    String label;

    if (priority >= 90) {
      color = Colors.red;
      label = 'Critical';
    } else if (priority >= 70) {
      color = Colors.orange;
      label = 'High';
    } else if (priority >= 50) {
      color = Colors.blue;
      label = 'Medium';
    } else {
      color = Colors.green;
      label = 'Low';
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 3.h),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(color: color.withOpacity(0.2)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 300),
            width: 6.w,
            height: 6.w,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          SizedBox(width: 4.w),
          Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  // ============== META CHIP ==============
  Widget _buildMetaChip(String text, IconData icon, Color color) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: color.withOpacity(0.08),
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(color: color.withOpacity(0.15)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12.sp, color: color),
          SizedBox(width: 4.w),
          Text(
            text,
            style: GoogleFonts.inter(
              fontSize: 10.5.sp,
              color: color,
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
            'Loading roles...',
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
                      Icons.admin_panel_settings_outlined,
                      size: 52.sp,
                      color: _muted,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'No Roles Found',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Roles help you manage user permissions effectively',
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 24.h),
                  ElevatedButton.icon(
                    onPressed: _controller.loadRbacRoles,
                    icon: AnimatedRotation(
                      duration: const Duration(milliseconds: 500),
                      turns: _controller.isLoading.value ? 1.0 : 0.0,
                      child: const Icon(Icons.refresh_rounded),
                    ),
                    label: Text(
                      'Refresh',
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

  // ============== ROLE DETAILS DIALOG ==============
  void _showRoleDetails(AdminRbacRole role) {
    final chipColor = _parseHexColor(role.color);

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
                          width: 4.w,
                          height: 40.h,
                          decoration: BoxDecoration(
                            color: chipColor ?? _green,
                            borderRadius: BorderRadius.circular(4.r),
                          ),
                        ),
                        SizedBox(width: 12.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                role.name,
                                style: GoogleFonts.inter(
                                  fontSize: 18.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                              Text(
                                '@${role.slug}',
                                style: GoogleFonts.inter(
                                  fontSize: 13.sp,
                                  color: chipColor ?? _green,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                        _buildPriorityBadge(role.priority),
                      ],
                    ),
                    SizedBox(height: 16.h),
                    if (role.description.isNotEmpty) ...[
                      Container(
                        padding: EdgeInsets.all(12.w),
                        decoration: BoxDecoration(
                          color: Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(12.r),
                          border: Border.all(color: Colors.grey.shade200),
                        ),
                        child: Text(
                          role.description,
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            color: _muted,
                            height: 1.5,
                          ),
                        ),
                      ),
                      SizedBox(height: 12.h),
                    ],
                    if (role.legacyRole.isNotEmpty) ...[
                      Row(
                        children: [
                          Icon(Icons.code_rounded, size: 16.sp, color: _muted),
                          SizedBox(width: 8.w),
                          Text(
                            'Role Code: ${role.legacyRole}',
                            style: GoogleFonts.inter(
                              fontSize: 13.sp,
                              color: _muted,
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 8.h),
                    ],
                    Row(
                      children: [
                        Icon(
                          Icons.timeline_rounded,
                          size: 16.sp,
                          color: _muted,
                        ),
                        SizedBox(width: 8.w),
                        Text(
                          'Priority: ${role.priority}',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            color: _muted,
                          ),
                        ),
                        SizedBox(width: 16.w),
                        Icon(Icons.shield_rounded, size: 16.sp, color: _muted),
                        SizedBox(width: 8.w),
                        Text(
                          role.isSubAdmin ? 'Sub-Admin' : 'Standard',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            color: _muted,
                          ),
                        ),
                      ],
                    ),
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

  // ============== HELPER METHODS ==============
  int _getPermissionCount(AdminRbacRole role) {
    // This is a placeholder - adjust based on your actual data structure
    return role.permissions?.length ?? 0;
  }

  bool _isHex(String value) {
    final v = value.replaceFirst('#', '');
    if (v.length != 6 && v.length != 3) return false;
    return RegExp(r'^[0-9a-fA-F]+$').hasMatch(v);
  }

  Color? _parseHexColor(String value) {
    if (value.isEmpty || !_isHex(value)) return null;
    var hex = value.replaceFirst('#', '');
    if (hex.length == 3) {
      hex = hex.split('').map((c) => '$c$c').join();
    }
    return Color(int.parse('FF$hex', radix: 16));
  }
}
