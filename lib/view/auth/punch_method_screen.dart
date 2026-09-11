import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/services/device_biometric_service.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

/// Shown when an employee taps Punch-In / Punch-Out. Lets them pick the
/// biometric method:
///
///  * Face Verification   → opens [FaceVerificationScreen] (camera + liveness).
///  * Fingerprint Verification → OS fingerprint / Face-unlock prompt, then the
///    server records the punch ([FaceBiometricService.recordDeviceBiometricPunch]).
///
/// The server owns the final attendance decision in both cases. The fingerprint
/// option is hidden entirely on devices with no enrolled fingerprint / Face.
class PunchMethodScreen extends StatefulWidget {
  const PunchMethodScreen({super.key, this.isPunchOut = false});

  final bool isPunchOut;

  @override
  State<PunchMethodScreen> createState() => _PunchMethodScreenState();
}

class _PunchMethodScreenState extends State<PunchMethodScreen> {
  bool _fingerprintAvailable = false;
  bool _checkingAvailability = true;
  bool _busy = false;
  Position? _position;

  String get _action => widget.isPunchOut ? 'Punch-Out' : 'Punch-In';

  @override
  void initState() {
    super.initState();
    _checkFingerprintAvailability();
    _fetchLocation();
  }

  Future<void> _checkFingerprintAvailability() async {
    final available = await DeviceBiometricService.isAvailable();
    if (!mounted) return;
    setState(() {
      _fingerprintAvailable = available;
      _checkingAvailability = false;
    });
  }

  Future<void> _fetchLocation() async {
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (!mounted) return;
      setState(() => _position = position);
    } catch (_) {}
  }

  void _startFaceVerification() {
    Get.to(() => FaceVerificationScreen(isPunchOut: widget.isPunchOut));
  }

  Future<void> _startFingerprintVerification() async {
    if (_busy) return;
    setState(() => _busy = true);

    try {
      final authResult = await DeviceBiometricService.authenticate(
        'Verify it\'s you before ${_action.toLowerCase()}',
      );
      if (!mounted) return;

      if (authResult != DeviceBiometricResult.success) {
        setState(() => _busy = false);
        Get.snackbar(
          'Fingerprint Not Confirmed',
          switch (authResult) {
            DeviceBiometricResult.cancelled =>
              'Cancelled. Try again or choose Face Verification.',
            DeviceBiometricResult.unavailable =>
              'Device biometrics are unavailable right now. Please use Face Verification.',
            _ => 'Could not confirm your fingerprint. Please use Face Verification.',
          },
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: const Color(0xFFB45309),
          colorText: Colors.white,
          duration: const Duration(seconds: 3),
        );
        return;
      }

      // Let the server's current state decide the punch type, exactly like the
      // face path does.
      final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
      String punchType = widget.isPunchOut ? 'PUNCH_OUT' : 'PUNCH_IN';
      if (serverInfo != null) {
        final bool isServerPunchedIn =
            serverInfo.present || serverInfo.punchedIn;
        if (!isServerPunchedIn) {
          punchType = 'PUNCH_IN';
        } else if (isServerPunchedIn && !serverInfo.punchedOut) {
          punchType = 'PUNCH_OUT';
        }
      }

      final auth = Get.isRegistered<AuthController>()
          ? Get.find<AuthController>()
          : Get.put(AuthController());
      final deviceId = await auth.getOrCreateDeviceId();

      final result = await FaceBiometricService.recordDeviceBiometricPunch(
        type: punchType,
        latitude: _position?.latitude,
        longitude: _position?.longitude,
        deviceId: deviceId,
      );
      if (!mounted) return;

      setState(() => _busy = false);

      if (!result.isMatch) {
        _showResultDialog(
          success: false,
          message: result.message,
        );
        return;
      }

      final isPunchOut = punchType == 'PUNCH_OUT';
      final prefs = await SharedPreferences.getInstance();
      await recordLocalPunch(prefs, isPunchOut: isPunchOut);
      if (!mounted) return;

      _showResultDialog(
        success: true,
        message: 'Fingerprint Verification Successful – '
            '${isPunchOut ? 'Punch-Out' : 'Punch-In'} Completed.',
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _busy = false);
      _showResultDialog(
        success: false,
        message:
            'Something went wrong recording your punch. Please try again or use Face Verification.',
      );
    }
  }

  void _showResultDialog({required bool success, required String message}) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20.r)),
        backgroundColor: Colors.white,
        contentPadding: EdgeInsets.all(24.w),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64.w,
              height: 64.w,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: success ? const Color(0xFFE8F5E9) : const Color(0xFFFEE2E2),
              ),
              child: Icon(
                success ? Icons.check_circle_rounded : Icons.error_outline_rounded,
                color: success ? const Color(0xFF0D6842) : const Color(0xFFDC2626),
                size: 36.sp,
              ),
            ),
            SizedBox(height: 16.h),
            Text(
              success ? 'Verification Successful' : 'Verification Failed',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17.sp,
                fontWeight: FontWeight.bold,
                color: success ? const Color(0xFF0F172A) : const Color(0xFFDC2626),
              ),
            ),
            SizedBox(height: 8.h),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13.sp,
                color: const Color(0xFF64748B),
                height: 1.35,
              ),
            ),
            SizedBox(height: 22.h),
            SizedBox(
              width: double.infinity,
              height: 48.h,
              child: ElevatedButton(
                onPressed: () async {
                  Navigator.pop(ctx);
                  if (success) {
                    final homeScreen = await resolveHomeScreen();
                    Get.offAll(() => homeScreen);
                  }
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0D6842),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                  elevation: 0,
                ),
                child: Text(
                  success ? 'Continue' : 'Close',
                  style: TextStyle(
                    fontSize: 15.sp,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _handleBack() async {
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
      return;
    }
    // This screen is reached via `Get.offAll`, so there is nothing left on
    // the stack to pop above. For a mandatory punch-in, there is no home
    // screen to safely fall back to — doing so let un-punched-in members
    // bypass attendance entirely. Only punch-OUT (already punched in) may
    // fall back to the dashboard.
    if (!widget.isPunchOut) return;
    final homeScreen = await resolveHomeScreen();
    Get.offAll(() => homeScreen);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        _handleBack();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFEFF3EF),
        body: SafeArea(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 20.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(height: 12.h),
                Row(
                  children: [
                    InkWell(
                      onTap: _busy ? null : _handleBack,
                      borderRadius: BorderRadius.circular(24.r),
                      child: Container(
                        width: 44.w,
                        height: 44.w,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.06),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ],
                        ),
                        child: Icon(
                          Icons.chevron_left_rounded,
                          color: const Color(0xFF1E293B),
                          size: 26.sp,
                        ),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        _action,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0F172A),
                          letterSpacing: -0.3,
                        ),
                      ),
                    ),
                    SizedBox(width: 44.w),
                  ],
                ),
                SizedBox(height: 32.h),
                Text(
                  'Choose how you want to verify',
                  style: TextStyle(
                    fontSize: 16.sp,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0F172A),
                  ),
                ),
                SizedBox(height: 6.h),
                Text(
                  'Confirm your identity to complete today\'s $_action.',
                  style: TextStyle(
                    fontSize: 13.sp,
                    color: const Color(0xFF64748B),
                    height: 1.35,
                  ),
                ),
                SizedBox(height: 24.h),
                _MethodCard(
                  icon: Icons.face_retouching_natural_rounded,
                  title: 'Face Verification',
                  subtitle: 'Scan your face with the front camera',
                  enabled: !_busy,
                  onTap: _startFaceVerification,
                ),
                SizedBox(height: 14.h),
                if (_checkingAvailability)
                  Padding(
                    padding: EdgeInsets.only(top: 8.h),
                    child: const Center(
                      child: CircularProgressIndicator(color: Color(0xFF769A8B)),
                    ),
                  )
                else if (_fingerprintAvailable)
                  _MethodCard(
                    icon: Icons.fingerprint_rounded,
                    title: 'Fingerprint Verification',
                    subtitle: 'Use this device\'s fingerprint / Face unlock',
                    enabled: !_busy,
                    busy: _busy,
                    onTap: _startFingerprintVerification,
                  )
                else
                  Container(
                    padding: EdgeInsets.all(14.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(16.r),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.fingerprint_rounded,
                            color: const Color(0xFF94A3B8), size: 24.sp),
                        SizedBox(width: 12.w),
                        Expanded(
                          child: Text(
                            'Fingerprint verification is not set up on this device.',
                            style: TextStyle(
                              fontSize: 12.5.sp,
                              color: const Color(0xFF64748B),
                              height: 1.3,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const Spacer(),
                Padding(
                  padding: EdgeInsets.only(bottom: 16.h),
                  child: Text(
                    'Your attendance time is recorded only after verification succeeds.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11.5.sp,
                      color: const Color(0xFF94A3B8),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MethodCard extends StatelessWidget {
  const _MethodCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.enabled = true,
    this.busy = false,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;
  final bool enabled;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Opacity(
      opacity: enabled ? 1 : 0.55,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(16.r),
        child: Container(
          padding: EdgeInsets.all(16.w),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16.r),
            border: Border.all(color: const Color(0xFFE2E8F0)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.04),
                blurRadius: 10,
                offset: const Offset(0, 3),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 48.w,
                height: 48.w,
                decoration: const BoxDecoration(
                  color: Color(0xFFE8F5E9),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: const Color(0xFF0D6842), size: 26.sp),
              ),
              SizedBox(width: 14.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        fontSize: 15.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    SizedBox(height: 2.h),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 12.sp,
                        color: const Color(0xFF64748B),
                        height: 1.3,
                      ),
                    ),
                  ],
                ),
              ),
              SizedBox(width: 8.w),
              busy
                  ? SizedBox(
                      width: 20.w,
                      height: 20.w,
                      child: const CircularProgressIndicator(
                        color: Color(0xFF0D6842),
                        strokeWidth: 2,
                      ),
                    )
                  : Icon(Icons.chevron_right_rounded,
                      color: const Color(0xFF94A3B8), size: 24.sp),
            ],
          ),
        ),
      ),
    );
  }
}
