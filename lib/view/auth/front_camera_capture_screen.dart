import 'dart:async';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:sarvam/services/face_biometric_service.dart';

/// Live front-camera face scanner. Automatically captures a photo the
/// instant a well-aligned, live (non-photo) face is held steady inside the
/// oval guide — there is no manual shutter button, so a spoofed photo held
/// up to the camera can't be "clicked" through by a impatient tap.
class FrontCameraCaptureScreen extends StatefulWidget {
  const FrontCameraCaptureScreen({
    super.key,
    this.title = 'Face Capture',
    this.instruction = 'Align your face within the circle',
  });

  final String title;
  final String instruction;

  @override
  State<FrontCameraCaptureScreen> createState() =>
      _FrontCameraCaptureScreenState();
}

class _FrontCameraCaptureScreenState extends State<FrontCameraCaptureScreen>
    with WidgetsBindingObserver {
  CameraController? _controller;
  List<CameraDescription> _cameras = [];
  int _selectedCameraIndex = -1;
  bool _isInitializing = true;
  bool _isCapturing = false;
  bool _isProcessingFrame = false;
  String? _errorMessage;

  late final FaceDetector _faceDetector;
  final List<Face> _recentFrames = [];
  FaceQualityReport? _latestReport;
  DateTime? _poseHoldStartTime;
  double _holdProgress = 0.0;
  DateTime? _lastFrameProcessingTime;

  static const int _holdMillis = 400;

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
    _initCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stopImageStream();
    _controller?.dispose();
    _faceDetector.close();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final CameraController? cameraController = _controller;
    if (cameraController == null || !cameraController.value.isInitialized) {
      return;
    }
    if (state == AppLifecycleState.inactive) {
      _stopImageStream();
      cameraController.dispose();
    } else if (state == AppLifecycleState.resumed) {
      _initCamera();
    }
  }

  Future<void> _initCamera() async {
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

      // Default to FRONT camera on every device
      int frontCameraIndex = _cameras.indexWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
      );

      _selectedCameraIndex = frontCameraIndex != -1 ? frontCameraIndex : 0;

      await _setupController(_cameras[_selectedCameraIndex]);
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to initialize camera: ${e.toString()}';
          _isInitializing = false;
        });
      }
    }
  }

  Future<void> _setupController(CameraDescription cameraDescription) async {
    final controller = CameraController(
      cameraDescription,
      ResolutionPreset.high,
      enableAudio: false,
      imageFormatGroup: Platform.isAndroid
          ? ImageFormatGroup.nv21
          : ImageFormatGroup.bgra8888,
    );

    _controller = controller;

    try {
      await controller.initialize();
      if (!mounted) return;
      setState(() {
        _isInitializing = false;
      });
      _startImageStream();
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Error initializing camera: $e';
          _isInitializing = false;
        });
      }
    }
  }

  Future<void> _switchCamera() async {
    if (_cameras.length < 2 || _controller == null) return;

    _stopImageStream();
    setState(() {
      _isInitializing = true;
      _poseHoldStartTime = null;
      _holdProgress = 0.0;
    });

    _selectedCameraIndex = (_selectedCameraIndex + 1) % _cameras.length;
    await _controller?.dispose();
    await _setupController(_cameras[_selectedCameraIndex]);
  }

  void _startImageStream() {
    if (_controller == null || !_controller!.value.isInitialized) return;
    _controller!.startImageStream(_processCameraFrame);
  }

  void _stopImageStream() {
    if (_controller != null && _controller!.value.isStreamingImages) {
      try {
        _controller!.stopImageStream();
      } catch (_) {}
    }
  }

  Future<void> _processCameraFrame(CameraImage image) async {
    if (_isProcessingFrame || _isCapturing) return;

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
        center: Offset(screenSize.width / 2, screenSize.height * 0.42),
        width: 280.w,
        height: 340.h,
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

      final isLive = FaceBiometricService.checkPassiveMicroMovementLiveness(
        _recentFrames,
      );

      if (report.isQualityValid && isLive) {
        if (_poseHoldStartTime == null) {
          _poseHoldStartTime = DateTime.now();
        } else {
          final elapsedMs = DateTime.now()
              .difference(_poseHoldStartTime!)
              .inMilliseconds;
          final progress = (elapsedMs / _holdMillis).clamp(0.0, 1.0);
          setState(() => _holdProgress = progress);

          if (progress >= 1.0 && !_isCapturing) {
            _autoCapture();
          }
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
    if (_controller == null) return null;
    final camera = _controller!.description;

    final sensorOrientation = camera.sensorOrientation;
    InputImageRotation? rotation;
    if (Platform.isIOS) {
      rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
    } else if (Platform.isAndroid) {
      rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
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

  Future<void> _autoCapture() async {
    if (_controller == null ||
        !_controller!.value.isInitialized ||
        _isCapturing) {
      return;
    }

    setState(() => _isCapturing = true);
    _stopImageStream();
    HapticFeedback.mediumImpact();

    try {
      final XFile photoFile = await _controller!.takePicture();
      final bytes = await photoFile.readAsBytes();

      if (!mounted) return;
      Navigator.pop(context, {
        'file': photoFile,
        'bytes': bytes,
        'path': photoFile.path,
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to capture photo: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
        setState(() => _isCapturing = false);
        _startImageStream();
      }
    }
  }

  Color get _statusBorderColor {
    if (_latestReport == null) return Colors.white54;
    if (_latestReport!.isQualityValid) return const Color(0xFF00C853);
    if (_latestReport!.status == FaceQualityStatus.offCenter ||
        _latestReport!.status == FaceQualityStatus.tooFar ||
        _latestReport!.status == FaceQualityStatus.tooClose) {
      return const Color(0xFFFFB300);
    }
    return const Color(0xFFFF3D00);
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
          widget.title,
          style: GoogleFonts.poppins(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: Colors.white,
          ),
        ),
        actions: [
          if (_cameras.length > 1)
            IconButton(
              tooltip: 'Switch Camera',
              icon: const Icon(Icons.cameraswitch_rounded, color: Colors.white),
              onPressed: _isInitializing ? null : _switchCamera,
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 10.h),
              child: Text(
                widget.instruction,
                textAlign: TextAlign.center,
                style: GoogleFonts.poppins(
                  fontSize: 13.sp,
                  color: Colors.white70,
                ),
              ),
            ),
            Expanded(
              child: Center(
                child: _isInitializing
                    ? const CircularProgressIndicator(color: Color(0xFF008A3D))
                    : _errorMessage != null
                    ? Padding(
                        padding: EdgeInsets.all(24.w),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.camera_alt_outlined,
                              size: 64.sp,
                              color: Colors.white38,
                            ),
                            SizedBox(height: 16.h),
                            Text(
                              _errorMessage!,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: Colors.redAccent,
                                fontSize: 13.sp,
                              ),
                            ),
                            SizedBox(height: 20.h),
                            ElevatedButton(
                              onPressed: _initCamera,
                              child: const Text('RETRY CAMERA'),
                            ),
                          ],
                        ),
                      )
                    : Stack(
                        alignment: Alignment.center,
                        children: [
                          ClipOval(
                            child: SizedBox(
                              width: 280.w,
                              height: 340.h,
                              child: CameraPreview(_controller!),
                            ),
                          ),
                          IgnorePointer(
                            child: SizedBox(
                              width: 280.w,
                              height: 340.h,
                              child: CustomPaint(
                                painter: _CaptureRingPainter(
                                  borderColor: _statusBorderColor,
                                  progress: _holdProgress,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
              ),
            ),
            Padding(
              padding: EdgeInsets.symmetric(vertical: 24.h, horizontal: 24.w),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 6.h,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white12,
                          borderRadius: BorderRadius.circular(20.r),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.photo_camera_front_rounded,
                              size: 14.sp,
                              color: const Color(0xFF7AC89A),
                            ),
                            SizedBox(width: 6.w),
                            Text(
                              _selectedCameraIndex != -1 &&
                                      _cameras[_selectedCameraIndex]
                                              .lensDirection ==
                                          CameraLensDirection.front
                                  ? 'Front Camera Active'
                                  : 'Rear Camera Active',
                              style: GoogleFonts.poppins(
                                fontSize: 11.sp,
                                color: Colors.white70,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 12.h),
                  Text(
                    _isCapturing
                        ? 'Capturing…'
                        : (_latestReport?.message ??
                              'Hold your face steady inside the frame — it captures automatically.'),
                    textAlign: TextAlign.center,
                    style: GoogleFonts.poppins(
                      fontSize: 12.sp,
                      fontWeight: FontWeight.w600,
                      color: _isCapturing ? Colors.white : _statusBorderColor,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Glowing capture-ring with a progress arc that fills as the auto-capture
/// hold timer elapses, replacing the old manual shutter button.
class _CaptureRingPainter extends CustomPainter {
  final Color borderColor;
  final double progress;

  _CaptureRingPainter({required this.borderColor, required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(0, 0, size.width, size.height).deflate(2);

    final borderPaint = Paint()
      ..color = borderColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.5;
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
  bool shouldRepaint(covariant _CaptureRingPainter oldDelegate) {
    return oldDelegate.borderColor != borderColor ||
        oldDelegate.progress != progress;
  }
}
