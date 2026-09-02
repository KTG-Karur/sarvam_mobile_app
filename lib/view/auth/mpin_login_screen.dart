import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/login_screen.dart';
import 'package:sarvam/view/auth/set_mpin_screen.dart';
import 'package:sarvam/view/auth/role_home_router.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/view/auth/face_training_screen.dart';
import 'package:sarvam/services/face_biometric_service.dart';

class MpinLoginScreen extends StatefulWidget {
  const MpinLoginScreen({super.key});

  @override
  State<MpinLoginScreen> createState() => _MpinLoginScreenState();
}

class _MpinLoginScreenState extends State<MpinLoginScreen>
    with WidgetsBindingObserver {
  final List<TextEditingController> _mpinControllers = List.generate(
    4,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _mpinFocusNodes = List.generate(4, (_) => FocusNode());

  bool _showMpin = false;
  bool _checkingResetApproval = false;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _openNewMpinScreenWhenApproved();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _openNewMpinScreenWhenApproved();
    }
  }

  Future<void> _openNewMpinScreenWhenApproved() async {
    if (_checkingResetApproval) return;
    _checkingResetApproval = true;
    try {
      final authController = Get.isRegistered<AuthController>()
          ? Get.find<AuthController>()
          : Get.put(AuthController());
      final canSetNewMpin = await authController.canChangeForgottenMpin();
      if (canSetNewMpin && mounted) {
        Get.offAll(() => const SetMpinScreen(isReset: true));
      }
    } finally {
      _checkingResetApproval = false;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (var controller in _mpinControllers) {
      controller.dispose();
    }
    for (var node in _mpinFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  Future<void> _handleLogin() async {
    if (_isLoading) return;
    String mpin = _mpinControllers.map((c) => c.text).join();

    if (mpin.length < 4) {
      Get.snackbar(
        'Required',
        'Please enter your 4-digit MPIN',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final AuthController authController = Get.isRegistered<AuthController>()
          ? Get.find<AuthController>()
          : Get.put(AuthController());

      bool isVerified = await authController.verifyMpin(mpin: mpin);

      final prefs = await SharedPreferences.getInstance();
      if (isVerified) {
        final bool faceEnrolled = await FaceBiometricService.isFaceEnrolled();
        final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();

        if (!mounted) return;

        // Server attendance status is the source of truth; make the local
        // prefs cache mirror it (both directions) so home / punch-out agree.
        await reconcilePunchPrefs(prefs, serverInfo);

        if (!FaceBiometricService.isModelReady) {
          // No on-device face model: face enrol/verify cannot run. Don't trap
          // the user in the training loop — let them in on MPIN only.
          final homeScreen = await resolveHomeScreen();
          Get.offAll(() => homeScreen);
          Get.snackbar(
            'Face check unavailable',
            'The face recognition model is not installed on this device. '
                'Signed in with MPIN only — contact your administrator.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFFB45309),
            colorText: Colors.white,
            duration: const Duration(seconds: 4),
          );
        } else if (!faceEnrolled) {
          Get.offAll(() => const FaceTrainingScreen(autoStart: true));
        } else if (serverInfo != null && !serverInfo.faceAttendanceAllowed) {
          final homeScreen = await resolveHomeScreen();
          Get.offAll(() => homeScreen);
          Get.snackbar(
            'Holiday / Attendance Locked',
            serverInfo.accessMessage ?? 'Today is a Holiday / Weekly Off. Face attendance is disabled by Admin.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFFB45309),
            colorText: Colors.white,
            duration: const Duration(seconds: 4),
          );
        } else if (hasPunchedInToday(prefs)) {
          final homeScreen = await resolveHomeScreen();
          Get.offAll(() => homeScreen);
        } else if (hasPunchedOutToday(prefs)) {
          final homeScreen = await resolveHomeScreen();
          Get.offAll(() => homeScreen);
          Get.snackbar(
            'Shift Completed',
            'You have already completed your punch-out for today.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF0D6842),
            colorText: Colors.white,
          );
        } else {
          Get.offAll(() => const FaceVerificationScreen());
        }
      } else {
        for (var c in _mpinControllers) {
          c.clear();
        }
        if (_mpinFocusNodes.isNotEmpty) {
          _mpinFocusNodes[0].requestFocus();
        }
        if (mounted) {
          setState(() {
            _isLoading = false;
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _handleForgotMpin() async {
    final authController = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : Get.put(AuthController());
    final requested = await authController.forgotMpin();
    if (!mounted) return;

    // A 409 can mean the administrator has already approved an earlier
    // request. That is actionable: open the replacement-MPIN form directly.
    if (!requested) {
      final canSetNewMpin = await authController.canChangeForgottenMpin();
      if (canSetNewMpin && mounted) {
        Get.closeAllSnackbars();
        Get.offAll(() => const SetMpinScreen(isReset: true));
      }
      return;
    }

    Get.snackbar(
      'Request Submitted',
      'Your MPIN reset request has been sent. Set a new MPIN after administrator approval.',
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFF0D6842),
      colorText: Colors.white,
      duration: const Duration(seconds: 3),
    );
    Get.offAll(() => const LoginScreen());
  }

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
                physics: const ClampingScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(height: 20.h),

                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 28.w),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(height: 4.h),

                          Center(
                            child: Image.asset(
                              'assets/icon/Sarvam_01.png',
                              height: 75.h,
                              fit: BoxFit.contain,
                            ),
                          ),
                          SizedBox(height: 16.h),

                          // Welcome Back Heading
                          Center(
                            child: Text(
                              'Welcome Back!',
                              style: TextStyle(
                                fontSize: 28.sp,
                                fontWeight: FontWeight.w800,
                                color: const Color(0xFF0F172A),
                                letterSpacing: 0.5,
                              ),
                            ),
                          ),

                          SizedBox(height: 8.h),

                          // Instructions Subtext
                          Center(
                            child: Text(
                              'Login using your MPIN',
                              style: TextStyle(
                                fontSize: 15.sp,
                                color: const Color(0xFF64748B),
                                height: 1.3,
                              ),
                            ),
                          ),

                          SizedBox(height: 28.h),

                          // Secure Login Info Box
                          Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: 16.w,
                              vertical: 12.h,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF8F9FA),
                              borderRadius: BorderRadius.circular(12.r),
                              border: Border.all(
                                color: const Color(0xFFE2E8F0),
                                width: 1,
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Container(
                                  padding: EdgeInsets.all(8.w),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFFE8F5E9),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.lock_outline,
                                    color: const Color(0xFF0D6842),
                                    size: 20.sp,
                                  ),
                                ),
                                SizedBox(width: 14.w),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Secure Login',
                                        style: TextStyle(
                                          fontSize: 14.sp,
                                          color: const Color(0xFF0F172A),
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                      SizedBox(height: 2.h),
                                      Text(
                                        'Your MPIN keeps your account safe and secure.',
                                        style: TextStyle(
                                          fontSize: 12.sp,
                                          color: const Color(0xFF64748B),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),

                          SizedBox(height: 32.h),

                          // Enter 4-digit MPIN Label
                          Text(
                            'Enter 4-digit MPIN',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF64748B),
                              letterSpacing: 0.5,
                            ),
                          ),

                          SizedBox(height: 10.h),

                          // MPIN Input Fields Row with Toggle
                          Row(
                            children: [
                              Row(
                                children: List.generate(4, (index) {
                                  return Container(
                                    width: 58.w,
                                    height: 56.h,
                                    margin: EdgeInsets.only(right: 8.w),
                                    child: TextFormField(
                                      controller: _mpinControllers[index],
                                      focusNode: _mpinFocusNodes[index],
                                      textAlign: TextAlign.center,
                                      keyboardType: TextInputType.number,
                                      obscureText: !_showMpin,
                                      obscuringCharacter: '•',
                                      style: TextStyle(
                                        fontSize: 20.sp,
                                        fontWeight: FontWeight.bold,
                                        color: const Color(0xFF0F172A),
                                      ),
                                      inputFormatters: [
                                        LengthLimitingTextInputFormatter(1),
                                        FilteringTextInputFormatter.digitsOnly,
                                      ],
                                      onChanged: (value) {
                                        if (value.isNotEmpty) {
                                          if (index < 3) {
                                            _mpinFocusNodes[index + 1]
                                                .requestFocus();
                                          } else {
                                            _mpinFocusNodes[index].unfocus();
                                            _handleLogin();
                                          }
                                        } else {
                                          if (index > 0) {
                                            _mpinFocusNodes[index - 1]
                                                .requestFocus();
                                          }
                                        }
                                      },
                                      decoration: InputDecoration(
                                        filled: true,
                                        fillColor: const Color(0xFFF8F9FA),
                                        contentPadding: EdgeInsets.zero,
                                        counterText: '',
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            10.r,
                                          ),
                                          borderSide: const BorderSide(
                                            color: Color(0xFFE2E8F0),
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            10.r,
                                          ),
                                          borderSide: const BorderSide(
                                            color: Color(0xFFE2E8F0),
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            10.r,
                                          ),
                                          borderSide: const BorderSide(
                                            color: Color(0xFF0D6842),
                                            width: 1.5,
                                          ),
                                        ),
                                      ),
                                    ),
                                  );
                                }),
                              ),
                              const Spacer(),
                              TextButton.icon(
                                onPressed: () {
                                  setState(() {
                                    _showMpin = !_showMpin;
                                  });
                                },
                                icon: Icon(
                                  _showMpin
                                      ? Icons.visibility_off_outlined
                                      : Icons.visibility_outlined,
                                  color: const Color(0xFF0D6842),
                                  size: 18.sp,
                                ),
                                label: const Text(
                                  '',
                                  style: TextStyle(color: Color(0xFF0D6842)),
                                ),
                                style: TextButton.styleFrom(
                                  padding: EdgeInsets.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                              ),
                            ],
                          ),

                          SizedBox(height: 16.h),

                          // Forgot MPIN TextButton
                          TextButton(
                            onPressed: _handleForgotMpin,
                            style: TextButton.styleFrom(
                              padding: EdgeInsets.zero,
                              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            ),
                            child: Text(
                              'Forgot MPIN?',
                              style: TextStyle(
                                color: const Color(0xFF0D6842),
                                fontSize: 14.sp,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),

                          SizedBox(height: 32.h),

                          // LOGIN Button
                          SizedBox(
                            width: double.infinity,
                            height: 54.h,
                            child: ElevatedButton(
                              onPressed: _isLoading ? null : _handleLogin,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0D6842),
                                disabledBackgroundColor: const Color(0xFF0D6842).withValues(alpha: 0.6),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(27.r),
                                ),
                                elevation: 0,
                              ),
                              child: _isLoading
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
                          ),

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
                                    SizedBox(width: 6.w),
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
                          SizedBox(height: 24.h),

                          // Option to Log in as a different user
                          Center(
                            child: TextButton(
                              onPressed: () => Get.off(() => const LoginScreen()),
                              style: TextButton.styleFrom(
                                padding: EdgeInsets.symmetric(
                                  horizontal: 12.w,
                                  vertical: 8.h,
                                ),
                              ),
                              child: Text(
                                'Log in here',
                                style: TextStyle(
                                  fontSize: 14.sp,
                                  fontWeight: FontWeight.bold,
                                  color: const Color(0xFF0D6842),
                                ),
                              ),
                            ),
                          ),

                          SizedBox(height: 48.h),
                        ],
                      ),
                    ),
                  ],
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
