import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:sarvam/services/device_biometric_service.dart';

/// Optional device-biometric (fingerprint / Face unlock) check shown right
/// before the face-recognition camera opens for punch-in or punch-out.
///
/// This is a convenience gate, not a security gate: it never blocks
/// attendance. If the device has no biometric hardware/enrollment it is
/// skipped silently; if shown, the user can always tap "Skip" and continue
/// straight to face verification, which remains the real identity check.
class BiometricGateDialog {
  static Future<void> maybeShow(
    BuildContext context, {
    required bool isPunchOut,
  }) async {
    final available = await DeviceBiometricService.isAvailable();
    if (!available || !context.mounted) return;

    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (_) => _BiometricGateDialogContent(isPunchOut: isPunchOut),
    );
  }
}

class _BiometricGateDialogContent extends StatefulWidget {
  const _BiometricGateDialogContent({required this.isPunchOut});

  final bool isPunchOut;

  @override
  State<_BiometricGateDialogContent> createState() =>
      _BiometricGateDialogContentState();
}

class _BiometricGateDialogContentState
    extends State<_BiometricGateDialogContent> {
  bool _checking = false;
  String? _errorText;

  Future<void> _verify() async {
    setState(() {
      _checking = true;
      _errorText = null;
    });

    final action = widget.isPunchOut ? 'punch-out' : 'punch-in';
    final result = await DeviceBiometricService.authenticate(
      'Verify it\'s you before $action',
    );

    if (!mounted) return;

    if (result == DeviceBiometricResult.success) {
      Navigator.of(context).pop();
      return;
    }

    setState(() {
      _checking = false;
      _errorText = switch (result) {
        DeviceBiometricResult.cancelled => 'Cancelled. You can try again or skip.',
        DeviceBiometricResult.unavailable =>
          'Device biometrics are unavailable right now. You can skip and continue.',
        _ => 'Could not verify. You can try again or skip.',
      };
    });
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20.r)),
      backgroundColor: Colors.white,
      child: Padding(
        padding: EdgeInsets.all(24.w),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 64.w,
              height: 64.w,
              decoration: const BoxDecoration(
                color: Color(0xFFE8F5E9),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.fingerprint_rounded,
                color: const Color(0xFF0D6842),
                size: 34.sp,
              ),
            ),
            SizedBox(height: 16.h),
            Text(
              'Quick Device Check (Optional)',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF0F172A),
              ),
            ),
            SizedBox(height: 8.h),
            Text(
              'Confirm with your fingerprint or Face unlock before '
              '${widget.isPunchOut ? 'punch-out' : 'punch-in'}. This is optional '
              '— face verification will still run next.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 13.sp, color: const Color(0xFF64748B), height: 1.35),
            ),
            if (_errorText != null) ...[
              SizedBox(height: 12.h),
              Text(
                _errorText!,
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5.sp, color: const Color(0xFFB45309)),
              ),
            ],
            SizedBox(height: 20.h),
            SizedBox(
              width: double.infinity,
              height: 46.h,
              child: ElevatedButton.icon(
                onPressed: _checking ? null : _verify,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0D6842),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                ),
                icon: _checking
                    ? SizedBox(
                        width: 18.w,
                        height: 18.w,
                        child: const CircularProgressIndicator(
                          color: Colors.white,
                          strokeWidth: 2,
                        ),
                      )
                    : Icon(Icons.fingerprint_rounded, color: Colors.white, size: 18.sp),
                label: Text(
                  'Use Fingerprint / Face',
                  style: TextStyle(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ),
            SizedBox(height: 8.h),
            TextButton(
              onPressed: _checking ? null : () => Navigator.of(context).pop(),
              child: Text(
                'Skip',
                style: TextStyle(
                  fontSize: 13.5.sp,
                  fontWeight: FontWeight.w600,
                  color: const Color(0xFF64748B),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
