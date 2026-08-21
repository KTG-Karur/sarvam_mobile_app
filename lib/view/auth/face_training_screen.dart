import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/view/auth/live_face_registration_screen.dart';
import 'package:lottie/lottie.dart';

/// UI flow for enrolling face samples after OTP verification.
/// Directs the user to the secure Real-Time Live Face Registration screen.
class FaceTrainingScreen extends StatefulWidget {
  const FaceTrainingScreen({super.key, this.autoStart = false});

  final bool autoStart;

  @override
  State<FaceTrainingScreen> createState() => _FaceTrainingScreenState();
}

class _FaceTrainingScreenState extends State<FaceTrainingScreen> {
  @override
  void initState() {
    super.initState();
    if (widget.autoStart) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _startLiveRegistration();
      });
    }
  }

  void _startLiveRegistration() {
    Get.to(() => const LiveFaceRegistrationScreen());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        foregroundColor: const Color(0xFF0D6842),
        elevation: 0,
        title: Text(
          'Face Registration',
          style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800),
        ),
      ),
      body: SafeArea(
        top: false,
        child: LayoutBuilder(
          builder: (context, constraints) {
            return SingleChildScrollView(
              padding: EdgeInsets.all(24.w),
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  minHeight: constraints.maxHeight - 48.w,
                ),
                child: IntrinsicHeight(
                  child: Column(
                    children: [
                      SizedBox(height: 12.h),
                      Text(
                        'Register Your Face Biometric',
                        style: TextStyle(
                          fontSize: 20.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF10472A),
                        ),
                      ),
                      SizedBox(height: 6.h),
                      Text(
                        'Secure real-time live face registration with interactive liveness detection and anti-spoofing.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 12.sp,
                          color: const Color(0xFF638B74),
                        ),
                      ),
                      SizedBox(height: 20.h),
                      Container(
                        width: 200.w,
                        height: 200.w,
                        clipBehavior: Clip.antiAlias,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          border: Border.all(color: const Color(0xFF7AC89A), width: 3),
                          boxShadow: const [
                            BoxShadow(color: Color(0x140D6842), blurRadius: 20),
                          ],
                        ),
                        child: Center(
                          child: Lottie.asset(
                            'assets/lottie/face_recognition.json',
                            width: 150.w,
                            height: 150.w,
                            fit: BoxFit.contain,
                            repeat: true,
                          ),
                        ),
                      ),
                      SizedBox(height: 20.h),
                      Text(
                        'Position your face inside the illuminated oval frame when camera opens.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF10472A),
                        ),
                      ),
                      const Spacer(),
                      SizedBox(height: 16.h),
                      SizedBox(
                        width: double.infinity,
                        height: 50.h,
                        child: ElevatedButton.icon(
                          onPressed: _startLiveRegistration,
                          icon: const Icon(
                            Icons.face_retouching_natural_rounded,
                          ),
                          label: const Text(
                            'START LIVE FACE REGISTRATION',
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFF0D6842),
                            foregroundColor: Colors.white,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12.r),
                            ),
                          ),
                        ),
                      ),
                      SizedBox(height: 10.h),
                      Text(
                        'Keep your face well lit and follow screen prompts.',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF638B74),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}
