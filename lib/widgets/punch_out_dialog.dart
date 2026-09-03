import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/view/auth/role_home_router.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/widgets/biometric_gate_dialog.dart';

class PunchOutDialog extends StatefulWidget {
  const PunchOutDialog({super.key});

  static Future<void> show(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
    if (serverInfo != null && !serverInfo.faceAttendanceAllowed) {
      Get.snackbar(
        'Attendance Restricted',
        serverInfo.accessMessage ?? 'Face attendance is disabled for today by Admin.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }

    // Make the local cache match the server (clears stale marks too), then
    // decide from the reconciled state.
    await reconcilePunchPrefs(prefs, serverInfo);

    final bool punchedOut =
        (serverInfo?.punchedOut ?? false) || hasPunchedOutToday(prefs);
    final bool punchedIn = (serverInfo?.present ?? false) ||
        (serverInfo?.punchedIn ?? false) ||
        hasPunchedInToday(prefs);

    if (punchedOut) {
      Get.snackbar(
        'Punch Out',
        'You have already punched out for today.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }
    if (!punchedIn) {
      Get.snackbar(
        'Punch Out',
        'Please Punch-In first before performing Punch-Out.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.orange,
        colorText: Colors.white,
      );
      return;
    }

    if (!context.mounted) return;
    showDialog(
      context: context,
      barrierDismissible: true,
      builder: (_) => const PunchOutDialog(),
    );
  }

  @override
  State<PunchOutDialog> createState() => _PunchOutDialogState();
}

class _PunchOutDialogState extends State<PunchOutDialog> {
  final List<TextEditingController> _mpinControllers = List.generate(
    4,
    (_) => TextEditingController(),
  );
  final List<FocusNode> _focusNodes = List.generate(4, (_) => FocusNode());
  bool _isSubmitting = false;
  String _punchInTime = '--:--';

  @override
  void initState() {
    super.initState();
    _loadShiftDetails();
  }

  Future<void> _loadShiftDetails() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _punchInTime = prefs.getString('lastPunchInTime') ?? 'Today';
    });
  }

  @override
  void dispose() {
    for (var c in _mpinControllers) {
      c.dispose();
    }
    for (var f in _focusNodes) {
      f.dispose();
    }
    super.dispose();
  }

  Future<void> _handleConfirm() async {
    final mpin = _mpinControllers.map((c) => c.text).join();
    if (mpin.length < 4) {
      Get.snackbar(
        'MPIN Required',
        'Please enter your 4-digit MPIN to confirm Punch-Out',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final AuthController authController = Get.isRegistered<AuthController>()
          ? Get.find<AuthController>()
          : Get.put(AuthController());

      final bool isVerified = await authController.verifyMpin(mpin: mpin);
      if (!isVerified) {
        for (var c in _mpinControllers) {
          c.clear();
        }
        return;
      }

      if (!mounted) return;

      await BiometricGateDialog.maybeShow(context, isPunchOut: true);
      if (!mounted) return;
      Navigator.of(context).pop();

      // Proceed to face verification for punch-out
      Get.to(() => const FaceVerificationScreen(isPunchOut: true));
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
      backgroundColor: Colors.white,
      elevation: 8,
      child: Padding(
        padding: EdgeInsets.all(20.w),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.w),
                  decoration: const BoxDecoration(
                    color: Color(0xFFFEE2E2),
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    Icons.logout_rounded,
                    color: const Color(0xFFDC2626),
                    size: 24.sp,
                  ),
                ),
                SizedBox(width: 12.w),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Punch Out Shift',
                      style: TextStyle(
                        fontSize: 18.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    Text(
                      'Punched in at: $_punchInTime',
                      style: TextStyle(
                        fontSize: 12.sp,
                        color: const Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            SizedBox(height: 16.h),
            Text(
              'Enter 4-digit MPIN to verify identity',
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF475569),
              ),
            ),
            SizedBox(height: 12.h),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(4, (index) {
                return Container(
                  width: 50.w,
                  height: 52.h,
                  margin: EdgeInsets.symmetric(horizontal: 4.w),
                  child: TextFormField(
                    controller: _mpinControllers[index],
                    focusNode: _focusNodes[index],
                    textAlign: TextAlign.center,
                    keyboardType: TextInputType.number,
                    obscureText: true,
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
                    onChanged: (val) {
                      if (val.isNotEmpty) {
                        if (index < 3) {
                          _focusNodes[index + 1].requestFocus();
                        } else {
                          _focusNodes[index].unfocus();
                        }
                      } else {
                        if (index > 0) {
                          _focusNodes[index - 1].requestFocus();
                        }
                      }
                    },
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: const Color(0xFFF8F9FA),
                      contentPadding: EdgeInsets.zero,
                      counterText: '',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10.r),
                        borderSide: const BorderSide(
                          color: Color(0xFFDC2626),
                          width: 1.5,
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
            SizedBox(height: 24.h),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _isSubmitting ? null : () => Navigator.pop(context),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      padding: EdgeInsets.symmetric(vertical: 12.h),
                    ),
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        color: const Color(0xFF64748B),
                        fontWeight: FontWeight.bold,
                        fontSize: 14.sp,
                      ),
                    ),
                  ),
                ),
                SizedBox(width: 12.w),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _isSubmitting ? null : _handleConfirm,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFDC2626),
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      padding: EdgeInsets.symmetric(vertical: 12.h),
                    ),
                    child: _isSubmitting
                        ? SizedBox(
                            width: 20.w,
                            height: 20.w,
                            child: const CircularProgressIndicator(
                              color: Colors.white,
                              strokeWidth: 2,
                            ),
                          )
                        : Text(
                            'Punch Out',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 14.sp,
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
  }
}
