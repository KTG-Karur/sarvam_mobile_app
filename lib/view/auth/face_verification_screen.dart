import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/auth/role_home_router.dart';
import 'package:sarvam/view/auth/face_training_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';

/// Steps the user works through before a probe image is captured:
/// align the face, complete a randomised liveness challenge, then hold still.
enum _LivenessStage { aligning, challenge, ready }

enum _LivenessChallenge { blink, turnLeft, turnRight }

class FaceVerificationScreen extends StatefulWidget {
  const FaceVerificationScreen({super.key, this.isPunchOut = false});

  final bool isPunchOut;

  @override
  State<FaceVerificationScreen> createState() => _FaceVerificationScreenState();
}

class _FaceVerificationScreenState extends State<FaceVerificationScreen>
    with WidgetsBindingObserver {
  CameraController? _cameraController;
  List<CameraDescription> _cameras = [];
  int _selectedCameraIndex = 0;
  bool _isInitializing = true;
  bool _isProcessingFrame = false;
  bool _isVerifying = false;

  late final FaceDetector _faceDetector;

  Position? _position;

  bool _faceDetected = false;
  String _statusGuidanceText = 'Position Face in Frame';
  DateTime? _autoHoldStartTime;
  double _autoHoldProgress = 0.0;

  /// False when the on-device face model asset is missing — the screen then
  /// refuses to verify instead of letting anyone punch in.
  bool _modelReady = true;

  // Liveness challenge state.
  _LivenessStage _stage = _LivenessStage.aligning;
  _LivenessChallenge _challenge = _LivenessChallenge.blink;
  DateTime? _challengeStartedAt;
  int _blinkPhase = 0; // 0 = waiting for eyes to close, 1 = saw closed
  bool _turnAwaySeen = false;
  final Random _rng = Random();



  @override
  void initState() {
    super.initState();
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
    WidgetsBinding.instance.addObserver(this);
    _modelReady = FaceBiometricService.isModelReady;
    _faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        performanceMode: FaceDetectorMode.accurate,
        enableLandmarks: true,
        enableClassification: true,
        enableTracking: true,
      ),
    );
    if (!_modelReady) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showModelUnavailableDialog();
      });
      return;
    }
    _fetchLocation();
    _initializeCamera();
  }

  void _pickChallenge() {
    _challenge = _LivenessChallenge
        .values[_rng.nextInt(_LivenessChallenge.values.length)];
    _challengeStartedAt = DateTime.now();
    _blinkPhase = 0;
    _turnAwaySeen = false;
  }

  String get _challengePrompt {
    switch (_challenge) {
      case _LivenessChallenge.blink:
        return 'Blink your eyes slowly';
      case _LivenessChallenge.turnLeft:
        return 'Slowly turn your head left, then back';
      case _LivenessChallenge.turnRight:
        return 'Slowly turn your head right, then back';
    }
  }

  void _showModelUnavailableDialog() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20.r)),
        title: Text('Face Verification Unavailable',
            style: TextStyle(fontSize: 17.sp, fontWeight: FontWeight.bold)),
        content: Text(
          'The face recognition model is not installed on this device yet, '
          'so identity cannot be verified. Please contact your administrator.',
          style: TextStyle(fontSize: 13.sp, color: const Color(0xFF475569)),
        ),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              Get.offAll(() => const MpinLoginScreen());
            },
            child: const Text('Back to Login'),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopImageStream();
    final controller = _cameraController;
    _cameraController = null;
    try {
      controller?.dispose();
    } catch (_) {}
    try {
      _faceDetector.close();
    } catch (_) {}
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive || state == AppLifecycleState.paused) {
      _stopImageStream();
      final controller = _cameraController;
      if (mounted) {
        setState(() {
          _cameraController = null;
          _isInitializing = true;
        });
      } else {
        _cameraController = null;
      }
      try {
        controller?.dispose();
      } catch (_) {}
    } else if (state == AppLifecycleState.resumed) {
      _initializeCamera();
    }
  }

  Future<void> _fetchLocation() async {
    if (!mounted) return;
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

  Future<void> _initializeCamera() async {
    final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
    if (!mounted) return;

    if (serverInfo != null && !serverInfo.faceAttendanceAllowed && !widget.isPunchOut) {
      if (!mounted) return;
      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
      Get.snackbar(
        'Holiday / Attendance Locked',
        serverInfo.accessMessage ?? 'Today is a Holiday / Weekly Off. Face attendance is disabled by Admin.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFFB45309),
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
      return;
    }

    _stopImageStream();
    final oldController = _cameraController;
    _cameraController = null;

    if (mounted) {
      setState(() {
        _isInitializing = true;
      });
    }

    try {
      await oldController?.dispose();
    } catch (_) {}

    try {
      _cameras = await availableCameras();
      if (!mounted) return;
      if (_cameras.isEmpty) {
        if (mounted) {
          setState(() {
            _isInitializing = false;
          });
        }
        return;
      }

      int frontIndex = _cameras.indexWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );
      _selectedCameraIndex = frontIndex != -1 ? frontIndex : 0;
      final camera = _cameras[_selectedCameraIndex];

      final controller = CameraController(
        camera,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.nv21
            : ImageFormatGroup.bgra8888,
      );

      await controller.initialize();

      if (!mounted) {
        await controller.dispose();
        return;
      }

      _cameraController = controller;
      controller.startImageStream(_processCameraImage);

      setState(() {
        _isInitializing = false;
      });
    } catch (e) {
      if (kDebugMode) print('Camera init error: $e');
      if (mounted) {
        setState(() {
          _isInitializing = false;
        });
      }
    }
  }

  Future<void> _toggleCameraLens() async {
    if (_cameras.length < 2) return;

    _stopImageStream();
    final oldController = _cameraController;
    _cameraController = null;

    if (mounted) {
      setState(() {
        _selectedCameraIndex = (_selectedCameraIndex + 1) % _cameras.length;
        _isInitializing = true;
      });
    }

    try {
      await oldController?.dispose();
    } catch (_) {}

    try {
      final camera = _cameras[_selectedCameraIndex];
      final controller = CameraController(
        camera,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: Platform.isAndroid
            ? ImageFormatGroup.nv21
            : ImageFormatGroup.bgra8888,
      );

      await controller.initialize();

      if (!mounted) {
        await controller.dispose();
        return;
      }

      _cameraController = controller;
      controller.startImageStream(_processCameraImage);

      setState(() {
        _isInitializing = false;
      });
    } catch (e) {
      if (kDebugMode) print('Toggle camera error: $e');
      if (mounted) {
        setState(() {
          _isInitializing = false;
        });
      }
    }
  }

  void _resetVerificationState() {
    _autoHoldStartTime = null;
    _autoHoldProgress = 0.0;
    _faceDetected = false;
    _isProcessingFrame = false;
    _isVerifying = false;
    _stage = _LivenessStage.aligning;
    _challengeStartedAt = null;
    _blinkPhase = 0;
    _turnAwaySeen = false;
    _statusGuidanceText = 'Position Face in Frame';
  }

  void _startImageStream() {
    _resetVerificationState();
    if (_cameraController == null || !_cameraController!.value.isInitialized) return;
    if (_cameraController!.value.isStreamingImages) return;
    try {
      _cameraController!.startImageStream(_processCameraImage);
    } catch (_) {}
  }

  Future<void> _stopImageStream() async {
    if (_cameraController != null && _cameraController!.value.isStreamingImages) {
      try {
        await _cameraController!.stopImageStream();
      } catch (_) {}
    }
  }

  DateTime? _lastFrameProcessingTime;

  Future<void> _processCameraImage(CameraImage image) async {
    if (_isProcessingFrame || _isVerifying) return;

    final now = DateTime.now();
    if (_lastFrameProcessingTime != null &&
        now.difference(_lastFrameProcessingTime!).inMilliseconds < 100) {
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
      if (!mounted) {
        _isProcessingFrame = false;
        return;
      }

      if (faces.isEmpty) {
        _resetVerificationState();
        setState(() {
          _statusGuidanceText = 'Position Face in Frame';
        });
        _isProcessingFrame = false;
        return;
      }

      if (faces.length > 1) {
        _resetVerificationState();
        setState(() {
          _statusGuidanceText = '⚠️ Multiple Faces Detected — Show 1 Face Only';
        });
        _isProcessingFrame = false;
        return;
      }

      final face = faces.first;
      final report = FaceBiometricService.evaluateRealTimeQuality(
        face: face,
        totalFacesFound: faces.length,
        imageWidth: image.width.toDouble(),
        imageHeight: image.height.toDouble(),
      );

      _advanceLiveness(face, report);
    } catch (e) {
      if (kDebugMode) print('Frame processing error: $e');
    } finally {
      _isProcessingFrame = false;
    }
  }

  /// Drives the aligning → liveness challenge → hold-still → verify sequence
  /// off each analysed frame.
  void _advanceLiveness(Face face, FaceQualityReport report) {
    if (_isVerifying) return;

    final yaw = face.headEulerAngleY ?? 0.0;
    final eyeOpen = ((face.leftEyeOpenProbability ?? 1.0) +
            (face.rightEyeOpenProbability ?? 1.0)) /
        2.0;

    switch (_stage) {
      case _LivenessStage.aligning:
        if (report.isQualityValid) {
          _autoHoldStartTime ??= DateTime.now();
          final held =
              DateTime.now().difference(_autoHoldStartTime!).inMilliseconds;
          if (held >= 500) {
            _pickChallenge();
            _setStatus(_LivenessStage.challenge, _challengePrompt,
                detected: false);
          } else {
            _setStatus(_LivenessStage.aligning, 'Hold steady…', detected: true);
          }
        } else {
          _autoHoldStartTime = null;
          _setStatus(_LivenessStage.aligning, report.message, detected: false);
        }
        break;

      case _LivenessStage.challenge:
        // Give up and re-pick if the user stalls.
        if (_challengeStartedAt != null &&
            DateTime.now().difference(_challengeStartedAt!).inSeconds > 12) {
          _pickChallenge();
          _setStatus(_LivenessStage.challenge,
              'Let\'s try again — $_challengePrompt', detected: false);
          return;
        }
        bool passed = false;
        if (_challenge == _LivenessChallenge.blink) {
          if (_blinkPhase == 0 && eyeOpen < 0.25) _blinkPhase = 1;
          if (_blinkPhase == 1 && eyeOpen > 0.65) passed = true;
        } else {
          final away = _challenge == _LivenessChallenge.turnLeft
              ? yaw > 18.0
              : yaw < -18.0;
          if (away) _turnAwaySeen = true;
          if (_turnAwaySeen && yaw.abs() < 12.0) passed = true;
        }
        if (passed) {
          _autoHoldStartTime = DateTime.now();
          _setStatus(_LivenessStage.ready, 'Great — hold still', detected: true);
        } else {
          _setStatus(_LivenessStage.challenge, _challengePrompt, detected: false);
        }
        break;

      case _LivenessStage.ready:
        if (!report.isQualityValid) {
          _autoHoldStartTime = null;
          _setStatus(_LivenessStage.aligning, report.message, detected: false);
          return;
        }
        _autoHoldStartTime ??= DateTime.now();
        final elapsed =
            DateTime.now().difference(_autoHoldStartTime!).inMilliseconds;
        final progress = (elapsed / 350.0).clamp(0.0, 1.0);
        setState(() {
          _faceDetected = true;
          _autoHoldProgress = progress;
          _statusGuidanceText =
              'Face Aligned — Verifying (${(progress * 100).toInt()}%)';
        });
        if (progress >= 1.0 && !_isVerifying) {
          HapticFeedback.mediumImpact();
          _verifyFace();
        }
        break;
    }
  }

  void _setStatus(_LivenessStage stage, String text, {required bool detected}) {
    if (!mounted) return;
    setState(() {
      _stage = stage;
      _faceDetected = detected;
      _autoHoldProgress = 0.0;
      _statusGuidanceText = text;
    });
  }

  InputImage? _inputImageFromCameraImage(CameraImage image) {
    if (_cameraController == null) return null;

    final camera = _cameras[_selectedCameraIndex];
    final sensorOrientation = camera.sensorOrientation;

    InputImageRotation? rotation;
    if (Platform.isIOS) {
      rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
    } else if (Platform.isAndroid) {
      var rotationCompensation = _getAndroidRotationCompensation(sensorOrientation);
      if (rotationCompensation == null) return null;
      rotation = InputImageRotationValue.fromRawValue(rotationCompensation);
    }
    if (rotation == null) return null;

    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null || image.planes.isEmpty) return null;

    final Uint8List bytes;
    if (image.planes.length == 1) {
      bytes = image.planes[0].bytes;
    } else {
      final WriteBuffer allBytes = WriteBuffer();
      for (final Plane plane in image.planes) {
        allBytes.putUint8List(plane.bytes);
      }
      bytes = allBytes.done().buffer.asUint8List();
    }

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

  int? _getAndroidRotationCompensation(int sensorOrientation) {
    final deviceOrientation = _getDeviceOrientation();
    int rotationCompensation = 0;
    switch (deviceOrientation) {
      case DeviceOrientation.portraitUp:
        rotationCompensation = 0;
        break;
      case DeviceOrientation.landscapeLeft:
        rotationCompensation = 90;
        break;
      case DeviceOrientation.portraitDown:
        rotationCompensation = 180;
        break;
      case DeviceOrientation.landscapeRight:
        rotationCompensation = 270;
        break;
    }

    final camera = _cameras[_selectedCameraIndex];
    if (camera.lensDirection == CameraLensDirection.front) {
      return (sensorOrientation + rotationCompensation) % 360;
    } else {
      return (sensorOrientation - rotationCompensation + 360) % 360;
    }
  }

  DeviceOrientation _getDeviceOrientation() {
    return DeviceOrientation.portraitUp;
  }

  Future<void> _verifyFace() async {
    if (_isVerifying) return;
    if (_stage != _LivenessStage.ready) return;

    setState(() {
      _isVerifying = true;
      _statusGuidanceText = 'Face Aligned — Checking Identity';
    });
    _autoHoldStartTime = null;
    _autoHoldProgress = 0.0;

    await _stopImageStream();
    await Future.delayed(const Duration(milliseconds: 60));

    Uint8List? snapshotBytes;
    try {
      if (_cameraController != null && _cameraController!.value.isInitialized) {
        final xfile = await _cameraController!.takePicture();
        snapshotBytes = await xfile.readAsBytes();
      }
    } catch (e) {
      if (kDebugMode) print('Take picture snapshot error: $e');
    }

    try {
      // 1. Turn the captured still into a real face embedding on-device.
      final probe = snapshotBytes == null
          ? null
          : await FaceBiometricService.extractEmbeddingFromJpeg(snapshotBytes);

      if (probe == null || probe.isEmpty) {
        setState(() => _isVerifying = false);
        _showMatchResultDialog(
          isMatched: false,
          scorePercent: 0,
          message: FaceBiometricService.isModelReady
              ? 'Could not read your face clearly. Move to brighter light, '
                  'keep still and try again.'
              : 'Face verification is not available on this device. '
                  'Please contact your administrator.',
          imageBytes: snapshotBytes,
          enrolledImageBytes: await FaceBiometricService.getEnrolledPhotoBytes(),
        );
        return;
      }

      final storedSamples = await FaceBiometricService.getEnrolledFeatures();
      if (storedSamples.isEmpty) {
        setState(() => _isVerifying = false);
        _showMatchResultDialog(
          isMatched: false,
          scorePercent: 0,
          message: 'Your face is not enrolled on this device. '
              'Please register your face first.',
          imageBytes: snapshotBytes,
          enrolledImageBytes: null,
        );
        return;
      }

      // 2. On-device identity gate — reject a different person before the
      //    server is ever contacted.
      final deviceCosine =
          FaceBiometricService.bestDeviceCosine(probe, storedSamples);
      final deviceOk = deviceCosine >= FaceBiometricService.deviceCosineThreshold;

      if (kDebugMode) {
        print('[FACE_VERIFY] dim=${probe.length} '
            'deviceCosine=${deviceCosine.toStringAsFixed(3)} '
            'threshold=${FaceBiometricService.deviceCosineThreshold} '
            'deviceOk=$deviceOk');
      }

      final enrolledPhotoBytes =
          await FaceBiometricService.getEnrolledPhotoBytes();

      if (!deviceOk) {
        setState(() => _isVerifying = false);
        _showMatchResultDialog(
          isMatched: false,
          scorePercent: (deviceCosine.clamp(0.0, 1.0)) * 100.0,
          message:
              'This face does not match the enrolled user (${(deviceCosine.clamp(0.0, 1.0) * 100).toStringAsFixed(1)}% similarity). '
              'Punch-in denied.',
          imageBytes: snapshotBytes,
          enrolledImageBytes: enrolledPhotoBytes,
        );
        return;
      }

      // 3. Server confirm — it owns the attendance decision and re-checks the
      //    embedding against its own stored template.
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

      final matchResult = await FaceBiometricService.verifyFace(
        liveFeatures: probe,
        type: punchType,
        deviceCosine: deviceCosine,
        latitude: _position?.latitude,
        longitude: _position?.longitude,
      );

      setState(() => _isVerifying = false);

      // Both gates must agree. Device already passed; the server is authority
      // on the final yes/no (fails closed if unreachable).
      _showMatchResultDialog(
        isMatched: matchResult.isMatch,
        scorePercent: matchResult.isMatch
            ? matchResult.scorePercent
            : (deviceCosine.clamp(0.0, 1.0)) * 100.0,
        message: matchResult.message,
        imageBytes: snapshotBytes,
        enrolledImageBytes: enrolledPhotoBytes,
      );
    } catch (e) {
      if (kDebugMode) print('Verify face error: $e');
      setState(() => _isVerifying = false);
      _startImageStream();
      Get.snackbar(
        'Verification Error',
        'An unexpected error occurred during verification. Please try again.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.red,
        colorText: Colors.white,
      );
    }
  }



  void _showMatchResultDialog({
    required bool isMatched,
    required double scorePercent,
    required String message,
    Uint8List? imageBytes,
    Uint8List? enrolledImageBytes,
  }) {
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
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // 1. Registered / Enrolled Face Avatar Column
                Column(
                  children: [
                    Container(
                      width: 80.w,
                      height: 80.w,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFFEFF6FF),
                        border: Border.all(
                          color: const Color(0xFF3B82F6),
                          width: 3.w,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.08),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: ClipOval(
                        child: (enrolledImageBytes != null && enrolledImageBytes.isNotEmpty)
                            ? Image.memory(
                                enrolledImageBytes,
                                width: 80.w,
                                height: 80.w,
                                fit: BoxFit.cover,
                              )
                            : Icon(
                                Icons.person_rounded,
                                size: 44.sp,
                                color: const Color(0xFF3B82F6),
                              ),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    Text(
                      'Registered Face',
                      style: TextStyle(
                        fontSize: 11.sp,
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF64748B),
                      ),
                    ),
                  ],
                ),
                SizedBox(width: 16.w),
                // 2. Live Verification Face Avatar Column
                if (imageBytes != null && imageBytes.isNotEmpty)
                  Column(
                    children: [
                      Stack(
                        alignment: Alignment.bottomRight,
                        children: [
                          Container(
                            width: 80.w,
                            height: 80.w,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: isMatched ? const Color(0xFF0D6842) : const Color(0xFFD32F2F),
                                width: 3.w,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.08),
                                  blurRadius: 8,
                                  offset: const Offset(0, 3),
                                ),
                              ],
                            ),
                            child: ClipOval(
                              child: Image.memory(
                                imageBytes,
                                width: 80.w,
                                height: 80.w,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Container(
                              width: 26.w,
                              height: 26.w,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: isMatched ? const Color(0xFF0D6842) : const Color(0xFFD32F2F),
                                border: Border.all(color: Colors.white, width: 2.w),
                              ),
                              child: Icon(
                                isMatched ? Icons.check_rounded : Icons.close_rounded,
                                color: Colors.white,
                                size: 15.sp,
                              ),
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 6.h),
                      Text(
                        'Live Face',
                        style: TextStyle(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF64748B),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
            SizedBox(height: 16.h),
            Text(
              isMatched ? 'Face Verification Matched!' : 'Face Verification Failed',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 18.sp,
                fontWeight: FontWeight.bold,
                color: isMatched ? const Color(0xFF0F172A) : const Color(0xFFD32F2F),
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
            if (!isMatched) ...[
              SizedBox(height: 14.h),
              Container(
                padding: EdgeInsets.all(12.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(12.r),
                  border: Border.all(color: const Color(0xFFFDE68A)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.lightbulb_rounded, color: const Color(0xFFB45309), size: 18.sp),
                        SizedBox(width: 6.w),
                        Text(
                          'Mistake Guidance & Tips:',
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF92400E),
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 6.h),
                    Text(
                      '• Distance: Move closer if face is too far, or slightly back if too close.\n• Lighting: Ensure bright lighting on your face.\n• Pose: Look straight at camera without head tilt.\n• Eyes: Keep both eyes open naturally.',
                      style: TextStyle(
                        fontSize: 11.5.sp,
                        color: const Color(0xFF78350F),
                        height: 1.4,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            SizedBox(height: 24.h),
            if (isMatched)
              SizedBox(
                width: double.infinity,
                height: 48.h,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    _finishAndNavigate();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0D6842),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'Continue',
                    style: TextStyle(
                      fontSize: 15.sp,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ),
              )
            else
              Column(
                children: [
                  SizedBox(
                    width: double.infinity,
                    height: 48.h,
                    child: ElevatedButton(
                      onPressed: () async {
                        Navigator.pop(ctx);
                        if (message.toLowerCase().contains('not enrolled')) {
                          await _stopImageStream();
                          await FaceBiometricService.clearLocalEnrollmentCache();
                          Get.off(() => const FaceTrainingScreen());
                        } else {
                          _resetVerificationState();
                          _startImageStream();
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
                        message.toLowerCase().contains('not enrolled')
                            ? 'Register Face Now'
                            : 'Try Again',
                        style: TextStyle(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 10.h),
                  SizedBox(
                    width: double.infinity,
                    height: 44.h,
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        Navigator.pop(ctx);
                        await _stopImageStream();
                        await FaceBiometricService.clearEnrolledFeatures();
                        Get.off(() => const FaceTrainingScreen());
                      },
                      icon: Icon(Icons.face_retouching_natural_rounded, size: 18.sp, color: const Color(0xFF0D6842)),
                      label: Text(
                        'Re-register / Update Face',
                        style: TextStyle(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF0D6842),
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: BorderSide(color: const Color(0xFF0D6842), width: 1.5.w),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12.r),
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





  Future<void> _finishAndNavigate() async {
    final prefs = await SharedPreferences.getInstance();
    final today = todayDateKey();
    final nowTimeStr = _formatTime(DateTime.now());

    if (widget.isPunchOut) {
      await prefs.setString('lastPunchOutDate', today);
      await prefs.setString('lastPunchOutTime', nowTimeStr);
      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
      Get.snackbar(
        'Shift Completed',
        'Your punch-out for today has been recorded successfully at $nowTimeStr.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFF0D6842),
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
    } else {
      await prefs.setString('lastPunchInDate', today);
      await prefs.setString('lastPunchInTime', nowTimeStr);
      final homeScreen = await resolveHomeScreen();
      if (!mounted) return;
      Get.offAll(() => homeScreen);
    }
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
    final minute = dt.minute.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $period';
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        Navigator.maybePop(context);
      },
      child: Scaffold(
        backgroundColor: const Color(0xFFEFF3EF), // Matching light sage off-white background
        body: SafeArea(
          child: Column(
            children: [
              // Clean Custom Header matching reference image
              Padding(
                padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 12.h),
                child: Row(
                  children: [
                    // Circular White Back Button
                    InkWell(
                      onTap: () => Navigator.maybePop(context),
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
                        'Check Your Face',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0F172A),
                          letterSpacing: -0.3,
                        ),
                      ),
                    ),
                    SizedBox(width: 44.w), // Spacer for header balance
                  ],
                ),
              ),

              SizedBox(height: 8.h),

              // Main Camera Viewfinder Card with Rounded Frame Overlay
              Expanded(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 20.w),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(28.r),
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        // Camera Feed
                        Positioned.fill(
                          child: _isInitializing ||
                                  _cameraController == null ||
                                  !_cameraController!.value.isInitialized
                              ? Container(
                                  color: Colors.black,
                                  child: const Center(
                                    child: CircularProgressIndicator(
                                      color: Color(0xFF769A8B),
                                    ),
                                  ),
                                )
                              : AspectRatio(
                                  aspectRatio: _cameraController!.value.aspectRatio,
                                  child: CameraPreview(_cameraController!),
                                ),
                        ),

                        // Glassmorphic Framing Overlay Gradient
                        Positioned.fill(
                          child: Container(
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [
                                  Colors.black.withValues(alpha: 0.25),
                                  Colors.transparent,
                                  Colors.black.withValues(alpha: 0.45),
                                ],
                              ),
                            ),
                          ),
                        ),

                        // Rounded Corner Brackets Frame (Center Bounding Box)
                        Center(
                          child: SizedBox(
                            width: 260.w,
                            height: 300.h,
                            child: Stack(
                              children: [
                                Positioned.fill(
                                  child: CustomPaint(
                                    painter: RoundedSquareBracketsPainter(
                                      color: _faceDetected
                                          ? const Color(0xFF00C853)
                                          : Colors.white,
                                      strokeWidth: 3.5,
                                      cornerRadius: 16.r,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        // Real-Time Status Banner (Top Center)
                        Positioned(
                          top: 20.h,
                          child: Column(
                            children: [
                              AnimatedContainer(
                                duration: const Duration(milliseconds: 300),
                                padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
                                decoration: BoxDecoration(
                                  color: _faceDetected
                                      ? const Color(0xFF0D6842).withValues(alpha: 0.95)
                                      : _statusGuidanceText.contains('far') ||
                                              _statusGuidanceText.contains('close') ||
                                              _statusGuidanceText.contains('eyes') ||
                                              _statusGuidanceText.contains('straight') ||
                                              _statusGuidanceText.contains('frame')
                                          ? const Color(0xFFDC2626).withValues(alpha: 0.95)
                                          : Colors.black.withValues(alpha: 0.75),
                                  borderRadius: BorderRadius.circular(20.r),
                                  boxShadow: [
                                    BoxShadow(
                                      color: Colors.black.withValues(alpha: 0.15),
                                      blurRadius: 6,
                                      offset: const Offset(0, 2),
                                    ),
                                  ],
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      _faceDetected
                                          ? Icons.check_circle_rounded
                                          : _statusGuidanceText.contains('far') ||
                                                  _statusGuidanceText.contains('close') ||
                                                  _statusGuidanceText.contains('eyes') ||
                                                  _statusGuidanceText.contains('straight')
                                              ? Icons.warning_amber_rounded
                                              : Icons.face_retouching_natural_rounded,
                                      color: Colors.white,
                                      size: 18.sp,
                                    ),
                                    SizedBox(width: 8.w),
                                    Text(
                                      _statusGuidanceText,
                                      style: TextStyle(
                                        fontSize: 13.sp,
                                        fontWeight: FontWeight.bold,
                                        color: Colors.white,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (_autoHoldProgress > 0) ...[
                                SizedBox(height: 8.h),
                                SizedBox(
                                  width: 220.w,
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(4.r),
                                    child: LinearProgressIndicator(
                                      value: _autoHoldProgress,
                                      backgroundColor: Colors.white24,
                                      color: const Color(0xFF00C853),
                                      minHeight: 4.h,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),

                        // Bottom Floating Action Controls Pill (Matching reference image UI)
                        Positioned(
                          bottom: 28.h,
                          child: Container(
                            padding: EdgeInsets.symmetric(horizontal: 18.w, vertical: 10.h),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.35),
                              borderRadius: BorderRadius.circular(36.r),
                              border: Border.all(color: Colors.white24, width: 1),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.2),
                                  blurRadius: 12,
                                  offset: const Offset(0, 4),
                                ),
                              ],
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                // Left Action: Flip / Switch Camera
                                InkWell(
                                  onTap: _toggleCameraLens,
                                  borderRadius: BorderRadius.circular(24.r),
                                  child: Container(
                                    width: 44.w,
                                    height: 44.w,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.2),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      Icons.flip_camera_ios_rounded,
                                      color: Colors.white,
                                      size: 20.sp,
                                    ),
                                  ),
                                ),

                                SizedBox(width: 18.w),

                                // Center Primary Action: Large Sage-Green Verification Trigger Button
                                InkWell(
                                  onTap: _isVerifying ? null : _verifyFace,
                                  borderRadius: BorderRadius.circular(28.r),
                                  child: Container(
                                    width: 58.w,
                                    height: 58.w,
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF769A8B), // Matching soft sage green
                                      shape: BoxShape.circle,
                                      boxShadow: [
                                        BoxShadow(
                                          color: const Color(0xFF769A8B).withValues(alpha: 0.5),
                                          blurRadius: 14,
                                          offset: const Offset(0, 4),
                                        ),
                                      ],
                                    ),
                                    child: _isVerifying
                                        ? const Center(
                                            child: CircularProgressIndicator(
                                              color: Colors.white,
                                              strokeWidth: 2.5,
                                            ),
                                          )
                                        : Icon(
                                            Icons.center_focus_strong_rounded,
                                            color: Colors.white,
                                            size: 28.sp,
                                          ),
                                  ),
                                ),

                                SizedBox(width: 14.w),

                                // Right Action: Refresh / Re-initialize Camera
                                InkWell(
                                  onTap: _initializeCamera,
                                  borderRadius: BorderRadius.circular(24.r),
                                  child: Container(
                                    width: 44.w,
                                    height: 44.w,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withValues(alpha: 0.2),
                                      shape: BoxShape.circle,
                                    ),
                                    child: Icon(
                                      Icons.refresh_rounded,
                                      color: Colors.white,
                                      size: 20.sp,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              SizedBox(height: 20.h),
            ],
          ),
        ),
      ),
    );
  }
}

/// CustomPainter for rendering 4 rounded corner brackets around the center face box
class RoundedSquareBracketsPainter extends CustomPainter {
  final Color color;
  final double strokeWidth;
  final double cornerRadius;

  RoundedSquareBracketsPainter({
    required this.color,
    required this.strokeWidth,
    this.cornerRadius = 16.0,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    final arm = 38.0;
    final r = cornerRadius;

    // Top-Left corner
    final pathTL = Path()
      ..moveTo(0, arm)
      ..lineTo(0, r)
      ..quadraticBezierTo(0, 0, r, 0)
      ..lineTo(arm, 0);
    canvas.drawPath(pathTL, paint);

    // Top-Right corner
    final pathTR = Path()
      ..moveTo(size.width - arm, 0)
      ..lineTo(size.width - r, 0)
      ..quadraticBezierTo(size.width, 0, size.width, r)
      ..lineTo(size.width, arm);
    canvas.drawPath(pathTR, paint);

    // Bottom-Left corner
    final pathBL = Path()
      ..moveTo(0, size.height - arm)
      ..lineTo(0, size.height - r)
      ..quadraticBezierTo(0, size.height, r, size.height)
      ..lineTo(arm, size.height);
    canvas.drawPath(pathBL, paint);

    // Bottom-Right corner
    final pathBR = Path()
      ..moveTo(size.width - arm, size.height)
      ..lineTo(size.width - r, size.height)
      ..quadraticBezierTo(size.width, size.height, size.width, size.height - r)
      ..lineTo(size.width, size.height - arm);
    canvas.drawPath(pathBR, paint);
  }

  @override
  bool shouldRepaint(covariant RoundedSquareBracketsPainter oldDelegate) {
    return oldDelegate.color != color ||
        oldDelegate.strokeWidth != strokeWidth ||
        oldDelegate.cornerRadius != cornerRadius;
  }
}
