import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

import 'package:sarvam/services/face_biometric_service.dart';

/// The live scanning/matching lifecycle for the embedded face camera.
enum _ScanPhase {
  initializing,
  cameraError,
  scanning,
  verifying,
  matched,
  notMatched,
  apiError,
}

/// Full-screen live Face Verification & Attendance flow: opens the front
/// camera, detects + auto-captures the employee's face in real time (no
/// manual shutter), verifies it against the server-enrolled template, then
/// — only once verified — lets the employee Punch In (or, when
/// [isPunchOut] is true, Punch Out) with GPS location attached.
class FaceVerificationScreen extends StatefulWidget {
  const FaceVerificationScreen({super.key, this.isPunchOut = false});

  final bool isPunchOut;

  @override
  State<FaceVerificationScreen> createState() => _FaceVerificationScreenState();
}

class _FaceVerificationScreenState extends State<FaceVerificationScreen>
    with WidgetsBindingObserver {
  // --- Camera / ML Kit ---
  CameraController? _cameraController;
  List<CameraDescription> _cameras = [];
  late final FaceDetector _faceDetector;
  bool _isProcessingFrame = false;
  DateTime? _lastFrameProcessingTime;
  String? _cameraErrorMessage;

  static const int _holdMillis = 450;

  _ScanPhase _phase = _ScanPhase.initializing;
  FaceQualityReport? _latestReport;
  final List<Face> _recentFrames = [];
  DateTime? _poseHoldStartTime;
  double _holdProgress = 0.0;

  FaceMatchResult? _matchResult;
  String? _apiErrorMessage;
  bool _isPunching = false;

  // --- Profile ---
  String _firstName = '';
  String _lastName = '';
  String _employeeId = '';
  String _role = '';

  // --- Location ---
  Position? _position;
  bool _isLocating = false;
  String? _locationError;

  // --- Today's attendance (local device record) ---
  String? _punchInIso;
  String? _punchInLocationText;
  String? _punchOutIso;
  Timer? _tickTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        performanceMode: FaceDetectorMode.accurate,
        enableLandmarks: true,
        enableContours: true,
        enableClassification: true,
        enableTracking: true,
      ),
    );
    _loadProfile();
    _fetchLocation();
    _loadTodayAttendance();
    _initCamera();
    _tickTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _punchInIso != null && _punchOutIso == null) setState(() {});
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tickTimer?.cancel();
    _stopImageStream();
    _cameraController?.dispose();
    _faceDetector.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_cameraController == null || !_cameraController!.value.isInitialized) {
      return;
    }
    if (state == AppLifecycleState.inactive) {
      _stopImageStream();
      _cameraController?.dispose();
    } else if (state == AppLifecycleState.resumed && _phase != _ScanPhase.matched) {
      _initCamera();
    }
  }

  Future<void> _loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _firstName = prefs.getString('firstName') ?? '';
      _lastName = prefs.getString('lastName') ?? '';
      _employeeId = prefs.getString('employeeId') ?? '';
      _role = prefs.getString('rbacRoleName') ?? prefs.getString('role') ?? '';
    });
  }

  Future<void> _loadTodayAttendance() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    if (hasPunchedInToday(prefs)) {
      setState(() {
        _punchInIso = prefs.getString('lastPunchInTime');
        _punchInLocationText = prefs.getString('lastPunchInLocation');
        _punchOutIso = prefs.getString('lastPunchOutTime');
      });
    } else {
      setState(() {
        _punchInIso = null;
        _punchInLocationText = null;
        _punchOutIso = null;
      });
    }
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

  // ---------------------------------------------------------------------
  // Camera lifecycle
  // ---------------------------------------------------------------------

  Future<void> _initCamera() async {
    if (kIsWeb ||
        (defaultTargetPlatform != TargetPlatform.android &&
            defaultTargetPlatform != TargetPlatform.iOS)) {
      setState(() {
        _phase = _ScanPhase.cameraError;
        _cameraErrorMessage = 'Face verification requires a device camera (Android/iOS).';
      });
      return;
    }

    setState(() {
      _phase = _ScanPhase.initializing;
      _cameraErrorMessage = null;
    });

    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() {
          _cameraErrorMessage = 'No camera found on this device.';
          _phase = _ScanPhase.cameraError;
        });
        return;
      }

      final frontCameraIndex = _cameras.indexWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );
      final camera = frontCameraIndex != -1 ? _cameras[frontCameraIndex] : _cameras[0];

      final controller = CameraController(
        camera,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.nv21
            : ImageFormatGroup.bgra8888,
      );

      _cameraController = controller;
      await controller.initialize();
      if (!mounted) return;

      setState(() => _phase = _ScanPhase.scanning);
      _startImageStream();
    } on MissingPluginException {
      if (mounted) {
        setState(() {
          _cameraErrorMessage =
              'Camera plugin unavailable on this device. Please try a different device.';
          _phase = _ScanPhase.cameraError;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _cameraErrorMessage =
              'Failed to access front camera. Please grant camera permission in system settings.';
          _phase = _ScanPhase.cameraError;
        });
      }
    }
  }

  void _startImageStream() {
    if (_cameraController == null || !_cameraController!.value.isInitialized) return;
    if (_cameraController!.value.isStreamingImages) return;
    _cameraController!.startImageStream(_processCameraFrame);
  }

  void _stopImageStream() {
    if (_cameraController != null && _cameraController!.value.isStreamingImages) {
      try {
        _cameraController!.stopImageStream();
      } catch (_) {}
    }
  }

  Future<void> _processCameraFrame(CameraImage image) async {
    if (_isProcessingFrame || _phase != _ScanPhase.scanning) return;

    final now = DateTime.now();
    if (_lastFrameProcessingTime != null &&
        now.difference(_lastFrameProcessingTime!).inMilliseconds < 180) {
      return;
    }
    _lastFrameProcessingTime = now;
    _isProcessingFrame = true;

    try {
      final inputImage = _inputImageFromCameraImage(image);
      if (inputImage == null) {
        _isProcessingFrame = false;
        return;
      }

      final faces = await _faceDetector.processImage(inputImage);
      if (!mounted) return;

      final screenSize = MediaQuery.of(context).size;
      final ovalBounds = Rect.fromCenter(
        center: Offset(screenSize.width / 2, screenSize.height * 0.34),
        width: 280.w,
        height: 280.w,
      );

      final Face? primaryFace = faces.isNotEmpty ? faces.first : null;

      final report = FaceBiometricService.evaluateRealTimeQuality(
        face: primaryFace,
        totalFacesFound: faces.length,
        imageWidth: image.width.toDouble(),
        imageHeight: image.height.toDouble(),
        ovalBounds: ovalBounds,
      );

      if (primaryFace != null) {
        _recentFrames.add(primaryFace);
        if (_recentFrames.length > 12) _recentFrames.removeAt(0);
      }

      final isLive = FaceBiometricService.checkPassiveMicroMovementLiveness(_recentFrames);

      if (report.isQualityValid && isLive) {
        _poseHoldStartTime ??= DateTime.now();
        final elapsedMs = DateTime.now().difference(_poseHoldStartTime!).inMilliseconds;
        final progress = (elapsedMs / _holdMillis).clamp(0.0, 1.0);
        setState(() => _holdProgress = progress);

        if (progress >= 1.0 && primaryFace != null) {
          _captureAndVerify(primaryFace);
        }
      } else {
        _poseHoldStartTime = null;
        if (_holdProgress != 0) setState(() => _holdProgress = 0.0);
      }

      setState(() => _latestReport = report);
    } catch (e) {
      if (kDebugMode) print('Frame processing error: $e');
    } finally {
      _isProcessingFrame = false;
    }
  }

  InputImage? _inputImageFromCameraImage(CameraImage image) {
    if (_cameraController == null) return null;
    final camera = _cameraController!.description;

    final sensorOrientation = camera.sensorOrientation;
    final rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
    if (rotation == null) return null;

    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null) return null;
    if (image.planes.isEmpty) return null;

    final WriteBuffer allBytes = WriteBuffer();
    for (final Plane plane in image.planes) {
      allBytes.putUint8List(plane.bytes);
    }
    final bytes = allBytes.done().buffer.asUint8List();

    return InputImage.fromBytes(
      bytes: bytes,
      metadata: InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: image.planes[0].bytesPerRow,
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Capture + server verification
  // ---------------------------------------------------------------------

  Future<void> _captureAndVerify(Face face) async {
    setState(() => _phase = _ScanPhase.verifying);
    _stopImageStream();
    HapticFeedback.mediumImpact();

    final features = FaceBiometricService.extractFeatureVector(face);

    try {
      final matchResult = await FaceBiometricService.verifyFaceOnServer(
        liveFeatures: features,
        isPunchOut: widget.isPunchOut,
        latitude: _position?.latitude,
        longitude: _position?.longitude,
      );

      if (!mounted) return;

      if (matchResult.isMatch) {
        HapticFeedback.heavyImpact();
        setState(() {
          _matchResult = matchResult;
          _phase = _ScanPhase.matched;
        });
      } else {
        HapticFeedback.vibrate();
        setState(() {
          _matchResult = matchResult;
          _phase = _ScanPhase.notMatched;
        });
      }
    } on FaceVerificationApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _apiErrorMessage = e.message;
        _phase = _ScanPhase.apiError;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _apiErrorMessage =
            'Could not reach the server to verify your face. Please check your connection and try again.';
        _phase = _ScanPhase.apiError;
      });
    }
  }

  void _rescan() {
    setState(() {
      _phase = _ScanPhase.scanning;
      _matchResult = null;
      _apiErrorMessage = null;
      _holdProgress = 0.0;
      _poseHoldStartTime = null;
      _recentFrames.clear();
    });
    _startImageStream();
  }

  // ---------------------------------------------------------------------
  // Punch In / Punch Out
  // ---------------------------------------------------------------------

  String get _locationText => _position != null
      ? '${_position!.latitude.toStringAsFixed(5)}, ${_position!.longitude.toStringAsFixed(5)}'
      : 'Unknown';

  Future<void> _punchIn() async {
    setState(() => _isPunching = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final now = DateTime.now();
      await prefs.setString('lastPunchInDate', todayDateKey());
      await prefs.setString('lastPunchInTime', now.toIso8601String());
      await prefs.setString('lastPunchInLocation', _locationText);
      await prefs.remove('lastPunchOutTime');
      await prefs.remove('lastPunchOutLocation');

      if (!mounted) return;
      await _showResultDialog(
        icon: Icons.check_circle_rounded,
        iconColor: const Color(0xFF00C853),
        title: 'Punch In Successful',
        message: 'Your attendance has been recorded at ${_formatTime(now)}.',
        buttonLabel: 'CONTINUE TO APP',
      );
      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
    } finally {
      if (mounted) setState(() => _isPunching = false);
    }
  }

  Future<void> _punchOut() async {
    setState(() => _isPunching = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final now = DateTime.now();
      final workingHoursText = _computeWorkingHoursText(now);

      await prefs.setString('lastPunchOutTime', now.toIso8601String());
      await prefs.setString('lastPunchOutLocation', _locationText);

      if (!mounted) return;
      await _showResultDialog(
        icon: Icons.check_circle_rounded,
        iconColor: const Color(0xFF00C853),
        title: 'Punch Out Successful',
        message:
            'Punched out at ${_formatTime(now)}.\nTotal working hours today: $workingHoursText',
        buttonLabel: 'DONE',
      );

      await prefs.remove('lastPunchInDate');
      await prefs.remove('lastPunchInTime');
      await prefs.remove('lastPunchInLocation');
      await prefs.remove('lastPunchOutTime');
      await prefs.remove('lastPunchOutLocation');

      final authController = Get.isRegistered<AuthController>()
          ? Get.find<AuthController>()
          : Get.put(AuthController());
      await authController.logout();
    } finally {
      if (mounted) setState(() => _isPunching = false);
    }
  }

  Future<void> _showResultDialog({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String message,
    required String buttonLabel,
  }) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20.r)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: iconColor, size: 72.sp),
            SizedBox(height: 12.h),
            Text(
              title,
              style: GoogleFonts.poppins(
                fontSize: 18.sp,
                fontWeight: FontWeight.w700,
                color: const Color(0xFF0D6842),
              ),
            ),
            SizedBox(height: 8.h),
            Text(
              message,
              textAlign: TextAlign.center,
              style: GoogleFonts.poppins(fontSize: 12.sp, color: Colors.black87),
            ),
            SizedBox(height: 20.h),
            SizedBox(
              width: double.infinity,
              height: 46.h,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0D6842),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
                ),
                onPressed: () => Navigator.pop(ctx),
                child: Text(
                  buttonLabel,
                  style: GoogleFonts.poppins(fontWeight: FontWeight.w700, color: Colors.white),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _computeWorkingHoursText(DateTime punchOutTime) {
    if (_punchInIso == null) return '--';
    final punchIn = DateTime.tryParse(_punchInIso!);
    if (punchIn == null) return '--';
    final duration = punchOutTime.difference(punchIn);
    return _formatDuration(duration);
  }

  String _formatDuration(Duration d) {
    if (d.isNegative) return '--';
    final hours = d.inHours;
    final minutes = d.inMinutes % 60;
    return '${hours}h ${minutes}m';
  }

  @override
  Widget build(BuildContext context) {
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
                  _header(),
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
                            Icon(Icons.access_time_rounded, size: 14.sp, color: const Color(0xFF008A3D)),
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
                    _faceScanCard(),
                    SizedBox(height: 14.h),
                    _verificationStatusCard(),
                    SizedBox(height: 12.h),
                    _locationCard(),
                    SizedBox(height: 12.h),
                    _todaysAttendanceCard(),
                    SizedBox(height: 14.h),
                    _punchButton(),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _header() => Container(
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
          onPressed: _isPunching ? null : Get.back,
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Attendance',
                style: TextStyle(color: Colors.white, fontSize: 19.sp, fontWeight: FontWeight.w800),
              ),
              Text(
                widget.isPunchOut ? 'Face verification to punch out' : 'Face verification to punch in',
                style: TextStyle(color: const Color(0xFFD8F0E3), fontSize: 11.sp),
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
    final initials = ((_firstName.isNotEmpty ? _firstName[0] : '') +
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
          BoxShadow(color: Colors.black.withValues(alpha: .08), blurRadius: 14, offset: const Offset(0, 6)),
        ],
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 26.r,
            backgroundColor: const Color(0xFFE4F5EB),
            child: Text(
              initials.isEmpty ? 'U' : initials,
              style: TextStyle(color: const Color(0xFF0D6842), fontWeight: FontWeight.w800, fontSize: 16.sp),
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
                  style: TextStyle(fontSize: 15.sp, fontWeight: FontWeight.w800, color: const Color(0xFF10472A)),
                ),
                SizedBox(height: 2.h),
                Text(
                  subtitleParts.isEmpty ? '—' : subtitleParts.join(' • '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11.sp, color: const Color(0xFF4B8A68)),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------
  // Face scan card — large circular live camera preview
  // ---------------------------------------------------------------------

  Color get _ringColor {
    switch (_phase) {
      case _ScanPhase.matched:
        return const Color(0xFF00C853);
      case _ScanPhase.notMatched:
      case _ScanPhase.apiError:
      case _ScanPhase.cameraError:
        return const Color(0xFFFF3D00);
      case _ScanPhase.verifying:
        return const Color(0xFFFFB300);
      case _ScanPhase.scanning:
        if (_latestReport == null) return Colors.white54;
        if (_latestReport!.isQualityValid) return const Color(0xFF00C853);
        if (_latestReport!.status == FaceQualityStatus.offCenter ||
            _latestReport!.status == FaceQualityStatus.tooFar ||
            _latestReport!.status == FaceQualityStatus.tooClose) {
          return const Color(0xFFFFB300);
        }
        return const Color(0xFFFF3D00);
      case _ScanPhase.initializing:
        return Colors.white54;
    }
  }

  String get _statusMessage {
    switch (_phase) {
      case _ScanPhase.initializing:
        return 'Starting camera…';
      case _ScanPhase.cameraError:
        return _cameraErrorMessage ?? 'Camera unavailable.';
      case _ScanPhase.scanning:
        return _latestReport?.message ?? 'Position your face inside the circle.';
      case _ScanPhase.verifying:
        return 'Verifying your identity…';
      case _ScanPhase.matched:
        return '✓ Face Verified Successfully';
      case _ScanPhase.notMatched:
        return '✕ Face Not Matched – Please Try Again';
      case _ScanPhase.apiError:
        return _apiErrorMessage ?? 'Verification failed.';
    }
  }

  Widget _faceScanCard() => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(vertical: 22.h),
    decoration: BoxDecoration(
      color: const Color(0xFF10241B),
      borderRadius: BorderRadius.circular(24.r),
      border: Border.all(color: const Color(0xFF2E5B45)),
    ),
    child: Column(
      children: [
        SizedBox(
          width: 260.w,
          height: 260.w,
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (_cameraController != null && _cameraController!.value.isInitialized)
                ClipOval(
                  child: SizedBox(
                    width: 252.w,
                    height: 252.w,
                    child: FittedBox(
                      fit: BoxFit.cover,
                      child: SizedBox(
                        width: _cameraController!.value.previewSize?.height ?? 252.w,
                        height: _cameraController!.value.previewSize?.width ?? 252.w,
                        child: CameraPreview(_cameraController!),
                      ),
                    ),
                  ),
                )
              else
                Container(
                  width: 252.w,
                  height: 252.w,
                  decoration: const BoxDecoration(color: Color(0xFF0B160F), shape: BoxShape.circle),
                  child: _phase == _ScanPhase.cameraError
                      ? Icon(Icons.camera_alt_outlined, size: 56.sp, color: Colors.white38)
                      : const CircularProgressIndicator(color: Color(0xFF00C853)),
                ),

              // Tint overlay reflecting match state
              if (_phase == _ScanPhase.matched || _phase == _ScanPhase.notMatched)
                Container(
                  width: 252.w,
                  height: 252.w,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (_phase == _ScanPhase.matched ? const Color(0xFF00C853) : const Color(0xFFFF3D00))
                        .withValues(alpha: 0.22),
                  ),
                ),

              // Progress / result ring
              IgnorePointer(
                child: SizedBox(
                  width: 260.w,
                  height: 260.w,
                  child: CustomPaint(
                    painter: _ScanRingPainter(
                      color: _ringColor,
                      progress: _phase == _ScanPhase.scanning ? _holdProgress : 0.0,
                      pulsing: _phase == _ScanPhase.scanning && _holdProgress == 0.0,
                    ),
                  ),
                ),
              ),

              if (_phase == _ScanPhase.verifying)
                const CircularProgressIndicator(color: Color(0xFFFFB300)),

              if (_phase == _ScanPhase.matched)
                Icon(Icons.check_circle_rounded, color: const Color(0xFF00C853), size: 64.sp),

              if (_phase == _ScanPhase.notMatched || _phase == _ScanPhase.apiError)
                Icon(Icons.cancel_rounded, color: const Color(0xFFFF3D00), size: 64.sp),
            ],
          ),
        ),
        SizedBox(height: 16.h),
        Text(
          _statusMessage,
          textAlign: TextAlign.center,
          style: GoogleFonts.poppins(
            fontSize: 13.sp,
            fontWeight: FontWeight.w700,
            color: _phase == _ScanPhase.matched
                ? const Color(0xFF6FFFAE)
                : (_phase == _ScanPhase.notMatched || _phase == _ScanPhase.apiError)
                ? const Color(0xFFFF8A65)
                : Colors.white,
          ),
        ),
        if (_matchResult != null && (_phase == _ScanPhase.matched || _phase == _ScanPhase.notMatched)) ...[
          SizedBox(height: 4.h),
          Text(
            'Match Score: ${_matchResult!.scorePercent.toStringAsFixed(1)}%',
            style: GoogleFonts.poppins(fontSize: 11.sp, color: const Color(0xFFA9CFBB)),
          ),
        ],
        if (_phase == _ScanPhase.notMatched || _phase == _ScanPhase.apiError) ...[
          SizedBox(height: 12.h),
          TextButton.icon(
            onPressed: _rescan,
            icon: const Icon(Icons.refresh_rounded, size: 16, color: Colors.white),
            label: const Text('RETRY', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
            style: TextButton.styleFrom(backgroundColor: const Color(0x33FFFFFF)),
          ),
        ],
        if (_phase == _ScanPhase.cameraError) ...[
          SizedBox(height: 12.h),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF00C853)),
            onPressed: _initCamera,
            child: const Text('RETRY CAMERA'),
          ),
        ],
      ],
    ),
  );

  // ---------------------------------------------------------------------
  // Status / location / attendance cards
  // ---------------------------------------------------------------------

  Widget _sectionCard({required String title, required Widget child, Widget? trailing}) => Container(
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
              style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w800, color: const Color(0xFF10472A)),
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
        _statusRow(Icons.face_outlined, 'Face Detected', _latestReport != null || _matchResult != null),
        Divider(height: 18.h, color: const Color(0xFFE2F1E8)),
        _statusRow(
          Icons.visibility_outlined,
          'Liveness Verified',
          _phase == _ScanPhase.matched || _phase == _ScanPhase.notMatched,
        ),
        Divider(height: 18.h, color: const Color(0xFFE2F1E8)),
        _statusRow(Icons.my_location_outlined, 'GPS Location', _position != null),
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
          style: TextStyle(fontSize: 12.sp, color: const Color(0xFF10472A), fontWeight: FontWeight.w600),
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
              child: const CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF008A3D)),
            )
          : IconButton(
              onPressed: _fetchLocation,
              icon: const Icon(Icons.refresh_rounded, size: 18, color: Color(0xFF008A3D)),
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(),
            ),
      child: position == null
          ? Text(
              _locationError ?? (_isLocating ? 'Fetching your location…' : 'Location not captured yet.'),
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
                      initialCameraPosition:
                          CameraPosition(target: LatLng(position.latitude, position.longitude), zoom: 15),
                      markers: {
                        Marker(
                          markerId: const MarkerId('me'),
                          position: LatLng(position.latitude, position.longitude),
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
                  _locationText,
                  style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: const Color(0xFF10472A)),
                ),
              ],
            ),
    );
  }

  Widget _todaysAttendanceCard() {
    final punchIn = _punchInIso != null ? DateTime.tryParse(_punchInIso!) : null;
    final punchOut = _punchOutIso != null ? DateTime.tryParse(_punchOutIso!) : null;
    final workingHours = punchIn == null
        ? '--'
        : _formatDuration((punchOut ?? DateTime.now()).difference(punchIn));

    return _sectionCard(
      title: "Today's Attendance",
      child: Column(
        children: [
          _attendanceRow('Employee Name', '$_firstName $_lastName'.trim().isEmpty ? '—' : '$_firstName $_lastName'),
          _attendanceRow('Employee ID', _employeeId.isEmpty ? '—' : _employeeId),
          _attendanceRow('Punch In', punchIn != null ? _formatTime(punchIn) : '--'),
          _attendanceRow('Punch Out', punchOut != null ? _formatTime(punchOut) : '--'),
          _attendanceRow('Working Hours', workingHours, valueColor: const Color(0xFF008A3D)),
          _attendanceRow('Location', _punchInLocationText ?? (_position != null ? _locationText : '--')),
        ],
      ),
    );
  }

  Widget _attendanceRow(String label, String value, {Color? valueColor}) => Padding(
    padding: EdgeInsets.symmetric(vertical: 4.h),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF4B8A68))),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.w700,
              color: valueColor ?? const Color(0xFF10472A),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _punchButton() {
    final color = widget.isPunchOut ? const Color(0xFFC5221F) : const Color(0xFF008A3D);
    final canPunch = _phase == _ScanPhase.matched && !_isPunching;

    return SizedBox(
      width: double.infinity,
      height: 62.h,
      child: ElevatedButton(
        onPressed: canPunch ? (widget.isPunchOut ? _punchOut : _punchIn) : null,
        style: ElevatedButton.styleFrom(
          backgroundColor: color,
          disabledBackgroundColor: color.withValues(alpha: 0.35),
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
        ),
        child: _isPunching
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
              )
            : Text(
                widget.isPunchOut ? 'PUNCH OUT' : 'PUNCH IN',
                style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold),
              ),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
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
}

/// Glowing circular scan ring: pulses gently while idly scanning, fills
/// clockwise as the auto-capture hold timer elapses, and simply glows solid
/// once a match/no-match/error result is in.
class _ScanRingPainter extends CustomPainter {
  final Color color;
  final double progress;
  final bool pulsing;

  _ScanRingPainter({required this.color, required this.progress, required this.pulsing});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height).deflate(2);

    final borderPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 4.0;
    canvas.drawOval(rect, borderPaint);

    if (progress > 0.0) {
      final progressPaint = Paint()
        ..color = const Color(0xFF00C853)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6.0
        ..strokeCap = StrokeCap.round;

      const startAngle = -3.14159 / 2;
      final sweepAngle = 2 * 3.14159 * progress;
      canvas.drawArc(rect, startAngle, sweepAngle, false, progressPaint);
    }
  }

  @override
  bool shouldRepaint(covariant _ScanRingPainter oldDelegate) {
    return oldDelegate.color != color ||
        oldDelegate.progress != progress ||
        oldDelegate.pulsing != pulsing;
  }
}
