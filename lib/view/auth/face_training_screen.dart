import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:get/get.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';
import 'package:sarvam/view/auth/face_verification_screen.dart';
import 'package:sarvam/view/auth/role_home_router.dart';

enum TrainingStep { intro, step1Straight, step2Left, step3Right, success, failed }

class FaceTrainingScreen extends StatefulWidget {
  const FaceTrainingScreen({super.key, this.autoStart = false});

  final bool autoStart;

  @override
  State<FaceTrainingScreen> createState() => _FaceTrainingScreenState();
}

class _FaceTrainingScreenState extends State<FaceTrainingScreen>
    with WidgetsBindingObserver {
  TrainingStep _currentStep = TrainingStep.intro;

  CameraController? _cameraController;
  List<CameraDescription> _cameras = [];
  bool _isInitializing = false;
  bool _isProcessingFrame = false;
  bool _isUploading = false;
  String? _errorMessage;

  late final FaceDetector _faceDetector;

  // Captured biometric feature vectors for the 3 steps
  final List<List<double>> _capturedSamples = [];
  final List<Face> _recentFrames = [];

  bool _faceDetected = false;
  DateTime? _holdStartTime;
  bool _isCapturing = false;

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
    if (widget.autoStart) {
      _startTraining();
    }
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
    } else if (state == AppLifecycleState.resumed &&
        _currentStep != TrainingStep.intro &&
        _currentStep != TrainingStep.success &&
        _currentStep != TrainingStep.failed) {
      _initializeCamera();
    }
  }

  Future<void> _startTraining() async {
    final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
    if (serverInfo != null && !serverInfo.faceTrainingAllowed) {
      Get.snackbar(
        'Training Restricted',
        serverInfo.accessMessage ?? 'Face training is disabled by Admin.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }

    setState(() {
      _currentStep = TrainingStep.step1Straight;
      _capturedSamples.clear();
      _errorMessage = null;
    });
    await _initializeCamera();
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
          _currentStep = TrainingStep.failed;
        });
        return;
      }

      int frontCameraIndex = _cameras.indexWhere(
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

      setState(() {
        _isInitializing = false;
      });

      _startImageStream();
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to access camera: $e';
          _isInitializing = false;
          _currentStep = TrainingStep.failed;
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
    if (_cameraController != null && _cameraController!.value.isStreamingImages) {
      try {
        _cameraController!.stopImageStream();
      } catch (_) {}
    }
  }

  DateTime? _lastFrameProcessingTime;

  Future<void> _processCameraFrame(CameraImage image) async {
    if (_isProcessingFrame ||
        _isUploading ||
        _isCapturing ||
        _currentStep == TrainingStep.intro ||
        _currentStep == TrainingStep.success ||
        _currentStep == TrainingStep.failed) {
      return;
    }

    final now = DateTime.now();
    if (_lastFrameProcessingTime != null &&
        now.difference(_lastFrameProcessingTime!).inMilliseconds < 160) {
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
      );

      if (primaryFace != null) {
        _recentFrames.add(primaryFace);
        if (_recentFrames.length > 10) _recentFrames.removeAt(0);
      }

      bool isFaceDetected = primaryFace != null && report.isQualityValid;

      if (isFaceDetected) {
        if (_holdStartTime == null) {
          _holdStartTime = DateTime.now();
        } else {
          final elapsedMs = DateTime.now().difference(_holdStartTime!).inMilliseconds;
          final progress = (elapsedMs / 280.0).clamp(0.0, 1.0);
          if (mounted) {
            setState(() {
              _faceDetected = true;
            });
          }

          if (progress >= 1.0 && !_isCapturing) {
            _captureCurrentStep(primaryFace);
          }
        }
      } else {
        _holdStartTime = null;
        if (mounted) {
          setState(() {
            _faceDetected = isFaceDetected;
          });
        }
      }
    } catch (e) {
      if (kDebugMode) print('Frame error: $e');
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
      rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
    }
    if (rotation == null) return null;

    final format = InputImageFormatValue.fromRawValue(image.format.raw);
    if (format == null || image.planes.isEmpty) return null;

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

  Future<void> _captureCurrentStep(Face face) async {
    _isCapturing = true;
    HapticFeedback.mediumImpact();

    final features = FaceBiometricService.extractFeatureVector(face);
    _capturedSamples.add(features);

    _holdStartTime = null;

    if (_currentStep == TrainingStep.step1Straight) {
      setState(() {
        _currentStep = TrainingStep.step2Left;
        _isCapturing = false;
      });
    } else if (_currentStep == TrainingStep.step2Left) {
      setState(() {
        _currentStep = TrainingStep.step3Right;
        _isCapturing = false;
      });
    } else if (_currentStep == TrainingStep.step3Right) {
      await _finishTraining();
    }
  }

  Future<void> _finishTraining() async {
    String? photoBase64;
    try {
      final controller = _cameraController;
      if (controller != null && controller.value.isInitialized) {
        if (controller.value.isStreamingImages) {
          await controller.stopImageStream();
          await Future.delayed(const Duration(milliseconds: 150));
        }
        final xFile = await controller.takePicture();
        final bytes = await xFile.readAsBytes();
        photoBase64 = base64Encode(bytes);
      } else {
        _stopImageStream();
      }
    } catch (e) {
      _stopImageStream();
      if (kDebugMode) print('Failed to capture face photo during training: $e');
    }

    setState(() {
      _isUploading = true;
    });

    final masterVector = FaceBiometricService.aggregateTemplateVector(_capturedSamples);
    final encryptedPayload = FaceBiometricService.encryptTemplatePayload(
      masterVector,
      userId: 'authenticated-user',
      livenessPassed: true,
      qualityScore: 99.0,
      photoBase64: photoBase64,
    );

    final uploadResult = await FaceBiometricService.uploadFaceRegistrationTemplate(
      encryptedPayload: encryptedPayload,
    );

    if (!mounted) return;

    setState(() {
      _isUploading = false;
    });

    if (uploadResult.success) {
      await FaceBiometricService.saveEnrolledFeatures(
        _capturedSamples,
        encryptedPayload: encryptedPayload,
      );
      setState(() {
        _currentStep = TrainingStep.success;
      });
    } else {
      setState(() {
        _errorMessage = uploadResult.message;
        _currentStep = TrainingStep.failed;
      });
    }
  }

  void _resetAndRetry() {
    _stopImageStream();
    _startTraining();
  }

  void _onContinue() async {
    final prefs = await SharedPreferences.getInstance();
    if (hasPunchedInToday(prefs)) {
      final homeScreen = await resolveHomeScreen();
      Get.offAll(() => homeScreen);
    } else {
      Get.offAll(() => const FaceVerificationScreen());
    }
  }

  void _goToMpinLogin() {
    Get.offAll(() => const MpinLoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    if (_currentStep == TrainingStep.intro) {
      return _buildIntroUI();
    } else if (_currentStep == TrainingStep.success) {
      return _buildSuccessUI();
    } else if (_currentStep == TrainingStep.failed) {
      return _buildFailedUI();
    }
    return _buildStepCaptureUI();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. INTRO SCREEN (Matching Design Image 1)
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildIntroUI() {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D6842),
        foregroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: Colors.white),
          onPressed: () => Navigator.maybePop(context),
        ),
        title: Text(
          'Face Training',
          style: TextStyle(
            fontSize: 18.sp,
            fontWeight: FontWeight.bold,
            color: Colors.white,
          ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.symmetric(horizontal: 24.w, vertical: 16.h),
          child: Column(
            children: [
              SizedBox(height: 8.h),
              Text(
                'Set up your face for\nsecure login',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 22.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF0F172A),
                  height: 1.25,
                ),
              ),
              SizedBox(height: 24.h),

              // Circular Viewfinder Bracket Container
              Center(
                child: SizedBox(
                  width: 220.w,
                  height: 220.w,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      Container(
                        width: 200.w,
                        height: 200.w,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: Color(0xFFF1F5F9),
                        ),
                        child: ClipOval(
                          child: Icon(
                            Icons.person,
                            size: 140.sp,
                            color: const Color(0xFF94A3B8),
                          ),
                        ),
                      ),
                      CustomPaint(
                        size: Size(220.w, 220.w),
                        painter: CornerBracketsPainter(
                          color: const Color(0xFF00C853),
                          strokeWidth: 3.5,
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              SizedBox(height: 14.h),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.crop_free_rounded,
                    size: 18.sp,
                    color: const Color(0xFF0D6842),
                  ),
                  SizedBox(width: 6.w),
                  Text(
                    'Position your face inside the frame',
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF0D6842),
                    ),
                  ),
                ],
              ),

              SizedBox(height: 28.h),

              // Checklist Section: "Before you start"
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Before you start',
                  style: TextStyle(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.bold,
                    color: const Color(0xFF0D6842),
                  ),
                ),
              ),
              SizedBox(height: 12.h),

              _buildCheckItem(Icons.face, 'Keep your face clearly visible'),
              _buildCheckItem(Icons.no_accounts_outlined, 'Remove anything covering your face'),
              _buildCheckItem(Icons.visibility_outlined, 'Look directly at the camera'),
              _buildCheckItem(Icons.lightbulb_outline, 'Stay in a well-lit area'),
              _buildCheckItem(Icons.smartphone_outlined, 'Keep your phone steady'),

              SizedBox(height: 32.h),

              // Start Button
              SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: _startTraining,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0D6842),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'Start Face Training',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16.sp,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
              SizedBox(height: 16.h),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCheckItem(IconData icon, String text) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Row(
        children: [
          Icon(icon, size: 18.sp, color: const Color(0xFF0D6842)),
          SizedBox(width: 12.w),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 13.sp,
                color: const Color(0xFF334155),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. STEP 1 / 2 / 3 CAPTURE SCREEN (Matching Design Images 2, 3, 4)
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildStepCaptureUI() {
    int stepNum = 1;
    String stepTitle = 'Step 1 of 3';
    String instruction = 'Look straight at camera';

    if (_currentStep == TrainingStep.step2Left) {
      stepNum = 2;
      stepTitle = 'Step 2 of 3';
      instruction = 'Turn face slightly left';
    } else if (_currentStep == TrainingStep.step3Right) {
      stepNum = 3;
      stepTitle = 'Step 3 of 3';
      instruction = 'Turn face slightly right';
    }

    return Scaffold(
      backgroundColor: const Color(0xFFEFF3EF), // Matching light sage off-white background
      body: SafeArea(
        child: Column(
          children: [
            // Clean Top Header matching reference UI
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 12.h),
              child: Row(
                children: [
                  InkWell(
                    onTap: () {
                      _stopImageStream();
                      setState(() => _currentStep = TrainingStep.intro);
                    },
                    borderRadius: BorderRadius.circular(24.r),
                    child: Container(
                      width: 44.w,
                      height: 44.w,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.06),
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
                      'Face Registration',
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
            ),

            SizedBox(height: 4.h),

            // Main Large Camera Viewfinder Card
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
                                Colors.black.withOpacity(0.25),
                                Colors.transparent,
                                Colors.black.withOpacity(0.45),
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

                      // Real-Time Floating Status Banner (Top Center)
                      Positioned(
                        top: 20.h,
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 300),
                          padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
                          decoration: BoxDecoration(
                            color: _faceDetected
                                ? const Color(0xFF0D6842).withOpacity(0.9)
                                : Colors.black.withOpacity(0.65),
                            borderRadius: BorderRadius.circular(20.r),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.15),
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
                                    : Icons.face_retouching_natural_rounded,
                                color: Colors.white,
                                size: 16.sp,
                              ),
                              SizedBox(width: 8.w),
                              Text(
                                _isUploading
                                    ? 'Saving biometric template...'
                                    : _faceDetected
                                        ? '$stepTitle: Hold Steady...'
                                        : '$stepTitle: $instruction',
                                style: TextStyle(
                                  fontSize: 13.sp,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Bottom 3-Step Progress Indicator Bar (Overlay at bottom of camera)
                      Positioned(
                        bottom: 24.h,
                        child: Container(
                          padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 12.h),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.45),
                            borderRadius: BorderRadius.circular(30.r),
                            border: Border.all(color: Colors.white24, width: 1),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.2),
                                blurRadius: 10,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _buildStepNode(1, 'Straight', stepNum),
                              _buildStepLine(stepNum > 1),
                              _buildStepNode(2, 'Left', stepNum),
                              _buildStepLine(stepNum > 2),
                              _buildStepNode(3, 'Right', stepNum),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            SizedBox(height: 16.h),
          ],
        ),
      ),
    );
  }

  Widget _buildStepNode(int index, String label, int currentStep) {
    final bool isCompleted = currentStep > index;
    final bool isCurrent = currentStep == index;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 28.w,
          height: 28.w,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isCompleted || isCurrent ? const Color(0xFF769A8B) : Colors.white24,
            border: Border.all(
              color: isCompleted || isCurrent ? Colors.white : Colors.white38,
              width: 1.5,
            ),
          ),
          child: Center(
            child: isCompleted
                ? Icon(Icons.check, size: 16.sp, color: Colors.white)
                : Text(
                    '$index',
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
          ),
        ),
        SizedBox(height: 4.h),
        Text(
          label,
          style: TextStyle(
            fontSize: 10.sp,
            fontWeight: isCurrent ? FontWeight.bold : FontWeight.w500,
            color: isCurrent ? Colors.white : Colors.white70,
          ),
        ),
      ],
    );
  }

  Widget _buildStepLine(bool active) {
    return Container(
      width: 32.w,
      height: 2.h,
      margin: EdgeInsets.only(bottom: 14.h, left: 4.w, right: 4.w),
      color: active ? Colors.white : Colors.white24,
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. SUCCESS SCREEN (Matching Design Image 5)
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildSuccessUI() {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 28.w),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),

              // Green Check Circle with Confetti Sparkles
              SizedBox(
                width: 140.w,
                height: 140.w,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    Container(
                      width: 100.w,
                      height: 100.w,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: Color(0xFF00C853),
                      ),
                      child: Icon(Icons.check, size: 60.sp, color: Colors.white),
                    ),
                    // Particle dot decorations
                    Positioned(top: 10.h, left: 20.w, child: _particleDot(Colors.green)),
                    Positioned(top: 20.h, right: 15.w, child: _particleDot(Colors.greenAccent)),
                    Positioned(bottom: 15.h, left: 15.w, child: _particleDot(Colors.green)),
                    Positioned(bottom: 25.h, right: 25.w, child: _particleDot(const Color(0xFF00C853))),
                  ],
                ),
              ),

              SizedBox(height: 24.h),

              Text(
                'Face Training\nCompleted!',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF0F172A),
                  height: 1.25,
                ),
              ),

              SizedBox(height: 12.h),

              Text(
                'Your face has been successfully registered for secure verification.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14.sp,
                  color: const Color(0xFF64748B),
                  height: 1.4,
                ),
              ),

              const Spacer(),

              // Continue Button
              SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: _onContinue,
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
                      color: Colors.white,
                      fontSize: 16.sp,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),

              SizedBox(height: 12.h),

              // Go to MPIN Login
              TextButton(
                onPressed: _goToMpinLogin,
                child: Text(
                  'Go to MPIN Login',
                  style: TextStyle(
                    color: const Color(0xFF0D6842),
                    fontSize: 14.sp,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),

              SizedBox(height: 24.h),
            ],
          ),
        ),
      ),
    );
  }

  Widget _particleDot(Color color) {
    return Container(
      width: 8.w,
      height: 8.w,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: color,
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. FAILED SCREEN (Matching Design Image 6)
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildFailedUI() {
    return Scaffold(
      backgroundColor: const Color(0xFFFFF5F5), // Soft pastel red background
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.symmetric(horizontal: 28.w, vertical: 24.h),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              SizedBox(height: 32.h),

              // Red X Circle
              Container(
                width: 100.w,
                height: 100.w,
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  color: Color(0xFFFFEBEE),
                ),
                child: Icon(Icons.close_rounded, size: 56.sp, color: Colors.redAccent),
              ),

              SizedBox(height: 24.h),

              Text(
                'Face Training\nFailed',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 24.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF0F172A),
                  height: 1.25,
                ),
              ),

              SizedBox(height: 12.h),

              Text(
                _errorMessage ?? "We couldn't capture your face clearly. Please try again.",
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 14.sp,
                  color: const Color(0xFF64748B),
                  height: 1.4,
                ),
              ),

              SizedBox(height: 32.h),

              // Try Again Button
              SizedBox(
                width: double.infinity,
                height: 52.h,
                child: ElevatedButton(
                  onPressed: _resetAndRetry,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0D6842),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'Try Again',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 16.sp,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),

              SizedBox(height: 12.h),

              // Cancel Button (Outlined)
              SizedBox(
                width: double.infinity,
                height: 52.h,
                child: OutlinedButton(
                  onPressed: _goToMpinLogin,
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFF0D6842), width: 1.5),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                  ),
                  child: Text(
                    'Cancel',
                    style: TextStyle(
                      color: const Color(0xFF0D6842),
                      fontSize: 16.sp,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),

              SizedBox(height: 24.h),
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

/// CustomPainter for rendering 4 corner brackets around the circular viewfinder
class CornerBracketsPainter extends CustomPainter {
  final Color color;
  final double strokeWidth;

  CornerBracketsPainter({required this.color, required this.strokeWidth});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;

    final bracketLength = 24.w;
    final margin = 10.w;

    // Top-Left corner
    canvas.drawLine(Offset(margin, margin + bracketLength), Offset(margin, margin), paint);
    canvas.drawLine(Offset(margin, margin), Offset(margin + bracketLength, margin), paint);

    // Top-Right corner
    canvas.drawLine(Offset(size.width - margin - bracketLength, margin), Offset(size.width - margin, margin), paint);
    canvas.drawLine(Offset(size.width - margin, margin), Offset(size.width - margin, margin + bracketLength), paint);

    // Bottom-Left corner
    canvas.drawLine(Offset(margin, size.height - margin - bracketLength), Offset(margin, size.height - margin), paint);
    canvas.drawLine(Offset(margin, size.height - margin), Offset(margin + bracketLength, size.height - margin), paint);

    // Bottom-Right corner
    canvas.drawLine(Offset(size.width - margin - bracketLength, size.height - margin), Offset(size.width - margin, size.height - margin), paint);
    canvas.drawLine(Offset(size.width - margin, size.height - margin), Offset(size.width - margin, size.height - margin - bracketLength), paint);
  }

  @override
  bool shouldRepaint(covariant CornerBracketsPainter oldDelegate) {
    return oldDelegate.color != color || oldDelegate.strokeWidth != strokeWidth;
  }
}
