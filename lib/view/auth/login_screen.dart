import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/constant/companies.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/set_mpin_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';
import 'package:sarvam/view/FDO/home/home.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  Future<bool> _showConfirmExitDialog() async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        backgroundColor: Colors.white,
        title: Row(
          children: [
            Container(
              padding: EdgeInsets.all(8.w),
              decoration: const BoxDecoration(
                color: Color(0xFFE8F5E9),
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.exit_to_app_rounded, color: const Color(0xFF0D6842), size: 22.sp),
            ),
            SizedBox(width: 10.w),
            Text(
              'Exit Application?',
              style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.bold, color: const Color(0xFF0F172A)),
            ),
          ],
        ),
        content: Text(
          'Are you sure you want to exit Sarvam application?',
          style: TextStyle(fontSize: 14.sp, color: const Color(0xFF475569)),
        ),
        actions: [
          OutlinedButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Color(0xFFCBD5E1)),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            child: Text('Cancel', style: TextStyle(color: const Color(0xFF475569), fontWeight: FontWeight.bold, fontSize: 13.5.sp)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0D6842),
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
            ),
            child: Text('Exit App', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13.5.sp)),
          ),
        ],
      ),
    );
    return result ?? false;
  }
  final AuthController _authController = Get.put(AuthController());
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _employeeIdController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isPasswordVisible = false;
  bool _rememberMe = false;
  // The company being signed in to. Starts on the default (Sarvam); replaced by
  // the last company chosen, if one was saved.
  String _company = Companies.defaultName;

  @override
  void initState() {
    super.initState();
    // Until the saved choice is read, talk to the default company's server.
    Api.setBaseUrl(Companies.defaultUrl);
    _loadSavedCredentials();
    _loadCompany();
  }

  /// Shows the last company chosen. Logging out keeps it, so the next person
  /// signing in on this phone starts on the same company.
  Future<void> _loadCompany() async {
    final prefs = await SharedPreferences.getInstance();
    final name = Companies.nameForUrl(prefs.getString('selected_company_url'));
    Api.setBaseUrl(Companies.urlFor(name));
    if (mounted) setState(() => _company = name);
  }

  /// Switches the company straight away: every call from here on (login, OTP,
  /// forgot MPIN…) goes to its server, and the choice is remembered — also by
  /// the background tracking service, which reads the saved address.
  Future<void> _selectCompany(String name) async {
    final url = Companies.urlFor(name);
    Api.setBaseUrl(url);
    setState(() => _company = name);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_company', name);
    await prefs.setString('selected_company_url', url);
  }

  Future<void> _loadSavedCredentials() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final bool rememberMe = prefs.getBool('rememberMe') ?? false;
      if (rememberMe) {
        final String? savedEmployeeId = prefs.getString('savedEmployeeId');
        if (savedEmployeeId != null && savedEmployeeId.isNotEmpty) {
          setState(() {
            _employeeIdController.text = savedEmployeeId;
            _rememberMe = true;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading saved credentials: $e');
    }
  }

  @override
  void dispose() {
    _employeeIdController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (!_formKey.currentState!.validate()) {
      Get.snackbar(
        'Required Fields Missing',
        'Please enter all required fields.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }

    final String empId = _employeeIdController.text.trim();
    final String password = _passwordController.text.trim();

    final String deviceId = await _authController.getOrCreateDeviceId();

    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('lastLoginId', empId);
    if (_rememberMe) {
      await prefs.setBool('rememberMe', true);
      await prefs.setString('savedEmployeeId', empId);
    } else {
      await prefs.setBool('rememberMe', false);
      await prefs.remove('savedEmployeeId');
    }

    final bool success = await _authController.login(
      employeeId: empId,
      password: password,
      deviceId: deviceId,
    );

    if (!success || !mounted) return;

    debugPrint('Employee ID from Shared Pref: ${prefs.getString('employeeId')}');

    if (prefs.getBool('directLogin') ?? false) {
      Get.offAll(() => const Home());
      return;
    }

    final isMpinSet = prefs.getBool('isMpinSet') ?? false;
    if (!isMpinSet) {
      Get.off(() => const SetMpinScreen());
      return;
    }

    final canChangeForgottenMpin = await _authController.canChangeForgottenMpin();
    if (!mounted) return;
    Get.off(() => canChangeForgottenMpin
        ? const SetMpinScreen(isReset: true)
        : const MpinLoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final confirm = await _showConfirmExitDialog();
        if (confirm && mounted) {
          SystemNavigator.pop();
        }
      },
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Stack(
        children: [
          // Subtle background wave effect at the bottom
          Positioned.fill(child: CustomPaint(painter: WavePainter())),
          SafeArea(
            child: GestureDetector(
              onTap: () => FocusScope.of(context).unfocus(),
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                physics: const ClampingScrollPhysics(),
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 28.w),
                  child: Form(
                    key: _formKey,
                    // Not set on the form itself: a form-wide "on user
                    // interaction" checks EVERY field as soon as one is
                    // touched (typing in Employee ID would flag Password as
                    // required). Each field below checks only itself instead;
                    // tapping Login checks them all.
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(height: 50.h),

                        Center(
                          child: Image.asset(
                            Companies.logoFor(_company),
                            height: 75.h,
                            fit: BoxFit.contain,
                          ),
                        ),
                        SizedBox(height: 16.h),

                        // Welcome Back Text
                        Center(
                          child: Text(
                            'WELCOME BACK!',
                            style: TextStyle(
                              fontSize: 28.sp,
                              fontWeight: FontWeight.w800,
                              color: const Color(0xFF0F172A),
                              letterSpacing: 0.5,
                            ),
                          ),
                        ),

                        SizedBox(height: 6.h),

                        // Instructions Subtext
                        Center(
                          child: Text(
                            'Sign in to continue',
                            style: TextStyle(
                              fontSize: 15.sp,
                              color: const Color(0xFF64748B),
                            ),
                          ),
                        ),

                        SizedBox(height: 36.h),

                        // Company
                        Text(
                          'COMPANY',
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),

                        SizedBox(height: 8.h),

                        // A plain dropdown, not a form field: a form field here
                        // would count as "the user touched the form", and the
                        // form would immediately validate Employee ID and
                        // Password as required. Those errors should appear
                        // only when Login is tapped.
                        InputDecorator(
                          decoration: InputDecoration(
                            prefixIcon: Icon(
                              Icons.business_outlined,
                              color: const Color(0xFF64748B),
                              size: 20.sp,
                            ),
                            filled: true,
                            fillColor: const Color(0xFFF8F9FA),
                            contentPadding: EdgeInsets.symmetric(
                              vertical: 4.h,
                              horizontal: 16.w,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                          ),
                          child: DropdownButtonHideUnderline(
                            child: DropdownButton<String>(
                              value: _company,
                              isExpanded: true,
                              borderRadius: BorderRadius.circular(12.r),
                              style: TextStyle(
                                fontSize: 15.sp,
                                color: const Color(0xFF0F172A),
                              ),
                              icon: const Icon(
                                Icons.keyboard_arrow_down_rounded,
                                color: Color(0xFF0D6842),
                              ),
                              items: Companies.names
                                  .map(
                                    (name) => DropdownMenuItem<String>(
                                      value: name,
                                      child: Text(name),
                                    ),
                                  )
                                  .toList(),
                              onChanged: (name) {
                                if (name != null && name != _company) {
                                  _selectCompany(name);
                                }
                              },
                            ),
                          ),
                        ),

                        SizedBox(height: 24.h),

                        // Employee ID Field Label
                        Text(
                          'EMPLOYEE ID',
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),

                        SizedBox(height: 8.h),

                        // Employee ID Input Field
                        TextFormField(
                          controller: _employeeIdController,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          style: TextStyle(fontSize: 15.sp),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Employee ID is required';
                            }
                            return null;
                          },
                          decoration: InputDecoration(
                            prefixIcon: Icon(
                              Icons.badge_outlined,
                              color: const Color(0xFF64748B),
                              size: 20.sp,
                            ),
                            hintText: 'Enter your Employee ID',
                            hintStyle: TextStyle(
                              color: const Color(0xFF94A3B8),
                              fontSize: 14.sp,
                            ),
                            filled: true,
                            fillColor: const Color(0xFFF8F9FA),
                            contentPadding: EdgeInsets.symmetric(
                              vertical: 16.h,
                              horizontal: 16.w,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFF0D6842),
                                width: 1.5,
                              ),
                            ),
                            errorBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Colors.redAccent,
                                width: 1.5,
                              ),
                            ),
                            focusedErrorBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Colors.redAccent,
                                width: 1.5,
                              ),
                            ),
                          ),
                        ),

                        SizedBox(height: 24.h),

                        // Password Field Label
                        Text(
                          'PASSWORD',
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF64748B),
                            letterSpacing: 0.5,
                          ),
                        ),

                        SizedBox(height: 8.h),

                        // Password Input Field
                        TextFormField(
                          controller: _passwordController,
                          autovalidateMode: AutovalidateMode.onUserInteraction,
                          obscureText: !_isPasswordVisible,
                          style: TextStyle(fontSize: 15.sp),
                          validator: (value) {
                            if (value == null || value.trim().isEmpty) {
                              return 'Password is required';
                            }
                            return null;
                          },
                          decoration: InputDecoration(
                            prefixIcon: Icon(
                              Icons.lock_outline,
                              color: const Color(0xFF64748B),
                              size: 20.sp,
                            ),
                            suffixIcon: IconButton(
                              icon: Icon(
                                _isPasswordVisible
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                                color: const Color(0xFF0D6842),
                                size: 20.sp,
                              ),
                              onPressed: () {
                                setState(() {
                                  _isPasswordVisible = !_isPasswordVisible;
                                });
                              },
                            ),
                            hintText: 'Enter your password',
                            hintStyle: TextStyle(
                              color: const Color(0xFF94A3B8),
                              fontSize: 14.sp,
                            ),
                            filled: true,
                            fillColor: const Color(0xFFF8F9FA),
                            contentPadding: EdgeInsets.symmetric(
                              vertical: 16.h,
                              horizontal: 16.w,
                            ),
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            enabledBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFFE2E8F0),
                              ),
                            ),
                            focusedBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Color(0xFF0D6842),
                                width: 1.5,
                              ),
                            ),
                            errorBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Colors.redAccent,
                                width: 1.5,
                              ),
                            ),
                            focusedErrorBorder: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(12.r),
                              borderSide: const BorderSide(
                                color: Colors.redAccent,
                                width: 1.5,
                              ),
                            ),
                          ),
                        ),

                      SizedBox(height: 16.h),

                      // Remember Me Checkbox Row
                      Row(
                        children: [
                          SizedBox(
                            height: 24.w,
                            width: 24.w,
                            child: Checkbox(
                              value: _rememberMe,
                              activeColor: const Color(0xFF0D6842),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(4.r),
                              ),
                              side: const BorderSide(
                                color: Color(0xFFCBD5E1),
                                width: 1.5,
                              ),
                              onChanged: (value) {
                                setState(() {
                                  _rememberMe = value ?? false;
                                });
                              },
                            ),
                          ),
                          SizedBox(width: 8.w),
                          Text(
                            'Remember me',
                            style: TextStyle(
                              fontSize: 14.sp,
                              color: const Color(0xFF64748B),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),

                      SizedBox(height: 36.h),

                      Obx(() => SizedBox(
                            width: double.infinity,
                            height: 54.h,
                            child: ElevatedButton(
                              onPressed: _authController.isLoading.value
                                  ? null
                                  : _handleLogin,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0D6842),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(27.r),
                                ),
                                elevation: 0,
                              ),
                              child: _authController.isLoading.value
                                  ? SizedBox(
                                      width: 24.w,
                                      height: 24.w,
                                      child: const CircularProgressIndicator(
                                        color: Colors.white,
                                        strokeWidth: 2.5,
                                      ),
                                    )
                                  : Text(
                                      'LOGIN',
                                      style: TextStyle(
                                        color: Colors.white,
                                        fontSize: 16.sp,
                                        fontWeight: FontWeight.bold,
                                        letterSpacing: 1.2,
                                      ),
                                    ),
                            ),
                          )),

                      SizedBox(height: 48.h),

                      // Security Badge
                      Row(
                        children: [
                          const Expanded(
                            child: Divider(
                              color: Color(0xFFE2E8F0),
                              thickness: 1,
                            ),
                          ),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 12.w),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.shield_outlined,
                                  size: 14.sp,
                                  color: const Color(0xFF94A3B8),
                                ),
                                SizedBox(width: 4.w),
                                Text(
                                  'SVM',
                                  style: TextStyle(
                                    fontWeight: FontWeight.bold,
                                    fontSize: 10.sp,
                                    color: const Color(0xFF94A3B8),
                                  ),
                                ),
                                SizedBox(width: 4.w),
                                Text(
                                  'Secure Banking Grade Authentication',
                                  style: TextStyle(
                                    fontSize: 10.sp,
                                    color: const Color(0xFF94A3B8),
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const Expanded(
                            child: Divider(
                              color: Color(0xFFE2E8F0),
                              thickness: 1,
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 170.h),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    ),
  ),
);
  }
}

class WavePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    // Bottom Wave 1
    final paint1 = Paint()
      ..shader =
          LinearGradient(
            begin: Alignment.bottomLeft,
            end: Alignment.topRight,
            colors: [
              const Color(0x0F0D6842),
              const Color(0x030D6842),
              Colors.transparent,
            ],
          ).createShader(
            Rect.fromLTWH(0, size.height * 0.7, size.width, size.height * 0.3),
          );

    final path1 = Path();
    path1.moveTo(0, size.height * 0.85);
    path1.quadraticBezierTo(
      size.width * 0.3,
      size.height * 0.78,
      size.width * 0.65,
      size.height * 0.88,
    );
    path1.quadraticBezierTo(
      size.width * 0.85,
      size.height * 0.94,
      size.width,
      size.height * 0.88,
    );
    path1.lineTo(size.width, size.height);
    path1.lineTo(0, size.height);
    path1.close();
    canvas.drawPath(path1, paint1);

    // Bottom Wave 2
    final paint2 = Paint()
      ..shader =
          LinearGradient(
            begin: Alignment.bottomRight,
            end: Alignment.topLeft,
            colors: [
              const Color(0x170D6842),
              const Color(0x050D6842),
              Colors.transparent,
            ],
          ).createShader(
            Rect.fromLTWH(
              0,
              size.height * 0.75,
              size.width,
              size.height * 0.25,
            ),
          );

    final path2 = Path();
    path2.moveTo(0, size.height * 0.92);
    path2.quadraticBezierTo(
      size.width * 0.25,
      size.height * 0.88,
      size.width * 0.5,
      size.height * 0.94,
    );
    path2.quadraticBezierTo(
      size.width * 0.78,
      size.height * 0.82,
      size.width,
      size.height * 0.85,
    );
    path2.lineTo(size.width, size.height);
    path2.lineTo(0, size.height);
    path2.close();
    canvas.drawPath(path2, paint2);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
