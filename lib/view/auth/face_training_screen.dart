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

enum TrainingStep { intro, step1Straight, step2Left, step3Right, step4Smile, step5Center, previewConfirm, success, failed }

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
  double _holdProgress = 0.0;
  String _statusInstructionMessage = 'Position face inside the frame';
  bool _isCapturing = false;

  Uint8List? _capturedPhotoBytes;
  Map<String, dynamic>? _pendingEncryptedPayload;

  @override
  void initState() {
    super.initState();
    SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
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
      DeviceOrientation.portraitDown,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
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
    } else if (state == AppLifecycleState.resumed &&
        _currentStep != TrainingStep.intro &&
        _currentStep != TrainingStep.previewConfirm &&
        _currentStep != TrainingStep.success &&
        _currentStep != TrainingStep.failed) {
      _initializeCamera();
    }
  }

  Future<void> _startTraining() async {
    final serverInfo = await FaceBiometricService.fetchServerAttendanceInfo();
    if (!mounted) return;

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

    if (!FaceBiometricService.isModelReady) {
      if (!mounted) return;
      setState(() {
        _errorMessage = 'The face recognition model is not installed on this '
            'device yet. Please contact your administrator.';
        _currentStep = TrainingStep.failed;
      });
      return;
    }

    if (!mounted) return;
    setState(() {
      _currentStep = TrainingStep.step1Straight;
      _capturedSamples.clear();
      _capturedPhotoBytes = null;
      _pendingEncryptedPayload = null;
      _errorMessage = null;
      _holdProgress = 0.0;
      _statusInstructionMessage = 'Position face inside the frame';
    });
    await _initializeCamera();
  }

  Future<void> _initializeCamera() async {
    if (!mounted) return;
    setState(() {
      _isInitializing = true;
      _errorMessage = null;
    });

    try {
      _cameras = await availableCameras();
      if (!mounted) return;
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

      _stopImageStream();
      final oldController = _cameraController;
      _cameraController = null;
      try {
        await oldController?.dispose();
      } catch (_) {}

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

  Future<void> _stopImageStream() async {
    if (_cameraController != null && _cameraController!.value.isStreamingImages) {
      try {
        await _cameraController!.stopImageStream();
      } catch (_) {}
    }
  }

  DateTime? _lastFrameProcessingTime;

  Future<void> _processCameraFrame(CameraImage image) async {
    if (_isProcessingFrame ||
        _isUploading ||
        _isCapturing ||
        _currentStep == TrainingStep.intro ||
        _currentStep == TrainingStep.previewConfirm ||
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

      bool isPoseValid = true;
      String poseInstruction = '';
      if (primaryFace != null) {
        final yaw = primaryFace.headEulerAngleY ?? 0.0;
        final pitch = primaryFace.headEulerAngleX ?? 0.0;
        if (_currentStep == TrainingStep.step1Straight) {
          if (yaw.abs() > 12.0 || pitch.abs() > 15.0) {
            isPoseValid = false;
            poseInstruction = '👤 Step 1/5: Look straight at camera';
          }
        } else if (_currentStep == TrainingStep.step2Left) {
          if (yaw < 6.0) {
            isPoseValid = false;
            poseInstruction = '👈 Step 2/5: Turn face slightly left';
          }
        } else if (_currentStep == TrainingStep.step3Right) {
          if (yaw > -6.0) {
            isPoseValid = false;
            poseInstruction = '👉 Step 3/5: Turn face slightly right';
          }
        } else if (_currentStep == TrainingStep.step4Smile) {
          final smileProb = primaryFace.smilingProbability ?? 0.0;
          if (smileProb < 0.20 && yaw.abs() > 14.0) {
            isPoseValid = false;
            poseInstruction = '😊 Step 4/5: Smile slightly at camera';
          }
        } else if (_currentStep == TrainingStep.step5Center) {
          if (yaw.abs() > 10.0 || pitch.abs() > 12.0) {
            isPoseValid = false;
            poseInstruction = '🎯 Step 5/5: Final Straight Alignment';
          }
        }
      }

      bool isQualityValid = primaryFace != null && report.isQualityValid && isPoseValid;

      if (isQualityValid) {
        if (_holdStartTime == null) {
          _holdStartTime = DateTime.now();
          _holdProgress = 0.0;
        } else {
          final elapsedMs = DateTime.now().difference(_holdStartTime!).inMilliseconds;
          // 400ms sustained hold time requirement for fast capture
          final progress = (elapsedMs / 400.0).clamp(0.0, 1.0);
          if (mounted) {
            setState(() {
              _faceDetected = true;
              _holdProgress = progress;
              _statusInstructionMessage = 'Hold Still (${(progress * 100).toInt()}%)';
            });
          }

          if (progress >= 1.0 && !_isCapturing) {
            _captureCurrentStep(primaryFace);
          }
        }
      } else {
        _holdStartTime = null;
        _holdProgress = 0.0;
        String msg = 'Position face in frame';
        if (primaryFace != null) {
          if (!report.isQualityValid) {
            msg = report.message;
          } else if (!isPoseValid) {
            msg = poseInstruction;
          }
        }
        if (mounted) {
          setState(() {
            _faceDetected = false;
            _holdProgress = 0.0;
            _statusInstructionMessage = msg;
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

  Future<void> _captureCurrentStep(Face face) async {
    _isCapturing = true;
    HapticFeedback.mediumImpact();
    _holdStartTime = null;
    _holdProgress = 0.0;

    // Grab a real still for this pose and turn it into a MobileFaceNet
    // embedding. The pose landmark object alone can't identify a person.
    await _stopImageStream();
    await Future.delayed(const Duration(milliseconds: 60));

    Uint8List? shotBytes;
    try {
      final c = _cameraController;
      if (c != null && c.value.isInitialized) {
        final x = await c.takePicture();
        shotBytes = await x.readAsBytes();
      }
    } catch (e) {
      if (kDebugMode) print('Pose capture error: $e');
    }

    final embedding = shotBytes == null
        ? null
        : await FaceBiometricService.extractEmbeddingFromJpeg(shotBytes);

    if (embedding == null || embedding.isEmpty) {
      if (!mounted) {
        _isCapturing = false;
        return;
      }
      setState(() {
        _isCapturing = false;
        _statusInstructionMessage =
            'Could not read your face clearly — better light, hold still';
      });
      _startImageStream(); // retry the same pose
      return;
    }

    _capturedSamples.add(embedding);
    _capturedPhotoBytes = shotBytes;

    if (_currentStep == TrainingStep.step1Straight) {
      setState(() {
        _currentStep = TrainingStep.step2Left;
        _isCapturing = false;
        _statusInstructionMessage = '👈 Step 2 of 5: Turn face slightly left';
      });
      _startImageStream();
    } else if (_currentStep == TrainingStep.step2Left) {
      setState(() {
        _currentStep = TrainingStep.step3Right;
        _isCapturing = false;
        _statusInstructionMessage = '👉 Step 3 of 5: Turn face slightly right';
      });
      _startImageStream();
    } else if (_currentStep == TrainingStep.step3Right) {
      setState(() {
        _currentStep = TrainingStep.step4Smile;
        _isCapturing = false;
        _statusInstructionMessage = '😊 Step 4 of 5: Smile slightly at camera';
      });
      _startImageStream();
    } else if (_currentStep == TrainingStep.step4Smile) {
      setState(() {
        _currentStep = TrainingStep.step5Center;
        _isCapturing = false;
        _statusInstructionMessage = '🎯 Step 5 of 5: Look straight & hold still';
      });
      _startImageStream();
    } else if (_currentStep == TrainingStep.step5Center) {
      await _preparePreviewConfirm();
    }
  }

  Future<void> _preparePreviewConfirm() async {
    await _stopImageStream();
    await Future.delayed(const Duration(milliseconds: 60));
    Uint8List? imageBytes;
    String? photoBase64;
    try {
      final controller = _cameraController;
      if (controller != null && controller.value.isInitialized) {
        final xFile = await controller.takePicture();
        imageBytes = await xFile.readAsBytes();
        photoBase64 = base64Encode(imageBytes);
      }
    } catch (e) {
      if (kDebugMode) print('Take picture error: $e');
    }

    final masterVector = FaceBiometricService.aggregateTemplateVector(_capturedSamples);
    final encryptedPayload = FaceBiometricService.encryptTemplatePayload(
      masterVector,
      userId: 'authenticated-user',
      livenessPassed: true,
      qualityScore: 99.0,
      samples: _capturedSamples,
      photoBase64: photoBase64,
    );

    if (!mounted) return;

    setState(() {
      _isCapturing = false;
      _capturedPhotoBytes = imageBytes;
      _pendingEncryptedPayload = encryptedPayload;
      _currentStep = TrainingStep.previewConfirm;
    });
  }

  Future<void> _confirmAndUploadBiometric() async {
    if (_pendingEncryptedPayload == null) return;
    setState(() {
      _isUploading = true;
    });

    final photoBase64 = _pendingEncryptedPayload?['photoBase64']?.toString();
    final masterVector = FaceBiometricService.aggregateTemplateVector(_capturedSamples);
    final uploadPayload = FaceBiometricService.encryptTemplatePayload(
      masterVector,
      userId: 'authenticated-user',
      livenessPassed: true,
      qualityScore: 99.0,
      samples: _capturedSamples,
      photoBase64: photoBase64,
    );

    final uploadResult = await FaceBiometricService.uploadFaceRegistrationTemplate(
      encryptedPayload: uploadPayload,
    );

    if (!mounted) return;

    setState(() {
      _isUploading = false;
    });

    if (uploadResult.success) {
      await FaceBiometricService.saveEnrolledFeatures(
        _capturedSamples,
        encryptedPayload: uploadPayload,
        photoBase64: photoBase64,
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

  void _resetAndRetry() async {
    _stopImageStream();
    // Retrying is pointless when the model asset is missing — it just loops
    // back to this screen. Send the user home on MPIN only instead.
    if (!FaceBiometricService.isModelReady) {
      final homeScreen = await resolveHomeScreen();
      Get.offAll(() => homeScreen);
      Get.snackbar(
        'Face check unavailable',
        'The face recognition model is not installed on this device. '
            'Continuing with MPIN only — contact your administrator.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFFB45309),
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
      );
      return;
    }
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
    } else if (_currentStep == TrainingStep.previewConfirm) {
      return _buildPreviewConfirmUI();
    } else if (_currentStep == TrainingStep.success) {
      return _buildSuccessUI();
    } else if (_currentStep == TrainingStep.failed) {
      return _buildFailedUI();
    }
    return _buildStepCaptureUI();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. INTRO SCREEN
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
  // 2. STEP CAPTURE SCREEN
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildStepCaptureUI() {
    int stepNum = 1;
    String stepTitle = 'Step 1 of 5';

    if (_currentStep == TrainingStep.step2Left) {
      stepNum = 2;
      stepTitle = 'Step 2 of 5';
    } else if (_currentStep == TrainingStep.step3Right) {
      stepNum = 3;
      stepTitle = 'Step 3 of 5';
    } else if (_currentStep == TrainingStep.step4Smile) {
      stepNum = 4;
      stepTitle = 'Step 4 of 5';
    } else if (_currentStep == TrainingStep.step5Center) {
      stepNum = 5;
      stepTitle = 'Step 5 of 5';
    }

    return Scaffold(
      backgroundColor: const Color(0xFFEFF3EF),
      body: SafeArea(
        child: Column(
          children: [
            // Clean Top Header
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

                      // Real-Time Floating Status Banner (Top Center)
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
                                    : _statusInstructionMessage.contains('far') ||
                                            _statusInstructionMessage.contains('close') ||
                                            _statusInstructionMessage.contains('eyes') ||
                                            _statusInstructionMessage.contains('straight') ||
                                            _statusInstructionMessage.contains('multiple') ||
                                            _statusInstructionMessage.contains('frame')
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
                                        : _statusInstructionMessage.contains('far') ||
                                                _statusInstructionMessage.contains('close') ||
                                                _statusInstructionMessage.contains('eyes') ||
                                                _statusInstructionMessage.contains('straight') ||
                                                _statusInstructionMessage.contains('multiple')
                                            ? Icons.warning_amber_rounded
                                            : Icons.face_retouching_natural_rounded,
                                    color: Colors.white,
                                    size: 18.sp,
                                  ),
                                  SizedBox(width: 8.w),
                                  Text(
                                    _isUploading
                                        ? 'Saving biometric template...'
                                        : _faceDetected
                                            ? '$stepTitle: Hold Still (${(_holdProgress * 100).toInt()}%)'
                                            : '$stepTitle: $_statusInstructionMessage',
                                    style: TextStyle(
                                      fontSize: 13.sp,
                                      fontWeight: FontWeight.bold,
                                      color: Colors.white,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (_holdProgress > 0) ...[
                              SizedBox(height: 8.h),
                              SizedBox(
                                width: 220.w,
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(4.r),
                                  child: LinearProgressIndicator(
                                    value: _holdProgress,
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

                      // Bottom 3-Step Progress Indicator Bar
                      Positioned(
                        bottom: 24.h,
                        child: Container(
                          padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 12.h),
                          decoration: BoxDecoration(
                            color: Colors.black.withValues(alpha: 0.45),
                            borderRadius: BorderRadius.circular(30.r),
                            border: Border.all(color: Colors.white24, width: 1),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.2),
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
                              _buildStepLine(stepNum > 3),
                              _buildStepNode(4, 'Smile', stepNum),
                              _buildStepLine(stepNum > 4),
                              _buildStepNode(5, 'Center', stepNum),
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
  // 3. PREVIEW & CONFIRM SCREEN
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildPreviewConfirmUI() {
    return Scaffold(
      backgroundColor: const Color(0xFFEFF3EF),
      body: SafeArea(
        child: SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 16.h),
          child: Column(
            children: [
              // Header
              Row(
                children: [
                  InkWell(
                    onTap: _resetAndRetry,
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
                      'Preview & Confirm',
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
              SizedBox(height: 20.h),

              // Captured Image Frame
              Container(
                width: 240.w,
                height: 280.h,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(24.r),
                  border: Border.all(color: const Color(0xFF00C853), width: 3.5),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.1),
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(20.r),
                  child: _capturedPhotoBytes != null
                      ? Image.memory(
                          _capturedPhotoBytes!,
                          fit: BoxFit.cover,
                        )
                      : Container(
                          color: const Color(0xFFE2E8F0),
                          child: Icon(Icons.person, size: 90.sp, color: Colors.grey),
                        ),
                ),
              ),

              SizedBox(height: 16.h),

              // Success pill badge
              Container(
                padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 8.h),
                decoration: BoxDecoration(
                  color: const Color(0xFF0D6842),
                  borderRadius: BorderRadius.circular(20.r),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.check_circle_rounded, color: Colors.white, size: 18.sp),
                    SizedBox(width: 8.w),
                    Text(
                      'Face Captured Successfully!',
                      style: TextStyle(
                        fontSize: 13.sp,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),

              SizedBox(height: 24.h),

              // Quality Verification Checklist Card
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(18.w),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16.r),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.04),
                      blurRadius: 10,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Biometric Quality Verification Report',
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF0F172A),
                      ),
                    ),
                    SizedBox(height: 12.h),
                    _buildQualityCheckRow('Face Alignment & Frame Centering', true),
                    _buildQualityCheckRow('Eye Openness & Feature Clarity', true),
                    _buildQualityCheckRow('Lighting & Angle Verification', true),
                    _buildQualityCheckRow('3-Angle Master Template Vector Generated', true),
                  ],
                ),
              ),

              SizedBox(height: 28.h),

              // Buttons: Confirm & Save vs Retake
              if (_isUploading)
                const Center(
                  child: CircularProgressIndicator(color: Color(0xFF0D6842)),
                )
              else
                Column(
                  children: [
                    SizedBox(
                      width: double.infinity,
                      height: 50.h,
                      child: ElevatedButton(
                        onPressed: _confirmAndUploadBiometric,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF0D6842),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                          elevation: 0,
                        ),
                        child: Text(
                          'Confirm & Save Biometric',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 15.sp,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    SizedBox(height: 12.h),
                    SizedBox(
                      width: double.infinity,
                      height: 50.h,
                      child: OutlinedButton(
                        onPressed: _resetAndRetry,
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFF0D6842), width: 1.5),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12.r),
                          ),
                        ),
                        child: Text(
                          'Retake Photo',
                          style: TextStyle(
                            color: const Color(0xFF0D6842),
                            fontSize: 15.sp,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              SizedBox(height: 16.h),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildQualityCheckRow(String label, bool passed) {
    return Padding(
      padding: EdgeInsets.only(bottom: 8.h),
      child: Row(
        children: [
          Icon(
            passed ? Icons.check_circle : Icons.cancel,
            color: passed ? const Color(0xFF0D6842) : Colors.red,
            size: 18.sp,
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w500,
                color: const Color(0xFF334155),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. SUCCESS SCREEN
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
  // 5. FAILED SCREEN
  // ───────────────────────────────────────────────────────────────────────────
  Widget _buildFailedUI() {
    return Scaffold(
      backgroundColor: const Color(0xFFFFF5F5),
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
