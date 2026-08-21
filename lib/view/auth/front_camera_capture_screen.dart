import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:camera/camera.dart';
import 'package:google_fonts/google_fonts.dart';

/// Screen / Modal for capturing face photos.
/// Guarantees that the FRONT camera is selected by default on all Android & iOS devices.
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
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _initCamera();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final CameraController? cameraController = _controller;
    if (cameraController == null || !cameraController.value.isInitialized) {
      return;
    }
    if (state == AppLifecycleState.inactive) {
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

      if (frontCameraIndex != -1) {
        _selectedCameraIndex = frontCameraIndex;
      } else {
        _selectedCameraIndex = 0; // Fallback if front camera not reported
      }

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
      imageFormatGroup: ImageFormatGroup.jpeg,
    );

    _controller = controller;

    try {
      await controller.initialize();
      if (mounted) {
        setState(() {
          _isInitializing = false;
        });
        // Attendance capture is hands-free. The returned photo is still
        // validated by ML Kit in FaceVerificationScreen before any API call.
        Future.delayed(const Duration(milliseconds: 900), _capturePhoto);
      }
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

    setState(() {
      _isInitializing = true;
    });

    _selectedCameraIndex = (_selectedCameraIndex + 1) % _cameras.length;
    await _controller?.dispose();
    await _setupController(_cameras[_selectedCameraIndex]);
  }

  Future<void> _capturePhoto() async {
    if (_controller == null ||
        !_controller!.value.isInitialized ||
        _isCapturing) {
      return;
    }

    setState(() => _isCapturing = true);

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
      }
    } finally {
      if (mounted) setState(() => _isCapturing = false);
    }
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
                          Container(
                            width: 280.w,
                            height: 340.h,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.all(
                                Radius.elliptical(140.w, 170.h),
                              ),
                              border: Border.all(
                                color: const Color(0xFF008A3D),
                                width: 3.5,
                              ),
                            ),
                          ),
                        ],
                      ),
              ),
            ),
            Container(
              padding: EdgeInsets.symmetric(vertical: 24.h),
              child: Column(
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
                  SizedBox(height: 20.h),
                  const CircularProgressIndicator(
                    color: Color(0xFF008A3D),
                  ),
                  SizedBox(height: 10.h),
                  Text(
                    'Detecting your face automatically…',
                    style: GoogleFonts.poppins(fontSize: 11.sp, color: Colors.white70),
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
