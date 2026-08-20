import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_user_controller.dart';
import 'package:sarvam/view/ADMIN/users/user_create.dart';
import 'package:sarvam/view/ADMIN/users/user_roles.dart';

/// User Management — lists users from /api/users with search + role filter,
/// and provides Reset Password and Suspend actions per user.
class UserList extends StatefulWidget {
  const UserList({super.key});

  @override
  State<UserList> createState() => _UserListState();
}

class _UserListState extends State<UserList> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  late AdminUserController _controller;
  final _search = TextEditingController();
  String _query = '';

  // Animation controllers
  late AnimationController _fabController;
  late Animation<double> _fabAnimation;
  late AnimationController _headerController;
  late Animation<double> _headerAnimation;
  late Animation<Offset> _headerSlideAnimation;

  @override
  void initState() {
    super.initState();

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

    _controller = Get.isRegistered<AdminUserController>()
        ? Get.find<AdminUserController>()
        : Get.put(AdminUserController());
    _controller.loadUsers();
  }

  @override
  void dispose() {
    _search.dispose();
    _fabController.dispose();
    _headerController.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    await Future.wait([_controller.loadUsers()]);
  }

  void _openCreate() async {
    final created = await Navigator.of(context).push<bool>(
      PageRouteBuilder(
        pageBuilder: (context, animation, secondaryAnimation) =>
            const UserCreate(),
        transitionsBuilder: (context, animation, secondaryAnimation, child) {
          const begin = Offset(0.3, 0);
          const end = Offset.zero;
          const curve = Curves.easeOutCubic;
          var tween = Tween(
            begin: begin,
            end: end,
          ).chain(CurveTween(curve: curve));
          var offsetAnimation = animation.drive(tween);
          return SlideTransition(
            position: offsetAnimation,
            child: FadeTransition(opacity: animation, child: child),
          );
        },
      ),
    );
    if (created == true) _refresh();
  }

  Future<void> _resetPassword(AdminUser user) async {
    final newPassword = await _showPasswordDialog(user.fullName);
    if (newPassword == null || !mounted) return;
    final error = await _controller.resetPassword(user.id, newPassword);
    if (!mounted) return;
    if (error == null) {
      _showSuccessSnackbar('Password reset for ${user.fullName}');
    } else {
      _showErrorSnackbar('Reset Failed', error);
    }
  }

  Future<void> _suspend(AdminUser user) async {
    final proceed = await Get.dialog<bool>(
      _buildConfirmationDialog(
        title: 'Suspend User',
        content:
            'Set ${user.fullName} (${user.employeeId.isNotEmpty ? user.employeeId : user.mobileNumber}) to inactive?',
        confirmText: 'Suspend',
        isDanger: true,
      ),
    );
    if (proceed != true || !mounted) return;
    final error = await _controller.suspendUser(user);
    if (!mounted) return;
    if (error == null) {
      _showSuccessSnackbar('${user.fullName} suspended');
    } else {
      _showErrorSnackbar('Suspension Failed', error);
    }
  }

  Future<String?> _showPasswordDialog(String userName) {
    final formKey = GlobalKey<FormState>();
    final password = TextEditingController();
    final confirm = TextEditingController();
    return Get.dialog<String>(
      _buildPasswordDialog(
        userName: userName,
        formKey: formKey,
        passwordController: password,
        confirmController: confirm,
      ),
    );
  }

  void _showSuccessSnackbar(String message) {
    Get.snackbar(
      'Success ✅',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: _green,
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 12.r,
      duration: const Duration(seconds: 2),
      icon: const Icon(Icons.check_circle_rounded, color: Colors.white),
    );
  }

  void _showErrorSnackbar(String title, String message) {
    Get.snackbar(
      title,
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFFDC2626),
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 12.r,
      duration: const Duration(seconds: 3),
      icon: const Icon(Icons.error_outline_rounded, color: Colors.white),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      floatingActionButton: ScaleTransition(
        scale: _fabAnimation,
        child: FloatingActionButton(
          onPressed: _openCreate,
          backgroundColor: _green,
          elevation: 4,
          child: const Icon(Icons.add, color: Colors.white),
        ),
      ),
      body: Column(
        children: [
          _buildSearchBar(),
          _buildHeaderStats(),
          Expanded(
            child: RefreshIndicator(
              color: _green,
              onRefresh: _refresh,
              child: Obx(() {
                if (_controller.isLoading.value && _controller.users.isEmpty) {
                  return _buildLoadingState();
                }
                final filtered = _controller.users.where((u) {
                  final q = _query.toLowerCase();
                  if (q.isEmpty) return true;
                  return u.fullName.toLowerCase().contains(q) ||
                      u.mobileNumber.contains(q) ||
                      u.employeeId.toLowerCase().contains(q);
                }).toList();
                if (filtered.isEmpty) {
                  return _buildEmptyState();
                }
                return ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 90.h),
                  itemCount: filtered.length,
                  separatorBuilder: (_, __) => SizedBox(height: 10.h),
                  itemBuilder: (_, i) => _buildUserTile(filtered[i], i),
                );
              }),
            ),
          ),
        ],
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
          Icon(Icons.people_alt_rounded, color: _green, size: 20.sp),
          SizedBox(width: 8.w),
          Text(
            'User Management',
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
          onPressed: _openCreate,
          icon: Container(
            padding: EdgeInsets.all(6.w),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [Color(0xFF0D6842), Color(0xFF1A8A5A)],
              ),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(
              Icons.person_add_alt_1_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          tooltip: 'Create User',
        ),
        SizedBox(width: 4.w),
      ],
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  // ============== SEARCH BAR ==============
  Widget _buildSearchBar() {
    return SlideTransition(
      position: _headerSlideAnimation,
      child: FadeTransition(
        opacity: _headerAnimation,
        child: Padding(
          padding: EdgeInsets.fromLTRB(16.w, 12.h, 16.w, 8.h),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(14.r),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: TextField(
              controller: _search,
              onChanged: (v) => _filter(),
              decoration: InputDecoration(
                hintText: 'Search by name, mobile or employee ID',
                hintStyle: GoogleFonts.inter(
                  fontSize: 13.sp,
                  color: _muted.withOpacity(0.7),
                ),
                prefixIcon: Icon(
                  Icons.search_rounded,
                  color: _muted,
                  size: 20.sp,
                ),
                suffixIcon: _query.isNotEmpty
                    ? IconButton(
                        icon: Icon(
                          Icons.clear_rounded,
                          color: _muted,
                          size: 20.sp,
                        ),
                        onPressed: () {
                          _search.clear();
                          _filter();
                        },
                      )
                    : null,
                filled: true,
                fillColor: Colors.white,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 14.w,
                  vertical: 14.h,
                ),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14.r),
                  borderSide: BorderSide.none,
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14.r),
                  borderSide: BorderSide.none,
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14.r),
                  borderSide: const BorderSide(color: _green, width: 2),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ============== HEADER STATS ==============
  Widget _buildHeaderStats() {
    return SlideTransition(
      position: _headerSlideAnimation,
      child: FadeTransition(
        opacity: _headerAnimation,
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
          child: Row(
            children: [
              Container(
                padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 6.h),
                decoration: BoxDecoration(
                  color: _green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Row(
                  children: [
                    Icon(Icons.people_rounded, color: _green, size: 16.sp),
                    SizedBox(width: 6.w),
                    Text(
                      'Total Users',
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w600,
                        color: _green,
                      ),
                    ),
                  ],
                ),
              ),
              const Spacer(),
              Obx(
                () => AnimatedContainer(
                  duration: const Duration(milliseconds: 300),
                  padding: EdgeInsets.symmetric(
                    horizontal: 12.w,
                    vertical: 6.h,
                  ),
                  decoration: BoxDecoration(
                    color: _green,
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                  child: Text(
                    '${_controller.users.length}',
                    style: GoogleFonts.inter(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ============== USER TILE ==============
  Widget _buildUserTile(AdminUser user, int index) {
    final role = user.rbacRoleName.isNotEmpty ? user.rbacRoleName : user.role;

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
              // Optional: Navigate to user details
            },
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildAvatar(user.fullName, user.isActive),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                user.fullName,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.inter(
                                  fontSize: 14.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkText,
                                ),
                              ),
                            ),
                            _buildStatusChip(user.isActive),
                          ],
                        ),
                        SizedBox(height: 4.h),
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 3.h,
                          ),
                          decoration: BoxDecoration(
                            color: _green.withOpacity(0.08),
                            borderRadius: BorderRadius.circular(6.r),
                          ),
                          child: Text(
                            role,
                            style: GoogleFonts.inter(
                              fontSize: 11.sp,
                              color: _green,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        SizedBox(height: 6.h),
                        Row(
                          children: [
                            if (user.employeeId.isNotEmpty) ...[
                              Icon(
                                Icons.badge_rounded,
                                size: 12.sp,
                                color: _muted,
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                user.employeeId,
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: _muted,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              SizedBox(width: 8.w),
                            ],
                            Icon(
                              Icons.phone_rounded,
                              size: 12.sp,
                              color: _muted,
                            ),
                            SizedBox(width: 4.w),
                            Text(
                              user.mobileNumber,
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                color: _muted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (user.branchName.isNotEmpty) ...[
                              SizedBox(width: 8.w),
                              Icon(
                                Icons.store_rounded,
                                size: 12.sp,
                                color: _muted,
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                user.branchName,
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: _muted,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  // Action Menu
                  PopupMenuButton<String>(
                    onSelected: (v) {
                      if (v == 'reset') _resetPassword(user);
                      if (v == 'suspend') _suspend(user);
                      if (v == 'roles')
                        Navigator.of(context).push(
                          PageRouteBuilder(
                            pageBuilder:
                                (context, animation, secondaryAnimation) =>
                                    UserRoles(user: user),
                            transitionsBuilder:
                                (
                                  context,
                                  animation,
                                  secondaryAnimation,
                                  child,
                                ) {
                                  const begin = Offset(0.3, 0);
                                  const end = Offset.zero;
                                  const curve = Curves.easeOutCubic;
                                  var tween = Tween(
                                    begin: begin,
                                    end: end,
                                  ).chain(CurveTween(curve: curve));
                                  var offsetAnimation = animation.drive(tween);
                                  return SlideTransition(
                                    position: offsetAnimation,
                                    child: FadeTransition(
                                      opacity: animation,
                                      child: child,
                                    ),
                                  );
                                },
                          ),
                        );
                    },
                    offset: const Offset(0, 20),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    itemBuilder: (_) => [
                      PopupMenuItem(
                        value: 'reset',
                        child: Row(
                          children: [
                            Icon(
                              Icons.password_rounded,
                              color: _green,
                              size: 20.sp,
                            ),
                            SizedBox(width: 12.w),
                            Text(
                              'Reset Password',
                              style: GoogleFonts.inter(
                                fontSize: 13.sp,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'roles',
                        child: Row(
                          children: [
                            Icon(
                              Icons.admin_panel_settings_rounded,
                              color: Colors.blue,
                              size: 20.sp,
                            ),
                            SizedBox(width: 12.w),
                            Text(
                              'Manage Roles',
                              style: GoogleFonts.inter(
                                fontSize: 13.sp,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'suspend',
                        child: Row(
                          children: [
                            Icon(
                              Icons.person_off_rounded,
                              color: Colors.red,
                              size: 20.sp,
                            ),
                            SizedBox(width: 12.w),
                            Text(
                              'Suspend',
                              style: GoogleFonts.inter(
                                fontSize: 13.sp,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    child: Container(
                      padding: EdgeInsets.all(6.w),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade50,
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                      child: Icon(
                        Icons.more_vert_rounded,
                        color: _muted,
                        size: 20.sp,
                      ),
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

  // ============== AVATAR ==============
  Widget _buildAvatar(String name, bool isActive) {
    final parts = name.split(' ').where((p) => p.trim().isNotEmpty).toList();
    final initials = parts.isEmpty
        ? 'U'
        : parts.take(2).map((p) => p[0]).join().toUpperCase();

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: 44.w,
      height: 44.w,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isActive
              ? [const Color(0xFF0D6842), const Color(0xFF1A8A5A)]
              : [Colors.grey.shade400, Colors.grey.shade600],
        ),
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: _green.withOpacity(0.2),
            blurRadius: 8,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Text(
        initials,
        style: GoogleFonts.inter(
          fontSize: 16.sp,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
      ),
    );
  }

  // ============== STATUS CHIP ==============
  Widget _buildStatusChip(bool isActive) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
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
            isActive ? 'Active' : 'Suspended',
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
            'Loading users...',
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
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        SizedBox(height: 60.h),
        Center(
          child: Column(
            children: [
              Container(
                padding: EdgeInsets.all(20.w),
                decoration: BoxDecoration(
                  color: _green.withOpacity(0.08),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _query.isNotEmpty
                      ? Icons.search_off_rounded
                      : Icons.people_outline,
                  size: 52.sp,
                  color: _muted,
                ),
              ),
              SizedBox(height: 16.h),
              Text(
                _query.isNotEmpty ? 'No matching users found' : 'No users yet',
                style: GoogleFonts.inter(
                  fontSize: 16.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 8.h),
              Text(
                _query.isNotEmpty
                    ? 'Try adjusting your search terms'
                    : 'Tap the + button to create your first user',
                style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                textAlign: TextAlign.center,
              ),
              if (_query.isNotEmpty) ...[
                SizedBox(height: 16.h),
                TextButton.icon(
                  onPressed: () {
                    _search.clear();
                    _filter();
                  },
                  icon: const Icon(Icons.clear_rounded),
                  label: const Text('Clear Search'),
                  style: TextButton.styleFrom(foregroundColor: _green),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ============== CONFIRMATION DIALOG ==============
  Widget _buildConfirmationDialog({
    required String title,
    required String content,
    required String confirmText,
    bool isDanger = false,
  }) {
    return Dialog(
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
                children: [
                  Container(
                    padding: EdgeInsets.all(16.w),
                    decoration: BoxDecoration(
                      color: isDanger
                          ? const Color(0xFFFEF2F2)
                          : const Color(0xFFE4F5EB),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      isDanger
                          ? Icons.warning_rounded
                          : Icons.info_outline_rounded,
                      size: 36.sp,
                      color: isDanger ? const Color(0xFFDC2626) : _green,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    title,
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    content,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 14.sp,
                      color: _muted,
                      height: 1.4,
                    ),
                  ),
                  SizedBox(height: 24.h),
                  Row(
                    children: [
                      Expanded(
                        child: TextButton(
                          onPressed: () => Navigator.of(context).pop(false),
                          style: TextButton.styleFrom(
                            foregroundColor: _muted,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                              side: BorderSide(color: Colors.grey.shade300),
                            ),
                          ),
                          child: Text(
                            'Cancel',
                            style: GoogleFonts.inter(
                              fontSize: 14.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () => Navigator.of(context).pop(true),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: isDanger
                                ? const Color(0xFFDC2626)
                                : _green,
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                            elevation: 2,
                          ),
                          child: Text(
                            confirmText,
                            style: GoogleFonts.inter(
                              fontSize: 14.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  // ============== PASSWORD DIALOG ==============
  Widget _buildPasswordDialog({
    required String userName,
    required GlobalKey<FormState> formKey,
    required TextEditingController passwordController,
    required TextEditingController confirmController,
  }) {
    return Dialog(
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
                children: [
                  Container(
                    padding: EdgeInsets.all(16.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFE4F5EB),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.password_rounded,
                      size: 36.sp,
                      color: _green,
                    ),
                  ),
                  SizedBox(height: 16.h),
                  Text(
                    'Reset Password',
                    style: GoogleFonts.inter(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Text(
                    'Setting a new password for $userName',
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
                  ),
                  SizedBox(height: 20.h),
                  Form(
                    key: formKey,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        TextFormField(
                          controller: passwordController,
                          obscureText: true,
                          decoration: InputDecoration(
                            labelText: 'New Password',
                            hintText: 'Min 8 characters',
                            prefixIcon: Icon(
                              Icons.lock_outline_rounded,
                              color: _muted,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: _green,
                                width: 2,
                              ),
                            ),
                          ),
                          validator: (v) => (v == null || v.length < 8)
                              ? 'At least 8 characters required'
                              : null,
                        ),
                        SizedBox(height: 14.h),
                        TextFormField(
                          controller: confirmController,
                          obscureText: true,
                          decoration: InputDecoration(
                            labelText: 'Confirm Password',
                            prefixIcon: Icon(
                              Icons.lock_outline_rounded,
                              color: _muted,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: _green,
                                width: 2,
                              ),
                            ),
                          ),
                          validator: (v) => (v != passwordController.text)
                              ? 'Passwords do not match'
                              : null,
                        ),
                      ],
                    ),
                  ),
                  SizedBox(height: 24.h),
                  Row(
                    children: [
                      Expanded(
                        child: TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          style: TextButton.styleFrom(
                            foregroundColor: _muted,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                              side: BorderSide(color: Colors.grey.shade300),
                            ),
                          ),
                          child: Text(
                            'Cancel',
                            style: GoogleFonts.inter(
                              fontSize: 14.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: () {
                            if (formKey.currentState!.validate()) {
                              Navigator.of(
                                context,
                              ).pop(passwordController.text);
                            }
                          },
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _green,
                            foregroundColor: Colors.white,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                            elevation: 2,
                          ),
                          child: Text(
                            'Reset',
                            style: GoogleFonts.inter(
                              fontSize: 14.sp,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  void _filter() => setState(() => _query = _search.text.trim());
}
