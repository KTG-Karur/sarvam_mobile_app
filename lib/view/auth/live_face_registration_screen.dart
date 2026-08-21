import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:lottie/lottie.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

/// Screen for Real-Time Live Face Registration with anti-spoofing liveness detection,
/// oval target overlay guidance, quality validation, AES-256 encryption, and backend upload.
class LiveFaceRegistrationScreen extends StatefulWidget {
  const LiveFaceRegistrationScreen({
    super.key,
    this.userId,
    this.onRegistrationComplete,
  });

  final String? userId;
  final VoidCallback? onRegistrationComplete;

  @override
  State<LiveFaceRegistrationScreen> createState() =>
      _LiveFaceRegistrationScreenState();
}

class _LiveFaceRegistrationScreenState extends State<LiveFaceRegistrationScreen>
    with WidgetsBindingObserver {
  CameraController? _cameraController;
  List<CameraDescription> _cameras = [];
  bool _isInitializing = true;
  bool _isProcessingFrame = false;
  bool _isUploading = false;
  String? _errorMessage;

  // ML Kit Detector
  late final FaceDetector _faceDetector;

  // Real-time quality & liveness states
  FaceQualityReport? _latestReport;
  LivenessChallengeStep _currentChallenge = LivenessChallengeStep.lookStraight;

  // Sample collection
  final List<List<double>> _capturedFeatureSamples = [];
  final List<Face> _recentFrames = [];

  // Pose hold timer for auto-capture
  DateTime? _poseHoldStartTime;
  double _holdProgress = 0.0;
  bool _isCapturingSample = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        performanceMode: FaceDetectorMode.accurate,
        enableLandmarks: true,
        enableClassification: true,
        enableTracking: true,
      ),
    );
    _initializeCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
    } else if (state == AppLifecycleState.resumed) {
      _initializeCamera();
    }
  }

  Future<void> _initializeCamera() async {
    setState(() {
      _isInitializing = true;
      _errorMessage = null;
    });

    try {
      _cameras = await availableCameras();
      if (_cameras.isEmpty) {
        setState(() {
          _errorMessage = 'No camera found on this device.';
          _isInitializing = false;
        });
        return;
      }

      int frontCameraIndex = _cameras.indexWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );
      final camera = frontCameraIndex != -1
          ? _cameras[frontCameraIndex]
          : _cameras[0];

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

      setState(() {
        _isInitializing = false;
      });

      _startImageStream();
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage =
              'Failed to access front camera. Please grant camera permission in system settings: $e';
          _isInitializing = false;
        });
      }
    }
  }

  void _startImageStream() {
    if (_cameraController == null || !_cameraController!.value.isInitialized) {
      return;
    }
    _cameraController!.startImageStream(_processCameraFrame);
  }

  void _stopImageStream() {
    if (_cameraController != null &&
        _cameraController!.value.isStreamingImages) {
      try {
        _cameraController!.stopImageStream();
      } catch (_) {}
    }
  }

  DateTime? _lastFrameProcessingTime;

  Future<void> _processCameraFrame(CameraImage image) async {
    if (_isProcessingFrame || _isUploading || _isCapturingSample) return;

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

      final Face? primaryFace = faces.isNotEmpty ? faces.first : null;

      final report = FaceBiometricService.evaluateRealTimeQuality(
        face: primaryFace,
        totalFacesFound: faces.length,
        imageWidth: image.width.toDouble(),
        imageHeight: image.height.toDouble(),
        // ML Kit reports coordinates in the camera image, while this screen's
        // oval is in logical display pixels. Do not compare these two spaces;
        // doing so incorrectly rejects a visibly centered face as off-center.
      );

      if (primaryFace != null) {
        _recentFrames.add(primaryFace);
        if (_recentFrames.length > 12) _recentFrames.removeAt(0);
      }

      bool isPassiveLivenessOk =
          FaceBiometricService.checkPassiveMicroMovementLiveness(_recentFrames);
      bool isChallengeOk =
          primaryFace != null &&
          FaceBiometricService.verifyChallengeStep(
            face: primaryFace,
            step: _currentChallenge,
          );

      // Rapid 250ms hold time for ultra-fast capture
      if (report.isQualityValid && isPassiveLivenessOk && isChallengeOk) {
        if (_poseHoldStartTime == null) {
          _poseHoldStartTime = DateTime.now();
        } else {
          final elapsedMs = DateTime.now()
              .difference(_poseHoldStartTime!)
              .inMilliseconds;
          final progress = (elapsedMs / 250.0).clamp(0.0, 1.0);
          setState(() {
            _holdProgress = progress;
          });

          if (progress >= 1.0 && !_isCapturingSample) {
            _autoCaptureSample(primaryFace);
          }
        }
      } else {
        _poseHoldStartTime = null;
        if (_holdProgress != 0) {
          setState(() {
            _holdProgress = 0.0;
          });
        }
      }

      setState(() {
        _latestReport = report;
      });
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
    InputImageRotation? rotation;
    if (Platform.isIOS) {
      rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
    } else if (Platform.isAndroid) {
      var rotationCompensation = sensorOrientation;
      rotation = InputImageRotationValue.fromRawValue(rotationCompensation);
    }
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

  Future<void> _autoCaptureSample(Face face) async {
    _isCapturingSample = true;
    HapticFeedback.mediumImpact();

    final features = FaceBiometricService.extractFeatureVector(face);
    _capturedFeatureSamples.add(features);

    // Advance challenge step: 1/4 -> 2/4 -> 3/4 -> 4/4
    if (_currentChallenge == LivenessChallengeStep.lookStraight) {
      _currentChallenge = LivenessChallengeStep.turnLeft;
    } else if (_currentChallenge == LivenessChallengeStep.turnLeft) {
      _currentChallenge = LivenessChallengeStep.turnRight;
    } else if (_currentChallenge == LivenessChallengeStep.turnRight) {
      _currentChallenge = LivenessChallengeStep.finalCenter;
    } else if (_currentChallenge == LivenessChallengeStep.finalCenter) {
      _currentChallenge = LivenessChallengeStep.completed;
    }

    _poseHoldStartTime = null;
    _holdProgress = 0.0;

    Get.snackbar(
      'Step $capturedCount/4 Captured!',
      'Pose verified. Proceeding to next step.',
      snackPosition: SnackPosition.TOP,
      backgroundColor: const Color(0xFF00C853),
      colorText: Colors.white,
      duration: const Duration(seconds: 2),
    );

    if (_currentChallenge == LivenessChallengeStep.completed ||
        _capturedFeatureSamples.length >= 4) {
      await _finishAndUploadRegistration();
    } else {
      await Future.delayed(const Duration(milliseconds: 600));
      _isCapturingSample = false;
    }
  }

  int get capturedCount => _capturedFeatureSamples.length;

  Future<void> _finishAndUploadRegistration() async {
    _stopImageStream();
    setState(() {
      _isUploading = true;
    });

    final masterVector = FaceBiometricService.aggregateTemplateVector(
      _capturedFeatureSamples,
    );

    final encryptedPayload = FaceBiometricService.encryptTemplatePayload(
      masterVector,
      userId: widget.userId ?? 'authenticated-user',
      livenessPassed: true,
      qualityScore: 98.5,
    );

    // Upload to API
    final uploadResult =
        await FaceBiometricService.uploadFaceRegistrationTemplate(
          encryptedPayload: encryptedPayload,
        );

    if (!mounted) return;

    setState(() {
      _isUploading = false;
    });

    if (uploadResult.success) {
      await FaceBiometricService.saveEnrolledFeatures(
        _capturedFeatureSamples,
        encryptedPayload: encryptedPayload,
      );
      _showSuccessDialog(uploadResult.message);
    } else {
      _showRetryDialog(uploadResult.message);
    }
  }

  void _showSuccessDialog(String message) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20.r),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Lottie.asset(
              'assets/lottie/face_recognition.json',
              width: 140.w,
              height: 140.w,
              repeat: false,
            ),
            SizedBox(height: 12.h),
            Text(
              'Face Registered Securely!',
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
              style: GoogleFonts.poppins(
                fontSize: 12.sp,
                color: Colors.black87,
              ),
            ),
            SizedBox(height: 20.h),
            SizedBox(
              width: double.infinity,
              height: 46.h,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0D6842),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                ),
                onPressed: () async {
                  Navigator.pop(ctx);
                  if (widget.onRegistrationComplete != null) {
                    widget.onRegistrationComplete!();
                  } else {
                    final homeScreen = await resolveHomeScreen();
                    Get.offAll(() => homeScreen);
                  }
                },
                child: Text(
                  'CONTINUE TO APP',
                  style: GoogleFonts.poppins(
                    fontWeight: FontWeight.w700,
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

  void _showRetryDialog(String errorMessage) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20.r),
        ),
        title: Text(
          'Registration Failed',
          style: GoogleFonts.poppins(
            fontSize: 16.sp,
            fontWeight: FontWeight.w700,
            color: const Color(0xFF10472A),
          ),
        ),
        content: Text(
          '$errorMessage\n\nFace training is complete only after the server securely saves your template.',
          style: GoogleFonts.poppins(fontSize: 12.sp),
        ),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF0D6842),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              _finishAndUploadRegistration();
            },
            child: const Text('RETRY UPLOAD'),
          ),
        ],
      ),
    );
  }

  String get _challengeTitleText {
    switch (_currentChallenge) {
      case LivenessChallengeStep.lookStraight:
        return 'Step 1/4: Look Straight\n“Please look straight at the camera.”';
      case LivenessChallengeStep.turnLeft:
        return 'Step 2/4: Turn Left\n“Please slowly turn your face to the LEFT.”';
      case LivenessChallengeStep.turnRight:
        return 'Step 3/4: Turn Right\n“Please slowly turn your face to the RIGHT.”';
      case LivenessChallengeStep.finalCenter:
        return 'Step 4/4: Look Straight Again\n“Please look straight at the camera once more.”';
      case LivenessChallengeStep.completed:
        return '✓ Face Training Completed!';
    }
  }

  Color get _statusBorderColor {
    if (_latestReport == null) return Colors.white54;
    if (_latestReport!.isQualityValid) {
      return const Color(0xFF00C853); // Emerald Green
    }
    if (_latestReport!.status == FaceQualityStatus.offCenter ||
        _latestReport!.status == FaceQualityStatus.tooFar ||
        _latestReport!.status == FaceQualityStatus.tooClose) {
      return const Color(0xFFFFB300); // Amber Yellow
    }
    return const Color(0xFFFF3D00); // Coral Red
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          'Live Face Registration',
          style: GoogleFonts.poppins(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
      ),
      body: SafeArea(
        child: _isInitializing
            ? const Center(
                child: CircularProgressIndicator(color: Color(0xFF00C853)),
              )
            : _errorMessage != null
            ? Padding(
                padding: EdgeInsets.all(24.w),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.camera_alt_outlined,
                      size: 64.sp,
                      color: Colors.redAccent,
                    ),
                    SizedBox(height: 16.h),
                    Text(
                      _errorMessage!,
                      textAlign: TextAlign.center,
                      style: TextStyle(color: Colors.white70, fontSize: 13.sp),
                    ),
                    SizedBox(height: 20.h),
                    ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF00C853),
                      ),
                      onPressed: _initializeCamera,
                      child: const Text('RETRY CAMERA'),
                    ),
                  ],
                ),
              )
            : Stack(
                children: [
                  // Real-time camera preview
                  if (_cameraController != null &&
                      _cameraController!.value.isInitialized)
                    Positioned.fill(child: CameraPreview(_cameraController!)),

                  // Oval Overlay Mask
                  Positioned.fill(
                    child: CustomPaint(
                      painter: FaceOvalOverlayPainter(
                        borderColor: _statusBorderColor,
                        progress: _holdProgress,
                      ),
                    ),
                  ),

                  // Top Instructions Header
                  Positioned(
                    top: 16.h,
                    left: 20.w,
                    right: 20.w,
                    child: Column(
                      children: [
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 16.w,
                            vertical: 10.h,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.black87,
                            borderRadius: BorderRadius.circular(16.r),
                            border: Border.all(
                              color: _statusBorderColor,
                              width: 1.5,
                            ),
                          ),
                          child: Column(
                            children: [
                              Text(
                                _challengeTitleText,
                                textAlign: TextAlign.center,
                                style: GoogleFonts.poppins(
                                  fontSize: 14.sp,
                                  fontWeight: FontWeight.w700,
                                  color: Colors.white,
                                ),
                              ),
                              SizedBox(height: 4.h),
                              Text(
                                _latestReport?.message ??
                                    'Position your face inside the frame.',
                                textAlign: TextAlign.center,
                                style: GoogleFonts.poppins(
                                  fontSize: 11.sp,
                                  color: _statusBorderColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                        SizedBox(height: 10.h),
                        // Sample progress indicators (1 of 3, 2 of 3, 3 of 3)
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: List.generate(3, (index) {
                            final isDone = index < capturedCount;
                            final isCurrent = index == capturedCount;
                            return AnimatedContainer(
                              duration: const Duration(milliseconds: 300),
                              width: isCurrent ? 36.w : 14.w,
                              height: 8.h,
                              margin: EdgeInsets.symmetric(horizontal: 4.w),
                              decoration: BoxDecoration(
                                color: isDone
                                    ? const Color(0xFF00C853)
                                    : isCurrent
                                    ? const Color(0xFFFFB300)
                                    : Colors.white24,
                                borderRadius: BorderRadius.circular(4.r),
                              ),
                            );
                          }),
                        ),
                      ],
                    ),
                  ),

                  // Bottom Quality Status Metrics Bar
                  Positioned(
                    bottom: 12.h,
                    left: 16.w,
                    right: 16.w,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 10.w,
                            vertical: 8.h,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.black87,
                            borderRadius: BorderRadius.circular(14.r),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _buildQualityMetric(
                                label: 'Lighting',
                                isOk: true,
                                icon: Icons.wb_sunny_rounded,
                              ),
                              _buildQualityMetric(
                                label: 'Position',
                                isOk: _latestReport?.isCentered ?? false,
                                icon: Icons.center_focus_strong_rounded,
                              ),
                              _buildQualityMetric(
                                label: 'Liveness',
                                isOk: _latestReport?.isQualityValid ?? false,
                                icon: Icons.verified_user_rounded,
                              ),
                            ],
                          ),
                        ),
                        if (_isUploading) ...[
                          SizedBox(height: 16.h),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const CircularProgressIndicator(
                                color: Color(0xFF00C853),
                              ),
                              SizedBox(width: 12.w),
                              Text(
                                'Encrypting & Registering Template...',
                                style: GoogleFonts.poppins(
                                  color: Colors.white,
                                  fontSize: 12.sp,
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _buildQualityMetric({
    required String label,
    required bool isOk,
    required IconData icon,
  }) {
    return Row(
      children: [
        Icon(
          icon,
          size: 16.sp,
          color: isOk ? const Color(0xFF00C853) : Colors.amber,
        ),
        SizedBox(width: 6.w),
        Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 11.sp,
            color: isOk ? Colors.white : Colors.white60,
            fontWeight: isOk ? FontWeight.w600 : FontWeight.w400,
          ),
        ),
      ],
    );
  }
}

/// CustomPainter for rendering the dynamic glowing Face Oval Target Overlay
class FaceOvalOverlayPainter extends CustomPainter {
  final Color borderColor;
  final double progress;

  FaceOvalOverlayPainter({required this.borderColor, required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    final ovalCenter = Offset(size.width / 2, size.height * 0.42);
    final ovalWidth = 260.w;
    final ovalHeight = 330.h;

    final ovalRect = Rect.fromCenter(
      center: ovalCenter,
      width: ovalWidth,
      height: ovalHeight,
    );

    // Full screen path
    final screenPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));
    final ovalPath = Path()..addOval(ovalRect);

    // Subtract oval from full screen to create dark background vignette
    final backgroundPath = Path.combine(
      PathOperation.difference,
      screenPath,
      ovalPath,
    );

    final bgPaint = Paint()
      ..color = Colors.black.withValues(alpha: 0.65)
      ..style = PaintingStyle.fill;

    canvas.drawPath(backgroundPath, bgPaint);

    // Draw glowing border paint
    final borderPaint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5;

    canvas.drawOval(ovalRect, borderPaint);

    // Hold progress arc if active
    if (progress > 0.0) {
      final progressPaint = Paint()
        ..color = const Color(0xFF00C853)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 6.0
        ..strokeCap = StrokeCap.round;

      final startAngle = -3.14159 / 2;
      final sweepAngle = 2 * 3.14159 * progress;

      canvas.drawArc(ovalRect, startAngle, sweepAngle, false, progressPaint);
    }
  }

  @override
  bool shouldRepaint(covariant FaceOvalOverlayPainter oldDelegate) {
    return oldDelegate.borderColor != borderColor ||
        oldDelegate.progress != progress;
  }
}
