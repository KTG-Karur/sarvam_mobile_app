import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/front_camera_capture_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';
import 'package:sarvam/view/auth/face_training_screen.dart';

/// Captures a fresh front-camera photo before entering the application, or
/// (when [isPunchOut] is true) before ending the shift and logging out.
class FaceVerificationScreen extends StatefulWidget {
  const FaceVerificationScreen({super.key, this.isPunchOut = false});

  final bool isPunchOut;

  @override
  State<FaceVerificationScreen> createState() => _FaceVerificationScreenState();
}

class _FaceVerificationScreenState extends State<FaceVerificationScreen> {
  final FaceDetector _faceDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.accurate,
      enableLandmarks: true,
      enableContours: true,
      enableClassification: true,
    ),
  );
  Uint8List? _facePhoto;
  List<double>? _liveFeatures;
  bool _isCapturing = false;
  bool _isVerifying = false;
  bool _faceDetected = false;
  bool _isVerified = false;
  int _failedVerificationAttempts = 0;
  static const int _maxVerificationAttempts = 3;
  bool _hasStartedVerification = false;

  String _firstName = '';
  String _lastName = '';
  String _employeeId = '';
  String _role = '';

  Position? _position;
  bool _isLocating = false;
  String? _locationError;

  @override
  void initState() {
    super.initState();
    _fetchLocation();
    WidgetsBinding.instance.addPostFrameCallback((_) => _startAutomaticVerification());
  }

  Future<void> _startAutomaticVerification() async {
    if (_hasStartedVerification || _isVerifying || _isCapturing) return;
    _hasStartedVerification = true;
    await _loadProfile();
    if (!mounted) return;
    await _captureFace();
    if (mounted && _faceDetected && _liveFeatures != null) {
      await _verifyFace();
    }
  }

  Future<void> _loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    final bool isEnrolled = await FaceBiometricService.isFaceEnrolled();
    if (!isEnrolled && !widget.isPunchOut) {
      if (!mounted) return;
      Get.off(() => const FaceTrainingScreen(autoStart: true));
      return;
    }
    if (!mounted) return;
    setState(() {
      _firstName = prefs.getString('firstName') ?? '';
      _lastName = prefs.getString('lastName') ?? '';
      _employeeId = prefs.getString('employeeId') ?? '';
      _role = prefs.getString('rbacRoleName') ?? prefs.getString('role') ?? '';
    });
  }

  Future<void> _fetchLocation() async {
    setState(() {
      _isLocating = true;
      _locationError = null;
    });
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        setState(() => _locationError = 'Location services are turned off.');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        setState(() => _locationError = 'Location permission was not granted.');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      if (!mounted) return;
      setState(() => _position = position);
    } catch (_) {
      if (mounted) {
        setState(() => _locationError = 'Unable to fetch your location.');
      }
    } finally {
      if (mounted) setState(() => _isLocating = false);
    }
  }

  Future<void> _captureFace() async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      _showError('Face verification requires an Android or iOS device with camera support.');
      return;
    }
    setState(() => _isCapturing = true);
    try {
      final result = await Navigator.push<Map<String, dynamic>>(
        context,
        MaterialPageRoute(
          builder: (_) => const FrontCameraCaptureScreen(
            title: 'Face Verification',
            instruction: 'Align your face in the front camera circle',
          ),
        ),
      );

      if (result == null || !mounted) return;

      final String imagePath = result['path'];
      final Uint8List bytes = result['bytes'];

      final inputImage = InputImage.fromFilePath(imagePath);
      final faces = await _faceDetector.processImage(inputImage);

      if (!mounted) return;

      final imgWidth = inputImage.metadata?.size.width ?? 1080.0;
      final imgHeight = inputImage.metadata?.size.height ?? 1920.0;

      final qualityError = FaceBiometricService.validateFaceQuality(
        faces.isNotEmpty
            ? faces.first
            : Face(
                boundingBox: Rect.zero,
                landmarks: {},
                contours: {},
              ),
        faces.length,
        imageWidth: imgWidth,
        imageHeight: imgHeight,
      );

      if (qualityError != null) {
        _showError(qualityError);
        return;
      }

      final face = faces.first;
      final features = FaceBiometricService.extractFeatureVector(face);

      if (mounted) {
        setState(() {
          _facePhoto = bytes;
          _liveFeatures = features;
          _faceDetected = true;
        });
      }
    } on MissingPluginException {
      if (mounted) {
        _showError('Camera plugin not found on this device.');
      }
    } catch (e) {
      if (mounted) {
        _showError('Unable to process camera image ($e). Please try again.');
      }
    } finally {
      if (mounted) {
        setState(() => _isCapturing = false);
      }
    }
  }

  Future<void> _verifyFace() async {
    if (_isVerified || _isVerifying) return;
    if (_liveFeatures == null || !_faceDetected) {
      _showError(
        'Capture a clear photo with one detected face before continuing.',
      );
      return;
    }
    final prefs = await SharedPreferences.getInstance();
    final bool punchedInToday = hasPunchedInToday(prefs);
    final bool punchedOutToday = prefs.getString('lastPunchOutDate') == todayDateKey();

    if (widget.isPunchOut) {
      if (!punchedInToday) {
        _showError('Please Punch-In first.');
        return;
      }
      if (punchedOutToday) {
        // Punch-out is already done for today — this isn't a failure the
        // user needs to retry, just stale navigation. Take them onward
        // instead of leaving them stuck on the camera screen.
        await _showInfoAndContinue('You have already punched out today.');
        return;
      }
    } else {
      if (punchedInToday) {
        // Same as above but for punch-in: the face is presumably fine,
        // there's simply nothing left to do here today.
        await _showInfoAndContinue('You have already punched in today.');
        return;
      }
    }

    setState(() => _isVerifying = true);
    try {
      final nowTimeStr = _formatTime(DateTime.now());

      // Verify live captured face against Server API / enrolled face samples
      final matchResult = await FaceBiometricService.verifyFace(
        liveFeatures: _liveFeatures!,
        type: widget.isPunchOut ? 'PUNCH_OUT' : 'PUNCH_IN',
        latitude: _position?.latitude,
        longitude: _position?.longitude,
        deviceId: await (Get.isRegistered<AuthController>()
            ? Get.find<AuthController>()
            : Get.put(AuthController())).getOrCreateDeviceId(),
      );

      if (!matchResult.isMatch) {
        final lowerMessage = matchResult.message.toLowerCase();
        final bool alreadyDone = lowerMessage.contains('already punched in') ||
            lowerMessage.contains('already punched out');
        if (alreadyDone) {
          await _showInfoAndContinue(matchResult.message);
          return;
        }

        _failedVerificationAttempts++;
        if (_failedVerificationAttempts >= _maxVerificationAttempts) {
          Get.snackbar(
            'Verification Locked',
            'Maximum 3 failed attempts reached. Proceeding with MPIN session.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: Colors.orange,
            colorText: Colors.white,
            duration: const Duration(seconds: 3),
          );
          await Future.delayed(const Duration(seconds: 2));
          if (!mounted) return;
          final homeScreen = await resolveHomeScreen();
          Get.offAll(() => homeScreen);
          return;
        }

        _showError('Face match failed (Attempt $_failedVerificationAttempts/3). Tap Retry to scan again.');
        if (lowerMessage.contains('not enrolled')) {
          Future.delayed(const Duration(milliseconds: 800), () {
            Get.off(() => const FaceTrainingScreen(autoStart: true));
          });
        } else {
          setState(() {
            _facePhoto = null;
            _liveFeatures = null;
            _faceDetected = false;
            _hasStartedVerification = false;
          });
        }
        return;
      }

      _isVerified = true;

      Get.snackbar(
        '✅ Face Verified Successfully',
        widget.isPunchOut
            ? 'Shift completed successfully at $nowTimeStr.'
            : 'Attendance recorded successfully at $nowTimeStr.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
        duration: const Duration(seconds: 2),
      );

      if (widget.isPunchOut) {
        await prefs.setString('lastPunchOutDate', todayDateKey());
        await prefs.setString('lastPunchOutTime', nowTimeStr);
        Get.offAll(() => const MpinLoginScreen());
        return;
      }

      await prefs.setString('lastPunchInDate', todayDateKey());
      await prefs.setString('lastPunchInTime', nowTimeStr);

      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
    } finally {
      if (mounted) setState(() => _isVerifying = false);
    }
  }

  /// Shown when the attendance action for today is already done (punched
  /// in/out already) — informational, not an error, so it takes the user
  /// onward to where a successful action would have, rather than leaving
  /// them stuck on the camera screen or bouncing them into re-registration.
  Future<void> _showInfoAndContinue(String message) async {
    Get.snackbar(
      widget.isPunchOut ? 'Punch Out' : 'Punch In',
      message,
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFF008A3D),
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 8.r,
    );
    if (widget.isPunchOut) {
      Get.offAll(() => const MpinLoginScreen());
    } else {
      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
    }
  }

  void _showError(String message) => Get.snackbar(
    'Face verification',
    message,
    snackPosition: SnackPosition.BOTTOM,
    backgroundColor: Colors.redAccent,
    colorText: Colors.white,
    margin: EdgeInsets.all(16.w),
    borderRadius: 8.r,
  );

  @override
  void dispose() {
    _faceDetector.close();
    super.dispose();
  }

  String _formatDate(DateTime dt) {
    const months = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    return 'Today, ${dt.day} ${months[dt.month - 1]} ${dt.year}';
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final minute = dt.minute.toString().padLeft(2, '0');
    final second = dt.second.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute:$second $period';
  }

  @override
  Widget build(BuildContext context) {
    final busy = _isCapturing || _isVerifying;
    final now = DateTime.now();
    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.only(bottom: 24.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  _header(busy),
                  Positioned(
                    left: 16.w,
                    right: 16.w,
                    bottom: -34.h,
                    child: _profileCard(),
                  ),
                ],
              ),
              SizedBox(height: 46.h),
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          _formatDate(now),
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF10472A),
                          ),
                        ),
                        Row(
                          children: [
                            Icon(
                              Icons.access_time_rounded,
                              size: 14.sp,
                              color: const Color(0xFF008A3D),
                            ),
                            SizedBox(width: 4.w),
                            Text(
                              _formatTime(now),
                              style: TextStyle(
                                fontSize: 12.sp,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF008A3D),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    SizedBox(height: 14.h),
                    _faceCaptureArea(busy),
                    SizedBox(height: 14.h),
                    _verificationStatusCard(),
                    SizedBox(height: 12.h),
                    _locationCard(),
                    SizedBox(height: 14.h),
                    _attendanceStatusRow(),
                    SizedBox(height: 12.h),
                    _punchButton(busy),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header(bool busy) => Container(
    width: double.infinity,
    padding: EdgeInsets.fromLTRB(4.w, 6.h, 16.w, 40.h),
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        colors: [Color(0xFF008A3D), Color(0xFF0D6842)],
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
      ),
    ),
    child: Row(
      children: [
        IconButton(
          onPressed: busy ? null : Get.back,
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Attendance',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 19.sp,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                widget.isPunchOut
                    ? 'Face verification to punch out'
                    : 'Face verification to punch in',
                style: TextStyle(
                  color: const Color(0xFFD8F0E3),
                  fontSize: 11.sp,
                ),
              ),
            ],
          ),
        ),
        Icon(Icons.verified_user_outlined, color: Colors.white, size: 22.sp),
      ],
    ),
  );

  Widget _profileCard() {
    final name = '$_firstName $_lastName'.trim();
    final initials =
        ((_firstName.isNotEmpty ? _firstName[0] : '') +
                (_lastName.isNotEmpty ? _lastName[0] : ''))
            .toUpperCase();
    final subtitleParts = <String>[
      if (_employeeId.isNotEmpty) 'EMP ID: $_employeeId',
      if (_role.isNotEmpty) _role,
    ];
    return Container(
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: .08),
            blurRadius: 14,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 26.r,
            backgroundColor: const Color(0xFFE4F5EB),
            child: Text(
              initials.isEmpty ? 'U' : initials,
              style: TextStyle(
                color: const Color(0xFF0D6842),
                fontWeight: FontWeight.w800,
                fontSize: 16.sp,
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? 'User' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15.sp,
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF10472A),
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  subtitleParts.isEmpty ? '—' : subtitleParts.join(' • '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11.sp,
                    color: const Color(0xFF4B8A68),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _faceCaptureArea(bool busy) => Container(
    width: double.infinity,
    height: 300.h,
    clipBehavior: Clip.antiAlias,
    decoration: BoxDecoration(
      color: const Color(0xFF10241B),
      borderRadius: BorderRadius.circular(24.r),
      border: Border.all(color: const Color(0xFF2E5B45)),
    ),
    child: Stack(
      alignment: Alignment.center,
      children: [
        if (_facePhoto != null)
          Positioned.fill(child: Image.memory(_facePhoto!, fit: BoxFit.cover)),
        if (_facePhoto == null)
          Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.face_retouching_natural_outlined,
                  size: 110.sp,
                  color: const Color(0xFF6FBF95),
                ),
                SizedBox(height: 10.h),
                Text(
                  'Scanning your face automatically',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 13.sp,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  'Keep one well-lit face inside the frame',
                  style: TextStyle(
                    color: const Color(0xFFA9CFBB),
                    fontSize: 10.sp,
                  ),
                ),
              ],
            ),
          ),

        Positioned(
          top: 16.h,
          child: _StatusPill(
            label: _isVerified
                ? '✅ FACE VERIFIED'
                : (_isVerifying
                    ? 'VERIFYING...'
                    : (_isCapturing
                        ? 'OPENING CAMERA'
                        : (_faceDetected
                            ? 'FACE DETECTED • KEEP STEADY'
                            : 'READY TO SCAN'))),
            active: _isCapturing || _isVerifying,
          ),
        ),
        if (_facePhoto != null && _faceDetected)
          IgnorePointer(
            child: SizedBox(
              width: 210.w,
              height: 270.h,
              child: CustomPaint(painter: _FaceMeshPainter()),
            ),
          ),
        if (_facePhoto != null)
          Positioned(
            bottom: 14.h,
            child: TextButton.icon(
              onPressed: busy ? null : _captureFace,
              icon: const Icon(
                Icons.refresh_rounded,
                size: 16,
                color: Colors.white,
              ),
              label: const Text(
                'Retake',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: TextButton.styleFrom(
                backgroundColor: const Color(0x33FFFFFF),
              ),
            ),
          ),
        if (_isVerifying)
          const ColoredBox(
            color: Color(0x99000000),
            child: Center(
              child: CircularProgressIndicator(color: Colors.white),
            ),
          ),
      ],
    ),
  );

  Widget _sectionCard({
    required String title,
    required Widget child,
    Widget? trailing,
  }) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(14.r),
      border: Border.all(color: const Color(0xFFD2E9DB)),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w800,
                color: const Color(0xFF10472A),
              ),
            ),
            if (trailing != null) trailing,
          ],
        ),
        SizedBox(height: 10.h),
        child,
      ],
    ),
  );

  Widget _verificationStatusCard() => _sectionCard(
    title: 'Verification Status',
    child: Column(
      children: [
        _statusRow(Icons.face_outlined, 'Face Detected', _faceDetected),
        Divider(height: 18.h, color: const Color(0xFFE2F1E8)),
        _statusRow(
          Icons.photo_camera_outlined,
          'Photo Captured',
          _facePhoto != null,
        ),
        Divider(height: 18.h, color: const Color(0xFFE2F1E8)),
        _statusRow(
          Icons.my_location_outlined,
          'GPS Location',
          _position != null,
        ),
      ],
    ),
  );

  Widget _statusRow(IconData icon, String label, bool done) => Row(
    children: [
      Icon(icon, size: 17.sp, color: const Color(0xFF4B8A68)),
      SizedBox(width: 10.w),
      Expanded(
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            color: const Color(0xFF10472A),
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      Icon(
        done ? Icons.check_circle : Icons.radio_button_unchecked,
        size: 17.sp,
        color: done ? const Color(0xFF008A3D) : const Color(0xFFB8CFC0),
      ),
    ],
  );

  Widget _locationCard() {
    final position = _position;
    return _sectionCard(
      title: 'Current Location',
      trailing: _isLocating
          ? SizedBox(
              width: 14.w,
              height: 14.w,
              child: const CircularProgressIndicator(
                strokeWidth: 2,
                color: Color(0xFF008A3D),
              ),
            )
          : IconButton(
              onPressed: _fetchLocation,
              icon: const Icon(
                Icons.refresh_rounded,
                size: 18,
                color: Color(0xFF008A3D),
              ),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
            ),
      child: position == null
          ? Text(
              _locationError ??
                  (_isLocating
                      ? 'Fetching your location…'
                      : 'Location not captured yet.'),
              style: TextStyle(fontSize: 11.sp, color: const Color(0xFF4B8A68)),
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12.r),
                  child: SizedBox(
                    height: 110.h,
                    child: GoogleMap(
                      initialCameraPosition: CameraPosition(
                        target: LatLng(position.latitude, position.longitude),
                        zoom: 15,
                      ),
                      markers: {
                        Marker(
                          markerId: const MarkerId('me'),
                          position: LatLng(
                            position.latitude,
                            position.longitude,
                          ),
                        ),
                      },
                      myLocationButtonEnabled: false,
                      zoomControlsEnabled: false,
                      scrollGesturesEnabled: false,
                      liteModeEnabled: true,
                    ),
                  ),
                ),
                SizedBox(height: 8.h),
                Text(
                  '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}',
                  style: TextStyle(
                    fontSize: 11.sp,
                    fontWeight: FontWeight.w700,
                    color: const Color(0xFF10472A),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _attendanceStatusRow() => Row(
    mainAxisAlignment: MainAxisAlignment.spaceBetween,
    children: [
      Text(
        'Attendance Status',
        style: TextStyle(
          fontSize: 13.sp,
          fontWeight: FontWeight.w700,
          color: const Color(0xFF10472A),
        ),
      ),
      Container(
        padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 5.h),
        decoration: BoxDecoration(
          color: widget.isPunchOut
              ? const Color(0xFFFDE8E8)
              : const Color(0xFFFFF3E0),
          borderRadius: BorderRadius.circular(20.r),
        ),
        child: Text(
          widget.isPunchOut ? 'Ready to Punch Out' : 'Not Punched',
          style: TextStyle(
            fontSize: 10.sp,
            fontWeight: FontWeight.w700,
            color: widget.isPunchOut
                ? const Color(0xFFC5221F)
                : const Color(0xFFC98A00),
          ),
        ),
      ),
    ],
  );

  Widget _punchButton(bool busy) {
    final bool disabled = busy || _isVerifying || _isVerified;

    final color = _isVerified
        ? const Color(0xFF008A3D)
        : (_failedVerificationAttempts >= _maxVerificationAttempts
            ? Colors.orange
            : (widget.isPunchOut
                ? const Color(0xFFC5221F)
                : const Color(0xFF008A3D)));

    final String buttonLabel = _isVerified
        ? 'VERIFIED ✓'
        : (_isVerifying
            ? 'Verifying...'
            : (_failedVerificationAttempts >= _maxVerificationAttempts
                ? 'PROCEED TO DASHBOARD (MPIN SESSION)'
                : (_failedVerificationAttempts > 0
                    ? 'Try Again (Attempt ${_failedVerificationAttempts + 1}/3)'
                    : 'Verify Face')));

    return SizedBox(
      width: double.infinity,
      height: 62.h,
      child: ElevatedButton(
        onPressed: disabled
            ? null
            : () async {
                if (_failedVerificationAttempts >= _maxVerificationAttempts) {
                  final homeScreen = await resolveHomeScreen();
                  if (!mounted) return;
                  Get.offAll(() => homeScreen);
                  return;
                }
                // If no face has been captured, open the camera immediately.
                if (_liveFeatures == null || !_faceDetected) {
                  await _captureFace();
                }

                // If face capture succeeded, verify automatically.
                if (_liveFeatures != null && _faceDetected && !_isVerified) {
                  await _verifyFace();
                }
              },
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          foregroundColor: Colors.white,
          disabledBackgroundColor: color.withValues(alpha: 0.6),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16.r),
          ),
        ),
        child: _isVerifying
            ? Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 20.w,
                    height: 20.w,
                    child: const CircularProgressIndicator(
                      color: Colors.white,
                      strokeWidth: 2,
                    ),
                  ),
                  SizedBox(width: 10.w),
                  Text(
                    'Verifying...',
                    style: TextStyle(fontSize: 15.sp, fontWeight: FontWeight.bold),
                  ),
                ],
              )
            : Text(
                buttonLabel,
                style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.bold),
              ),
      ),
    );
  }
}

class _FaceMeshPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = const Color(0xFF8CFFD0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.4;
    final pointPaint = Paint()..color = const Color(0xFFECFFF6);
    final points = <Offset>[
      Offset(size.width * .24, size.height * .31),
      Offset(size.width * .40, size.height * .28),
      Offset(size.width * .61, size.height * .28),
      Offset(size.width * .76, size.height * .31),
      Offset(size.width * .34, size.height * .48),
      Offset(size.width * .50, size.height * .43),
      Offset(size.width * .66, size.height * .48),
      Offset(size.width * .35, size.height * .66),
      Offset(size.width * .50, size.height * .72),
      Offset(size.width * .65, size.height * .66),
    ];
    final lines = <List<int>>[
      [0, 1],
      [1, 5],
      [5, 2],
      [2, 3],
      [0, 4],
      [4, 5],
      [5, 6],
      [6, 3],
      [4, 7],
      [7, 8],
      [8, 9],
      [9, 6],
      [1, 4],
      [2, 6],
    ];
    for (final line in lines) {
      canvas.drawLine(points[line[0]], points[line[1]], paint);
    }
    for (final point in points) {
      canvas.drawCircle(point, 3, pointPaint);
      canvas.drawCircle(point, 4.5, paint);
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.active});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
    decoration: BoxDecoration(
      color: const Color(0xD9102E22),
      borderRadius: BorderRadius.circular(30),
      border: Border.all(color: const Color(0xFF6EA98E)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (active)
          const SizedBox(
            width: 10,
            height: 10,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: Color(0xFF55D693),
            ),
          )
        else
          const Icon(Icons.check_circle, size: 13, color: Color(0xFF55D693)),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w700,
            letterSpacing: .5,
          ),
        ),
      ],
    ),
  );
}
