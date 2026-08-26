import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/face_training_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';

class SetMpinScreen extends StatefulWidget {
  const SetMpinScreen({super.key, this.isReset = false});

  final bool isReset;

  @override
  State<SetMpinScreen> createState() => _SetMpinScreenState();
}

class _SetMpinScreenState extends State<SetMpinScreen> {
  final List<TextEditingController> _enterMpinControllers = List.generate(
    4,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _enterMpinFocusNodes = List.generate(
    4,
    (_) => FocusNode(),
  );

  final List<TextEditingController> _confirmMpinControllers = List.generate(
    4,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _confirmMpinFocusNodes = List.generate(
    4,
    (_) => FocusNode(),
  );

  bool _showEnterMpin = false;
  bool _showConfirmMpin = false;

  @override
  void dispose() {
    for (var controller in _enterMpinControllers) {
      controller.dispose();
    }
    for (var node in _enterMpinFocusNodes) {
      node.dispose();
    }
    for (var controller in _confirmMpinControllers) {
      controller.dispose();
    }
    for (var node in _confirmMpinFocusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  Future<void> _handleSetMpin() async {
    String mpin = _enterMpinControllers.map((c) => c.text).join();
    String confirm = _confirmMpinControllers.map((c) => c.text).join();

    if (mpin.length < 4) {
      Get.snackbar(
        'Required',
        'Please enter a 4-digit MPIN',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }
    if (confirm.length < 4) {
      Get.snackbar(
        'Required',
        'Please confirm your MPIN',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }
    if (mpin != confirm) {
      Get.snackbar(
        'Mismatch',
        'MPINs do not match. Please try again.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        margin: EdgeInsets.all(16.w),
        borderRadius: 8.r,
      );
      return;
    }

    final AuthController authController = Get.isRegistered<AuthController>()
        ? Get.find<AuthController>()
        : Get.put(AuthController());

    final bool success = widget.isReset
        ? await authController.changeMpin(mpin: mpin, confirmMpin: confirm)
        : await authController.setupMpin(mpin: mpin, confirmMpin: confirm);

    if (success) {
      if (widget.isReset) {
        Get.offAll(() => const MpinLoginScreen());
      } else {
        final prefs = await SharedPreferences.getInstance();
        await prefs.setBool('faceEnrollmentCompleted', false);
        Get.off(() => const FaceTrainingScreen());
      }
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
                          SizedBox(height: 4.h),

                          Center(
                            child: Image.asset(
                              'assets/icon/Sarvam_01.png',
                              height: 75.h,
                              fit: BoxFit.contain,
                            ),
                          ),
                          SizedBox(height: 16.h),

                          // Set MPIN Heading
                          Center(
                            child: Text(
                              'Set MPIN',
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
                              'Create a 4-digit MPIN to secure your account',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: 15.sp,
                                color: const Color(0xFF64748B),
                                height: 1.3,
                              ),
                            ),
                          ),

                          SizedBox(height: 28.h),

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

                          // Enter MPIN Input Fields Row with Toggle
                          Row(
                            children: [
                              Row(
                                children: List.generate(4, (index) {
                                  return Container(
                                    width: 57.w,
                                    height: 56.h,
                                    margin: EdgeInsets.only(right: 8.w),
                                    child: TextFormField(
                                      controller: _enterMpinControllers[index],
                                      focusNode: _enterMpinFocusNodes[index],
                                      textAlign: TextAlign.center,
                                      keyboardType: TextInputType.number,
                                      obscureText: !_showEnterMpin,
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
                                            _enterMpinFocusNodes[index + 1]
                                                .requestFocus();
                                          } else {
                                            _enterMpinFocusNodes[index]
                                                .unfocus();
                                          }
                                        } else {
                                          if (index > 0) {
                                            _enterMpinFocusNodes[index - 1]
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
                                    _showEnterMpin = !_showEnterMpin;
                                  });
                                },
                                icon: Icon(
                                  _showEnterMpin
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

                          SizedBox(height: 24.h),

                          // Confirm MPIN Label
                          Text(
                            'Confirm MPIN',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF64748B),
                              letterSpacing: 0.5,
                            ),
                          ),

                          SizedBox(height: 10.h),

                          // Confirm MPIN Input Fields Row with Toggle
                          Row(
                            children: [
                              Row(
                                children: List.generate(4, (index) {
                                  return Container(
                                    width: 57.w,
                                    height: 56.h,
                                    margin: EdgeInsets.only(right: 8.w),
                                    child: TextFormField(
                                      controller:
                                          _confirmMpinControllers[index],
                                      focusNode: _confirmMpinFocusNodes[index],
                                      textAlign: TextAlign.center,
                                      keyboardType: TextInputType.number,
                                      obscureText: !_showConfirmMpin,
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
                                            _confirmMpinFocusNodes[index + 1]
                                                .requestFocus();
                                          } else {
                                            _confirmMpinFocusNodes[index]
                                                .unfocus();
                                          }
                                        } else {
                                          if (index > 0) {
                                            _confirmMpinFocusNodes[index - 1]
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
                                    _showConfirmMpin = !_showConfirmMpin;
                                  });
                                },
                                icon: Icon(
                                  _showConfirmMpin
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

                          SizedBox(height: 32.h),

                          // Information Box
                          Container(
                            padding: EdgeInsets.symmetric(
                              horizontal: 16.w,
                              vertical: 12.h,
                            ),
                            decoration: BoxDecoration(
                              color: const Color(0xFFF4FAF7),
                              borderRadius: BorderRadius.circular(12.r),
                              border: Border.all(
                                color: const Color(0xFFE8F5E9),
                                width: 1,
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Container(
                                  padding: EdgeInsets.all(6.w),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFFE8F5E9),
                                    shape: BoxShape.circle,
                                  ),
                                  child: Icon(
                                    Icons.verified_user,
                                    color: const Color(0xFF0D6842),
                                    size: 16.sp,
                                  ),
                                ),
                                SizedBox(width: 12.w),
                                Expanded(
                                  child: Text(
                                    'MPIN helps you authorize transactions and keep your account secure.',
                                    style: TextStyle(
                                      fontSize: 13.sp,
                                      color: const Color(0xFF475569),
                                      height: 1.4,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),

                          SizedBox(height: 32.h),

                          // Set MPIN Button
                          SizedBox(
                            width: double.infinity,
                            height: 54.h,
                            child: ElevatedButton(
                              onPressed: _handleSetMpin,
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF0D6842),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(27.r),
                                ),
                                elevation: 0,
                              ),
                              child: Text(
                                'SET MPIN',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 16.sp,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 1.2,
                                ),
                              ),
                            ),
                          ),
                          SizedBox(height: 50.h),
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
