import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/set_mpin_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final AuthController _authController = Get.put(AuthController());
  final GlobalKey<FormState> _formKey = GlobalKey<FormState>();
  final TextEditingController _employeeIdController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _isPasswordVisible = false;
  bool _rememberMe = false;

  @override
  void initState() {
    super.initState();
    _loadSavedCredentials();
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
    return Scaffold(
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
                    autovalidateMode: AutovalidateMode.onUserInteraction,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(height: 50.h),

                        Center(
                          child: Image.asset(
                            'assets/icon/Sarvam_01.png',
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
