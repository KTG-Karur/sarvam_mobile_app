import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/admin/admin_user_controller.dart';

class UserRoles extends StatefulWidget {
  const UserRoles({super.key, required this.user});

  final AdminUser user;

  @override
  State<UserRoles> createState() => _UserRolesState();
}

class _UserRolesState extends State<UserRoles> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  late AdminUserController _controller;
  List<AdminUserRole> _assignments = [];
  String? _selectedRoleId;
  String? _selectedBranchId;
  DateTime? _expiresAt;
  bool _isLoading = false;

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
    _load();
  }

  @override
  void dispose() {
    _fabController.dispose();
    _headerController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    await _controller.loadRbacRoles();
    await _controller.loadBranches();
    final list = await _controller.fetchUserRoles(widget.user.id);
    if (!mounted) return;
    setState(() {
      _assignments = list;
    });
  }

  Future<void> _assign() async {
    if (_selectedRoleId == null) {
      _showErrorSnackbar(
        'Selection Required',
        'Please select a role to assign',
      );
      return;
    }

    setState(() => _isLoading = true);

    final payload = {'roleId': _selectedRoleId};
    if (_selectedBranchId != null) payload['branchId'] = _selectedBranchId;
    if (_expiresAt != null)
      payload['expiresAt'] = _expiresAt!.toIso8601String();

    final err = await _controller.assignRoleToUser(widget.user.id, payload);

    setState(() => _isLoading = false);

    if (!mounted) return;
    if (err == null) {
      _showSuccessSnackbar('Role assigned successfully');
      setState(() {
        _selectedRoleId = null;
        _selectedBranchId = null;
        _expiresAt = null;
      });
      await _load();
    } else {
      _showErrorSnackbar('Assignment Failed', err);
    }
  }

  Future<void> _remove(AdminUserRole r) async {
    final proceed = await Get.dialog<bool>(
      _buildConfirmationDialog(
        title: 'Remove Role',
        content: 'Remove role "${r.role.name}" from ${widget.user.fullName}?',
        confirmText: 'Remove',
        isDanger: true,
      ),
    );
    if (proceed != true || !mounted) return;

    setState(() => _isLoading = true);

    final payload = {'roleId': r.role.id};
    if (r.branch.isNotEmpty) payload['branchId'] = r.branch['id'];
    final err = await _controller.removeRoleFromUser(widget.user.id, payload);

    setState(() => _isLoading = false);

    if (!mounted) return;
    if (err == null) {
      _showSuccessSnackbar('Role removed successfully');
      await _load();
    } else {
      _showErrorSnackbar('Removal Failed', err);
    }
  }

  Future<void> _pickExpiry() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _expiresAt ?? now,
      firstDate: now,
      lastDate: DateTime(now.year + 5),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: Color(0xFF0D6842),
              onPrimary: Colors.white,
              onSurface: Color(0xFF0F172A),
            ),
            textButtonTheme: TextButtonThemeData(
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFF0D6842),
              ),
            ),
          ),
          child: child!,
        );
      },
    );
    if (picked != null) setState(() => _expiresAt = picked);
  }

  void _clearExpiry() {
    setState(() => _expiresAt = null);
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
      body: _buildBody(),
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
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Manage Roles',
                  style: GoogleFonts.inter(
                    fontSize: 16.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  widget.user.fullName,
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        Container(
          margin: EdgeInsets.only(right: 8.w),
          padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
          decoration: BoxDecoration(
            color: _green.withOpacity(0.1),
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Row(
            children: [
              Icon(Icons.assignment_ind_rounded, color: _green, size: 14.sp),
              SizedBox(width: 4.w),
              Text(
                '${_assignments.length}',
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w700,
                  color: _green,
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

  // ============== BODY ==============
  Widget _buildBody() {
    return SafeArea(
      child: SlideTransition(
        position: _headerSlideAnimation,
        child: FadeTransition(
          opacity: _headerAnimation,
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            padding: EdgeInsets.all(16.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // User Info Card
                _buildUserInfoCard(),
                SizedBox(height: 16.h),

                // Assignment Section
                _buildAssignmentSection(),
                SizedBox(height: 24.h),

                // Assigned Roles Section
                _buildAssignedRolesSection(),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ============== USER INFO CARD ==============
  Widget _buildUserInfoCard() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [_green, _greenLight],
        ),
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: _green.withOpacity(0.3),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(12.w),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(14.r),
            ),
            child: Icon(Icons.person_rounded, color: Colors.white, size: 28.sp),
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  widget.user.fullName,
                  style: GoogleFonts.inter(
                    fontSize: 16.sp,
                    fontWeight: FontWeight.w700,
                    color: Colors.white,
                  ),
                ),
                SizedBox(height: 4.h),
                Row(
                  children: [
                    Icon(
                      Icons.phone_rounded,
                      color: Colors.white.withOpacity(0.8),
                      size: 12.sp,
                    ),
                    SizedBox(width: 4.w),
                    Text(
                      widget.user.mobileNumber,
                      style: GoogleFonts.inter(
                        fontSize: 12.sp,
                        color: Colors.white.withOpacity(0.8),
                      ),
                    ),
                    if (widget.user.employeeId.isNotEmpty) ...[
                      SizedBox(width: 12.w),
                      Icon(
                        Icons.badge_rounded,
                        color: Colors.white.withOpacity(0.8),
                        size: 12.sp,
                      ),
                      SizedBox(width: 4.w),
                      Text(
                        widget.user.employeeId,
                        style: GoogleFonts.inter(
                          fontSize: 12.sp,
                          color: Colors.white.withOpacity(0.8),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          Container(
            padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.2),
              borderRadius: BorderRadius.circular(20.r),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 6.w,
                  height: 6.w,
                  decoration: BoxDecoration(
                    color: widget.user.isActive ? Colors.green : Colors.red,
                    shape: BoxShape.circle,
                  ),
                ),
                SizedBox(width: 4.w),
                Text(
                  widget.user.isActive ? 'Active' : 'Inactive',
                  style: GoogleFonts.inter(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ============== ASSIGNMENT SECTION ==============
  Widget _buildAssignmentSection() {
    return Container(
      padding: EdgeInsets.all(16.w),
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
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(8.w),
                decoration: BoxDecoration(
                  color: _green.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Icon(Icons.add_rounded, color: _green, size: 16.sp),
              ),
              SizedBox(width: 10.w),
              Text(
                'Assign New Role',
                style: GoogleFonts.inter(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
            ],
          ),
          SizedBox(height: 16.h),

          // Role Dropdown
          DropdownButtonFormField<String>(
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Select Role',
              labelStyle: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
              prefixIcon: Icon(
                Icons.admin_panel_settings_rounded,
                color: _muted,
                size: 20.sp,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: _green, width: 2),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: BorderSide(color: Colors.grey.shade300),
              ),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12.w,
                vertical: 0,
              ),
            ),
            hint: Text(
              'Choose a role',
              style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
            ),
            value: _selectedRoleId,
            items: _controller.roles
                .map(
                  (r) => DropdownMenuItem(
                    value: r.id,
                    child: Text(
                      r.name,
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        color: _darkText,
                      ),
                    ),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => _selectedRoleId = v),
          ),
          SizedBox(height: 12.h),

          // Branch Dropdown
          DropdownButtonFormField<String>(
            isExpanded: true,
            decoration: InputDecoration(
              labelText: 'Select Branch (Optional)',
              labelStyle: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
              prefixIcon: Icon(
                Icons.storefront_rounded,
                color: _muted,
                size: 20.sp,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: _green, width: 2),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: BorderSide(color: Colors.grey.shade300),
              ),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12.w,
                vertical: 0,
              ),
            ),
            hint: Text(
              'Select branch (optional)',
              style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
            ),
            value: _selectedBranchId,
            items: _controller.branches
                .map(
                  (b) => DropdownMenuItem(
                    value: '${b['id']}',
                    child: Text(
                      '${b['name']}',
                      style: GoogleFonts.inter(
                        fontSize: 13.sp,
                        color: _darkText,
                      ),
                    ),
                  ),
                )
                .toList(),
            onChanged: (v) => setState(() => _selectedBranchId = v),
          ),
          SizedBox(height: 12.h),

          // Expiry and Assign Button
          Row(
            children: [
              Expanded(
                flex: 2,
                child: OutlinedButton.icon(
                  onPressed: _pickExpiry,
                  icon: Icon(Icons.calendar_today_rounded, size: 16.sp),
                  label: Text(
                    _expiresAt == null
                        ? 'Set Expiry'
                        : DateFormat.yMMMd().format(_expiresAt!),
                    style: GoogleFonts.inter(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: EdgeInsets.symmetric(vertical: 12.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    side: BorderSide(
                      color: _expiresAt != null ? _green : Colors.grey.shade300,
                    ),
                    foregroundColor: _expiresAt != null ? _green : _muted,
                  ),
                ),
              ),
              if (_expiresAt != null) ...[
                SizedBox(width: 8.w),
                IconButton(
                  onPressed: _clearExpiry,
                  icon: Icon(
                    Icons.close_rounded,
                    color: Colors.red,
                    size: 20.sp,
                  ),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.red.withOpacity(0.1),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                ),
              ],
              SizedBox(width: 8.w),
              Expanded(
                flex: 1,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _assign,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    foregroundColor: Colors.white,
                    padding: EdgeInsets.symmetric(vertical: 12.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    elevation: 2,
                    disabledBackgroundColor: Colors.grey.shade300,
                  ),
                  child: _isLoading
                      ? SizedBox(
                          width: 20.w,
                          height: 20.w,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : Text(
                          'Assign',
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
    );
  }

  // ============== ASSIGNED ROLES SECTION ==============
  Widget _buildAssignedRolesSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              padding: EdgeInsets.all(8.w),
              decoration: BoxDecoration(
                color: _green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Icon(Icons.list_alt_rounded, color: _green, size: 16.sp),
            ),
            SizedBox(width: 10.w),
            Text(
              'Assigned Roles',
              style: GoogleFonts.inter(
                fontSize: 14.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            const Spacer(),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
              decoration: BoxDecoration(
                color: _green.withOpacity(0.1),
                borderRadius: BorderRadius.circular(20.r),
              ),
              child: Text(
                '${_assignments.length}',
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w700,
                  color: _green,
                ),
              ),
            ),
          ],
        ),
        SizedBox(height: 12.h),
        if (_assignments.isEmpty)
          _buildEmptyState()
        else
          ..._assignments.asMap().entries.map(
            (entry) => _buildAssignmentTile(entry.value, entry.key),
          ),
      ],
    );
  }

  // ============== ASSIGNMENT TILE ==============
  Widget _buildAssignmentTile(AdminUserRole r, int index) {
    final branchText = r.branch.isNotEmpty ? ' • ${r.branch['name']}' : '';
    final expText = r.expiresAt != null
        ? ' • expires ${DateFormat.yMMMd().format(DateTime.parse(r.expiresAt!))}'
        : '';

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
        margin: EdgeInsets.only(bottom: 10.h),
        decoration: BoxDecoration(
          color: _cardBg,
          borderRadius: BorderRadius.circular(14.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(14.r),
          child: InkWell(
            borderRadius: BorderRadius.circular(14.r),
            splashColor: _green.withOpacity(0.08),
            highlightColor: _green.withOpacity(0.04),
            child: Padding(
              padding: EdgeInsets.all(14.w),
              child: Row(
                children: [
                  Container(
                    padding: EdgeInsets.all(10.w),
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: [_green, _greenLight]),
                      borderRadius: BorderRadius.circular(12.r),
                      boxShadow: [
                        BoxShadow(
                          color: _green.withOpacity(0.2),
                          blurRadius: 8,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Icon(
                      Icons.admin_panel_settings_rounded,
                      color: Colors.white,
                      size: 18.sp,
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          r.role.name,
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w700,
                            color: _darkText,
                          ),
                        ),
                        SizedBox(height: 4.h),
                        Row(
                          children: [
                            Icon(Icons.tag_rounded, color: _muted, size: 12.sp),
                            SizedBox(width: 4.w),
                            Text(
                              r.role.slug,
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                color: _muted,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            if (r.branch.isNotEmpty) ...[
                              SizedBox(width: 8.w),
                              Icon(
                                Icons.store_rounded,
                                color: _muted,
                                size: 12.sp,
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                r.branch['name'],
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: _muted,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                            if (r.expiresAt != null) ...[
                              SizedBox(width: 8.w),
                              Icon(
                                Icons.event_rounded,
                                color: _muted,
                                size: 12.sp,
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                DateFormat.yMMMd().format(
                                  DateTime.parse(r.expiresAt!),
                                ),
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: Colors.orange,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          ],
                        ),
                      ],
                    ),
                  ),
                  Container(
                    decoration: BoxDecoration(
                      color: Colors.red.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                    child: IconButton(
                      icon: Icon(
                        Icons.remove_circle_outline_rounded,
                        color: Colors.red,
                        size: 20.sp,
                      ),
                      onPressed: () => _remove(r),
                      tooltip: 'Remove Role',
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

  // ============== EMPTY STATE ==============
  Widget _buildEmptyState() {
    return Container(
      padding: EdgeInsets.all(24.w),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        children: [
          Icon(
            Icons.admin_panel_settings_outlined,
            size: 48.sp,
            color: _muted.withOpacity(0.5),
          ),
          SizedBox(height: 12.h),
          Text(
            'No Roles Assigned',
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w600,
              color: _darkText,
            ),
          ),
          SizedBox(height: 4.h),
          Text(
            'Assign a role to this user to manage permissions',
            style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
            textAlign: TextAlign.center,
          ),
        ],
      ),
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
}
