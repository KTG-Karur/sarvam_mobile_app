import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sms_autofill/sms_autofill.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/set_mpin_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key});

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> with CodeAutoFill {
  final List<TextEditingController> _otpControllers = List.generate(
    4,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _otpFocusNodes = List.generate(4, (_) => FocusNode());

  int _secondsRemaining = 45;
  Timer? _timer;
  bool _isVerifying = false;
  bool _isSendingOtp = false;

  @override
  void initState() {
    super.initState();
    _startTimer();
    listenForCode();
    _sendOtp();
  }

  @override
  void dispose() {
    cancel();
    unregisterListener();
    _timer?.cancel();
    for (var controller in _otpControllers) {
      controller.dispose();
    }
    for (var node in _otpFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  /// Receives a code through Android's SMS Retriever API. This does not request
  /// SMS read permission and still leaves manual entry available on all devices.
  @override
  void codeUpdated() {
    final receivedCode = code?.replaceAll(RegExp(r'\D'), '') ?? '';
    if (receivedCode.length < 4 || !mounted) return;

    final otp = receivedCode.substring(0, 4);
    setState(() {
      for (var index = 0; index < _otpControllers.length; index++) {
        _otpControllers[index].text = otp[index];
      }
    });
    FocusScope.of(context).unfocus();
  }

  void _startTimer() {
    setState(() {
      _secondsRemaining = 45;
    });
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_secondsRemaining > 0) {
        setState(() {
          _secondsRemaining--;
        });
      } else {
        _timer?.cancel();
      }
    });
  }

  Future<void> _sendOtp() async {
    if (_isSendingOtp) return;
    if (mounted) setState(() => _isSendingOtp = true);
    final prefs = await SharedPreferences.getInstance();
    final destination = prefs.getString('mobileNumber') ?? prefs.getString('email') ?? prefs.getString('employeeId') ?? '';
    final controller = Get.isRegistered<AuthController>() ? Get.find<AuthController>() : Get.put(AuthController());
    final sent = await controller.sendOtp(destination: destination, purpose: 'LOGIN');
    if (!mounted) return;
    setState(() {
      _isSendingOtp = false;
      if (!sent) _secondsRemaining = 0;
    });
    if (sent) _startTimer();
  }

  Future<void> _resendOtp() async {
    await _sendOtp();
  }

  Future<void> _handleVerifyOtp() async {
    if (_isVerifying || _isSendingOtp) return;
    String otp = _otpControllers.map((c) => c.text).join();
    if (otp.length < 4) {
      Get.snackbar(
        'Invalid OTP',
        'Please enter the 4-digit OTP',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }

    setState(() => _isVerifying = true);
    final controller = Get.isRegistered<AuthController>() ? Get.find<AuthController>() : Get.put(AuthController());
    final verified = await controller.verifyOtp(otp: otp, purpose: 'LOGIN');
    if (!mounted) return;
    setState(() => _isVerifying = false);
    if (!verified) return;
    final prefs = await SharedPreferences.getInstance();
    if (prefs.getBool('isMpinSet') ?? false) {
      Get.off(() => const MpinLoginScreen());
    } else {
      Get.off(() => const SetMpinScreen());
    }
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
                physics: const ClampingScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Back button
                    Padding(
                      padding: EdgeInsets.only(left: 12.w, top: 12.h),
                      child: IconButton(
                        icon: Icon(
                          Icons.arrow_back,
                          color: const Color(0xFF0D6842),
                          size: 26.sp,
                        ),
                        onPressed: () => Get.back(),
                      ),
                    ),

                    Padding(
                      padding: EdgeInsets.symmetric(horizontal: 28.w),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(height: 12.h),

                          Center(
                            child: Image.asset(
                              'assets/icon/Sarvam_01.png',
                              height: 75.h,
                              fit: BoxFit.contain,
                            ),
                          ),
                          SizedBox(height: 16.h),

                          // Verify OTP Heading
                          Center(
                            child: Text(
                              'Verify OTP',
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
                          Text(
                            'Enter the 4-digit OTP sent to your registered mobile number',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 15.sp,
                              color: const Color(0xFF64748B),
                              height: 1.3,
                            ),
                          ),

                          SizedBox(height: 28.h),

                          // Mobile Number Display Box
                          Container(
                            padding: EdgeInsets.all(16.w),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF4FAF7),
                              borderRadius: BorderRadius.circular(12.r),
                              border: Border.all(
                                color: const Color(0xFFE8F5E9),
                                width: 1,
                              ),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  padding: EdgeInsets.all(10.w),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFFE8F5E9),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.phone_android,
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
                                        'Mobile Number',
                                        style: TextStyle(
                                          fontSize: 12.sp,
                                          color: const Color(0xFF64748B),
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                      SizedBox(height: 2.h),
                                      Text(
                                        '+91 98**** 5678',
                                        style: TextStyle(
                                          fontSize: 15.sp,
                                          color: const Color(0xFF0F172A),
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                TextButton(
                                  onPressed: () => Get.back(),
                                  style: TextButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                    tapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: Text(
                                    'Change',
                                    style: TextStyle(
                                      color: const Color(0xFF0D6842),
                                      fontSize: 14.sp,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),

                          SizedBox(height: 32.h),

                          // OTP Input Label
                          Text(
                            'Enter 4-digit OTP',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF64748B),
                              letterSpacing: 0.5,
                            ),
                          ),

                          SizedBox(height: 12.h),

                          // 4 OTP Boxes
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: List.generate(4, (index) {
                              return SizedBox(
                                width: 68.w,
                                height: 68.w,
                                child: TextFormField(
                                  controller: _otpControllers[index],
                                  focusNode: _otpFocusNodes[index],
                                  textAlign: TextAlign.center,
                                  keyboardType: TextInputType.number,
                                  autofillHints: const [AutofillHints.oneTimeCode],
                                  style: TextStyle(
                                    fontSize: 22.sp,
                                    fontWeight: FontWeight.bold,
                                    color: const Color(0xFF0D6842),
                                  ),
                                  inputFormatters: [
                                    LengthLimitingTextInputFormatter(1),
                                    FilteringTextInputFormatter.digitsOnly,
                                  ],
                                  onChanged: (value) {
                                    if (value.isNotEmpty) {
                                      if (index < 3) {
                                        _otpFocusNodes[index + 1]
                                            .requestFocus();
                                      } else {
                                        _otpFocusNodes[index].unfocus();
                                      }
                                    } else {
                                      if (index > 0) {
                                        _otpFocusNodes[index - 1]
                                            .requestFocus();
                                      }
                                    }
                                  },
                                  decoration: InputDecoration(
                                    filled: true,
                                    fillColor: const Color(0xFFF8F9FA),
                                    contentPadding: EdgeInsets.zero,
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
                                  ),
                                ),
                              );
                            }),
                          ),

                          SizedBox(height: 28.h),

                          // Resend Section
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                "Didn't receive the OTP?",
                                style: TextStyle(
                                  fontSize: 14.sp,
                                  color: const Color(0xFF64748B),
                                ),
                              ),
                              _secondsRemaining > 0
                                  ? Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(
                                          'Resend OTP in ',
                                          style: TextStyle(
                                            fontSize: 14.sp,
                                            color: const Color(0xFF64748B),
                                          ),
                                        ),
                                        Text(
                                          '00:${_secondsRemaining.toString().padLeft(2, '0')}',
                                          style: TextStyle(
                                            fontSize: 14.sp,
                                            color: const Color(0xFF0D6842),
                                            fontWeight: FontWeight.bold,
                                          ),
                                        ),
                                      ],
                                    )
                                  : GestureDetector(
                                      onTap: _isSendingOtp ? null : _resendOtp,
                                      child: Text(
                                        'Resend OTP',
                                        style: TextStyle(
                                          fontSize: 14.sp,
                                          color: const Color(0xFF0D6842),
                                          fontWeight: FontWeight.bold,
                                          decoration: TextDecoration.underline,
                                        ),
                                      ),
                                    ),
                            ],
                          ),

                          SizedBox(height: 36.h),

                          // Verify Button
                          SizedBox(
                            width: double.infinity,
                            height: 54.h,
                            child: ElevatedButton(
                              onPressed: _isVerifying || _isSendingOtp
                                  ? null
                                  : _handleVerifyOtp,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0D6842),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(27.r),
                                ),
                                elevation: 0,
                              ),
                              child: _isVerifying
                                  ? SizedBox(
                                      width: 24.w,
                                      height: 24.w,
                                      child: const CircularProgressIndicator(
                                        color: Colors.white,
                                        strokeWidth: 2.5,
                                      ),
                                    )
                                  : Text(
                                      'VERIFY OTP',
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
                  ],
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
