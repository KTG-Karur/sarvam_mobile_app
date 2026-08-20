import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_user_controller.dart';

/// Creates a new user via POST /api/users. The form mirrors the web User
/// creation UI: base role + optional RBAC role + branch assignment, with the
/// same server-side validations reproduced locally (10-digit mobile, min-8
/// password, branch required for BM/FDO, ≤4 branches for AM).
class UserCreate extends StatefulWidget {
  const UserCreate({super.key});

  @override
  State<UserCreate> createState() => _UserCreateState();
}

class _UserCreateState extends State<UserCreate> with TickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);
  static const _cardBg = Color(0xFFFFFFFF);

  final _formKey = GlobalKey<FormState>();
  late AdminUserController _controller;

  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _mobile = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();

  String _role = 'FDO';
  String _rbacRoleId = '';
  String? _branchId;
  final List<String> _assignedBranchIds = [];
  String? _primaryBranchId;
  int _currentStep = 0;

  static const List<String> _legacyRoles = [
    'FDO',
    'BRANCH_MANAGER',
    'AREA_MANAGER',
    'ADMIN',
  ];

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
    _controller.loadBranches();
  }

  @override
  void dispose() {
    _firstName.dispose();
    _lastName.dispose();
    _mobile.dispose();
    _email.dispose();
    _password.dispose();
    _confirmPassword.dispose();
    _headerController.dispose();
    _fabController.dispose();
    super.dispose();
  }

  bool get _isAreaManager => _role == 'AREA_MANAGER';
  bool get _isBranchRequired => _role == 'BRANCH_MANAGER' || _role == 'FDO';

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    if (_password.text != _confirmPassword.text) {
      Get.snackbar(
        'Password Mismatch',
        'Password and confirm password do not match.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 12.r,
      );
      return;
    }

    final payload = <String, dynamic>{
      'firstName': _firstName.text.trim(),
      'lastName': _lastName.text.trim(),
      'mobileNumber': _mobile.text.trim(),
      'email': _email.text.trim().isEmpty ? '' : _email.text.trim(),
      'password': _password.text,
      'role': _role,
    };

    if (_rbacRoleId.isNotEmpty) payload['rbacRoleId'] = _rbacRoleId;

    if (_isAreaManager) {
      if (_assignedBranchIds.isNotEmpty) {
        payload['assignedBranchIds'] = _assignedBranchIds;
        if (_primaryBranchId != null) {
          payload['primaryBranchId'] = _primaryBranchId;
        }
      }
    } else {
      if (_branchId != null) payload['branchId'] = _branchId;
    }

    final error = await _controller.createUser(payload);
    if (!mounted) return;
    if (error == null) {
      Get.snackbar(
        'Success ✅',
        'User created successfully',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: _green,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 12.r,
        duration: const Duration(seconds: 2),
        icon: const Icon(Icons.check_circle_rounded, color: Colors.white),
      );
      Navigator.of(context).pop(true);
    } else {
      Get.snackbar(
        'Creation Failed',
        error,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 12.r,
        duration: const Duration(seconds: 3),
        icon: const Icon(Icons.error_outline_rounded, color: Colors.white),
      );
    }
  }

  void _goToStep(int step) {
    setState(() => _currentStep = step);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      body: SlideTransition(
        position: _headerSlideAnimation,
        child: FadeTransition(
          opacity: _headerAnimation,
          child: Obx(
            () => Form(
              key: _formKey,
              child: ListView(
                padding: EdgeInsets.all(16.w),
                physics: const BouncingScrollPhysics(),
                children: [
                  _buildProgressIndicator(),
                  SizedBox(height: 16.h),
                  _buildStepContent(),
                  SizedBox(height: 24.h),
                  _buildActionButtons(),
                  SizedBox(height: 24.h),
                ],
              ),
            ),
          ),
        ),
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
              Icons.person_add_alt_1_rounded,
              color: Colors.white,
              size: 18.sp,
            ),
          ),
          SizedBox(width: 10.w),
          Text(
            'Create User',
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
          onPressed: () => Navigator.pop(context),
          icon: Container(
            padding: EdgeInsets.all(6.w),
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(8.r),
            ),
            child: Icon(Icons.close_rounded, color: _muted, size: 18.sp),
          ),
        ),
      ],
      bottom: PreferredSize(
        preferredSize: Size.fromHeight(1.h),
        child: Container(height: 1.h, color: Colors.grey.shade200),
      ),
    );
  }

  // ============== PROGRESS INDICATOR ==============
  Widget _buildProgressIndicator() {
    final steps = ['Personal', 'Account', 'Branch', 'Password'];

    return Container(
      padding: EdgeInsets.symmetric(vertical: 8.h),
      child: Row(
        children: steps.asMap().entries.map((entry) {
          final index = entry.key;
          final label = entry.value;
          final isActive = index == _currentStep;
          final isCompleted = index < _currentStep;

          return Expanded(
            child: GestureDetector(
              onTap: () => _goToStep(index),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          height: 3.h,
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              colors: isCompleted
                                  ? [_green, _greenLight]
                                  : isActive
                                  ? [
                                      _green.withOpacity(0.5),
                                      _green.withOpacity(0.5),
                                    ]
                                  : [
                                      Colors.grey.shade300,
                                      Colors.grey.shade300,
                                    ],
                            ),
                            borderRadius: BorderRadius.circular(2.r),
                          ),
                        ),
                      ),
                      if (index < steps.length - 1) SizedBox(width: 4.w),
                    ],
                  ),
                  SizedBox(height: 6.h),
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 300),
                    width: 28.w,
                    height: 28.w,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isCompleted
                          ? _green
                          : isActive
                          ? _green.withOpacity(0.15)
                          : Colors.grey.shade200,
                      border: Border.all(
                        color: isCompleted
                            ? _green
                            : isActive
                            ? _green
                            : Colors.grey.shade300,
                        width: isActive ? 2 : 1,
                      ),
                    ),
                    child: isCompleted
                        ? Icon(
                            Icons.check_rounded,
                            color: Colors.white,
                            size: 14.sp,
                          )
                        : Center(
                            child: Text(
                              '${index + 1}',
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                fontWeight: FontWeight.w700,
                                color: isActive ? _green : _muted,
                              ),
                            ),
                          ),
                  ),
                  SizedBox(height: 4.h),
                  Text(
                    label,
                    style: GoogleFonts.inter(
                      fontSize: 9.sp,
                      fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                      color: isActive ? _green : _muted,
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  // ============== STEP CONTENT ==============
  Widget _buildStepContent() {
    switch (_currentStep) {
      case 0:
        return _buildPersonalStep();
      case 1:
        return _buildAccountStep();
      case 2:
        return _buildBranchStep();
      case 3:
        return _buildPasswordStep();
      default:
        return const SizedBox();
    }
  }

  // ============== PERSONAL STEP ==============
  Widget _buildPersonalStep() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: Container(
        key: ValueKey('personal'),
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
            _buildSectionHeader(
              'Personal Details',
              'Enter user personal information',
              Icons.person_outline_rounded,
            ),
            SizedBox(height: 16.h),
            _buildTextField(
              controller: _firstName,
              label: 'First Name',
              icon: Icons.badge_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'First name is required'
                  : null,
            ),
            SizedBox(height: 14.h),
            _buildTextField(
              controller: _lastName,
              label: 'Last Name',
              icon: Icons.badge_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Last name is required'
                  : null,
            ),
            SizedBox(height: 14.h),
            _buildTextField(
              controller: _mobile,
              label: 'Mobile Number',
              icon: Icons.phone_rounded,
              keyboardType: TextInputType.phone,
              maxLength: 10,
              validator: (v) {
                final value = v?.trim() ?? '';
                if (value.isEmpty) return 'Mobile number is required';
                if (!RegExp(r'^\d{10}$').hasMatch(value)) {
                  return 'Mobile number must be 10 digits';
                }
                return null;
              },
            ),
            SizedBox(height: 14.h),
            _buildTextField(
              controller: _email,
              label: 'Email (optional)',
              icon: Icons.email_outlined,
              keyboardType: TextInputType.emailAddress,
              validator: (v) {
                final value = v?.trim() ?? '';
                if (value.isEmpty) return null;
                if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value)) {
                  return 'Enter a valid email address';
                }
                return null;
              },
            ),
          ],
        ),
      ),
    );
  }

  // ============== ACCOUNT STEP ==============
  Widget _buildAccountStep() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: Container(
        key: ValueKey('account'),
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
            _buildSectionHeader(
              'Account Setup',
              'Configure user role and permissions',
              Icons.account_circle_outlined,
            ),
            SizedBox(height: 16.h),
            _buildRolesDropdown(),
            SizedBox(height: 14.h),
            _buildRbacDropdown(),
          ],
        ),
      ),
    );
  }

  // ============== BRANCH STEP ==============
  Widget _buildBranchStep() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: Container(
        key: ValueKey('branch'),
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
            _buildSectionHeader(
              _isAreaManager ? 'Branch Assignment' : 'Branch Selection',
              _isAreaManager
                  ? 'Assign up to 4 branches for area manager'
                  : 'Select a branch for the user',
              Icons.store_outlined,
            ),
            SizedBox(height: 16.h),
            if (_isAreaManager)
              _buildAreaManagerBranches()
            else
              _buildBranchDropdown(),
            if (_isBranchRequired && !_isAreaManager) ...[
              SizedBox(height: 8.h),
              Container(
                padding: EdgeInsets.all(10.w),
                decoration: BoxDecoration(
                  color: Colors.orange.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(8.r),
                  border: Border.all(color: Colors.orange.withOpacity(0.2)),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: Colors.orange,
                      size: 16.sp,
                    ),
                    SizedBox(width: 8.w),
                    Expanded(
                      child: Text(
                        'Branch is required for Branch Manager and FDO roles.',
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          color: Colors.orange,
                          fontWeight: FontWeight.w500,
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

  // ============== PASSWORD STEP ==============
  Widget _buildPasswordStep() {
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      child: Container(
        key: ValueKey('password'),
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
            _buildSectionHeader(
              'Set Password',
              'Create a secure password for the user',
              Icons.lock_outline_rounded,
            ),
            SizedBox(height: 16.h),
            _buildTextField(
              controller: _password,
              label: 'Password',
              icon: Icons.lock_outline,
              obscure: true,
              validator: (v) {
                if (v == null || v.isEmpty) return 'Password is required';
                if (v.length < 8)
                  return 'Password must be at least 8 characters';
                return null;
              },
            ),
            SizedBox(height: 14.h),
            _buildTextField(
              controller: _confirmPassword,
              label: 'Confirm Password',
              icon: Icons.lock_outline,
              obscure: true,
              validator: (v) => (v == null || v.isEmpty)
                  ? 'Please confirm the password'
                  : null,
            ),
            SizedBox(height: 8.h),
            _buildPasswordStrengthIndicator(),
          ],
        ),
      ),
    );
  }

  // ============== PASSWORD STRENGTH INDICATOR ==============
  Widget _buildPasswordStrengthIndicator() {
    final password = _password.text;
    int strength = 0;
    if (password.length >= 8) strength++;
    if (RegExp(r'[A-Z]').hasMatch(password)) strength++;
    if (RegExp(r'[a-z]').hasMatch(password)) strength++;
    if (RegExp(r'[0-9]').hasMatch(password)) strength++;
    if (RegExp(r'[!@#$%^&*(),.?":{}|<>]').hasMatch(password)) strength++;

    if (password.isEmpty) return const SizedBox();

    Color color;
    String label;
    if (strength <= 2) {
      color = Colors.red;
      label = 'Weak';
    } else if (strength <= 3) {
      color = Colors.orange;
      label = 'Fair';
    } else if (strength <= 4) {
      color = Colors.blue;
      label = 'Good';
    } else {
      color = _green;
      label = 'Strong';
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(height: 8.h),
        Row(
          children: [
            Expanded(
              child: LinearProgressIndicator(
                value: strength / 5,
                backgroundColor: Colors.grey.shade200,
                valueColor: AlwaysStoppedAnimation<Color>(color),
                minHeight: 4.h,
                borderRadius: BorderRadius.circular(2.r),
              ),
            ),
            SizedBox(width: 8.w),
            Text(
              label,
              style: GoogleFonts.inter(
                fontSize: 11.sp,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ],
        ),
      ],
    );
  }

  // ============== ACTION BUTTONS ==============
  Widget _buildActionButtons() {
    return Row(
      children: [
        if (_currentStep > 0)
          Expanded(
            flex: 1,
            child: OutlinedButton(
              onPressed: () => _goToStep(_currentStep - 1),
              style: OutlinedButton.styleFrom(
                padding: EdgeInsets.symmetric(vertical: 12.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12.r),
                ),
                side: BorderSide(color: Colors.grey.shade300),
                foregroundColor: _muted,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.arrow_back_rounded, size: 16.sp),
                  SizedBox(width: 4.w),
                  Text(
                    'Back',
                    style: GoogleFonts.inter(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (_currentStep > 0) SizedBox(width: 12.w),
        Expanded(
          flex: _currentStep > 0 ? 2 : 1,
          child: ElevatedButton(
            onPressed: _controller.isSaving.value
                ? null
                : _currentStep == 3
                ? _submit
                : () => _goToStep(_currentStep + 1),
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
            child: _controller.isSaving.value
                ? SizedBox(
                    width: 22.w,
                    height: 22.w,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _currentStep == 3 ? 'Create User' : 'Next',
                        style: GoogleFonts.inter(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (_currentStep != 3) ...[
                        SizedBox(width: 4.w),
                        Icon(Icons.arrow_forward_rounded, size: 16.sp),
                      ],
                    ],
                  ),
          ),
        ),
      ],
    );
  }

  // ============== SECTION HEADER ==============
  Widget _buildSectionHeader(String title, String subtitle, IconData icon) {
    return Row(
      children: [
        Container(
          padding: EdgeInsets.all(8.w),
          decoration: BoxDecoration(
            gradient: LinearGradient(colors: [_green, _greenLight]),
            borderRadius: BorderRadius.circular(8.r),
          ),
          child: Icon(icon, color: Colors.white, size: 16.sp),
        ),
        SizedBox(width: 10.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w700,
                  color: _darkText,
                ),
              ),
              Text(
                subtitle,
                style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ============== TEXT FIELD ==============
  Widget _buildTextField({
    required TextEditingController controller,
    required String label,
    required IconData icon,
    TextInputType? keyboardType,
    bool obscure = false,
    int? maxLength,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscure,
          maxLength: maxLength,
          validator: validator,
          style: GoogleFonts.inter(fontSize: 14.sp, color: _darkText),
          decoration: InputDecoration(
            prefixIcon: Icon(icon, size: 20.sp, color: _muted),
            counterText: '',
            filled: true,
            fillColor: Colors.white,
            contentPadding: EdgeInsets.symmetric(
              horizontal: 14.w,
              vertical: 14.h,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: const BorderSide(color: _green, width: 2),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: BorderSide(color: Colors.red.shade300),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12.r),
              borderSide: BorderSide(color: Colors.red.shade300, width: 2),
            ),
          ),
        ),
      ],
    );
  }

  // ============== ROLES DROPDOWN ==============
  Widget _buildRolesDropdown() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Base Role',
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          initialValue: _role,
          isExpanded: true,
          value: _role,
          decoration: _buildDropdownDecoration(Icons.manage_accounts_outlined),
          items: _legacyRoles
              .map(
                (r) => DropdownMenuItem(
                  value: r,
                  child: Row(
                    children: [
                      Icon(
                        _getRoleIcon(r),
                        color: _getRoleColor(r),
                        size: 16.sp,
                      ),
                      SizedBox(width: 8.w),
                      Text(
                        _roleLabel(r),
                        style: GoogleFonts.inter(
                          fontSize: 13.sp,
                          color: _darkText,
                        ),
                      ),
                    ],
                  ),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _role = v ?? _role),
          dropdownColor: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
        ),
      ],
    );
  }

  // ============== RBAC DROPDOWN ==============
  Widget _buildRbacDropdown() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'RBAC Role (optional)',
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          initialValue: _rbacRoleId.isEmpty ? null : _rbacRoleId,
          isExpanded: true,
          value: _rbacRoleId.isEmpty ? null : _rbacRoleId,
          hint: Text(
            'Select RBAC role',
            style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          ),
          decoration: _buildDropdownDecoration(
            Icons.admin_panel_settings_outlined,
          ),
          items: _controller.roles
              .map(
                (r) => DropdownMenuItem(
                  value: r.id,
                  child: Text(
                    r.name,
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  ),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _rbacRoleId = v ?? ''),
          dropdownColor: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
        ),
      ],
    );
  }

  // ============== BRANCH DROPDOWN ==============
  Widget _buildBranchDropdown() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          _isAreaManager ? 'Primary Branch' : 'Branch',
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          key: const ValueKey('branch'),
          initialValue: _branchId,
          value: _branchId,
          isExpanded: true,
          hint: Text(
            'Select branch',
            style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          ),
          decoration: _buildDropdownDecoration(Icons.store_outlined),
          items: _controller.branches
              .map(
                (b) => DropdownMenuItem(
                  value: '${b['id']}',
                  child: Text(
                    '${b['name']} (${b['code']})',
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  ),
                ),
              )
              .toList(),
          onChanged: (v) => setState(() => _branchId = v),
          dropdownColor: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
        ),
      ],
    );
  }

  // ============== AREA MANAGER BRANCHES ==============
  Widget _buildAreaManagerBranches() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Assigned Branches (max 4)',
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 8.h),
        _buildAreaManagerBranchGrid(),
        SizedBox(height: 12.h),
        Text(
          'Primary Branch',
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          key: ValueKey(_primaryBranchId),
          initialValue: _primaryBranchId,
          value: _primaryBranchId,
          isExpanded: true,
          hint: Text(
            'Select primary branch',
            style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          ),
          decoration: _buildDropdownDecoration(Icons.star_outline_rounded),
          items: _assignedBranchIds.map((bid) {
            final b = _controller.branches.firstWhere(
              (x) => '${x['id']}' == bid,
            );
            return DropdownMenuItem(
              value: bid,
              child: Text(
                '${b['name']}',
                style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
              ),
            );
          }).toList(),
          onChanged: (v) => setState(() => _primaryBranchId = v),
          dropdownColor: Colors.white,
          borderRadius: BorderRadius.circular(12.r),
        ),
        if (_assignedBranchIds.isEmpty) ...[
          SizedBox(height: 8.h),
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: Colors.amber.withOpacity(0.08),
              borderRadius: BorderRadius.circular(8.r),
              border: Border.all(color: Colors.amber.withOpacity(0.2)),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.info_outline_rounded,
                  color: Colors.amber,
                  size: 16.sp,
                ),
                SizedBox(width: 8.w),
                Expanded(
                  child: Text(
                    'Please select at least one branch',
                    style: GoogleFonts.inter(
                      fontSize: 11.sp,
                      color: Colors.amber,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildAreaManagerBranchGrid() {
    final available = _controller.branches.where((b) {
      final id = '${b['id']}';
      return _assignedBranchIds.contains(id) || _assignedBranchIds.length < 4;
    }).toList();

    return Wrap(
      spacing: 8.w,
      runSpacing: 8.h,
      children: available.map((b) {
        final id = '${b['id']}';
        final selected = _assignedBranchIds.contains(id);
        return ChoiceChip(
          label: Text(
            '${b['name']}',
            style: GoogleFonts.inter(
              fontSize: 11.sp,
              fontWeight: FontWeight.w600,
              color: selected ? Colors.white : _muted,
            ),
          ),
          selected: selected,
          selectedColor: _green,
          backgroundColor: Colors.grey.shade100,
          padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20.r),
          ),
          onSelected: (val) {
            setState(() {
              if (val && !selected) {
                if (_assignedBranchIds.length >= 4) {
                  Get.snackbar(
                    'Limit Reached',
                    'Area Manager can be assigned to maximum 4 branches',
                    snackPosition: SnackPosition.BOTTOM,
                    backgroundColor: Colors.orange,
                    colorText: Colors.white,
                    margin: EdgeInsets.all(16.w),
                    borderRadius: 12.r,
                  );
                  return;
                }
                _assignedBranchIds.add(id);
                _primaryBranchId ??= id;
              } else if (!val) {
                _assignedBranchIds.remove(id);
                if (_primaryBranchId == id) {
                  _primaryBranchId = _assignedBranchIds.isNotEmpty
                      ? _assignedBranchIds.first
                      : null;
                }
              }
            });
          },
        );
      }).toList(),
    );
  }

  // ============== DROPDOWN DECORATION ==============
  InputDecoration _buildDropdownDecoration(IconData icon) {
    return InputDecoration(
      prefixIcon: Icon(icon, size: 20.sp, color: _muted),
      filled: true,
      fillColor: Colors.white,
      contentPadding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 14.h),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12.r),
        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12.r),
        borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12.r),
        borderSide: const BorderSide(color: _green, width: 2),
      ),
    );
  }

  // ============== HELPER METHODS ==============
  IconData _getRoleIcon(String role) {
    switch (role) {
      case 'FDO':
        return Icons.person_search_rounded;
      case 'BRANCH_MANAGER':
        return Icons.manage_accounts_rounded;
      case 'AREA_MANAGER':
        return Icons.map_rounded;
      case 'ADMIN':
        return Icons.admin_panel_settings_rounded;
      default:
        return Icons.person_rounded;
    }
  }

  Color _getRoleColor(String role) {
    switch (role) {
      case 'FDO':
        return Colors.blue;
      case 'BRANCH_MANAGER':
        return Colors.orange;
      case 'AREA_MANAGER':
        return Colors.purple;
      case 'ADMIN':
        return _green;
      default:
        return _muted;
    }
  }

  String _roleLabel(String role) {
    switch (role) {
      case 'FDO':
        return 'Field Officer';
      case 'BRANCH_MANAGER':
        return 'Branch Manager';
      case 'AREA_MANAGER':
        return 'Area Manager';
      case 'ADMIN':
        return 'Admin';
      default:
        return role;
    }
  }
}
