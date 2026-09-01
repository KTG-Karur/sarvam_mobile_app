import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

class CameraService {
  CameraController? _cameraController;
  List<CameraDescription> _availableCameras = [];
  CameraDescription? _frontCamera;

  CameraController? get controller => _cameraController;
  bool get isInitialized => _cameraController?.value.isInitialized ?? false;

  /// Initialize front camera
  Future<bool> initializeFrontCamera() async {
    try {
      _availableCameras = await availableCameras();
      if (_availableCameras.isEmpty) {
        debugPrint('CameraService: No available cameras found on device');
        return false;
      }

      // Find front facing camera
      _frontCamera = _availableCameras.firstWhere(
        (cam) => cam.lensDirection == CameraLensDirection.front,
        orElse: () => _availableCameras.first,
      );

      _cameraController = CameraController(
        _frontCamera!,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.nv21, // Optimized for ML Kit Android/iOS
      );

      await _cameraController!.initialize();
      await _cameraController!.lockCaptureOrientation(DeviceOrientation.portraitUp);
      return true;
    } catch (e) {
      debugPrint('CameraService: Initialization error: $e');
      return false;
    }
  }

  /// Start image frame stream for ML Kit face detection
  Future<void> startImageStream(Function(CameraImage image, CameraDescription description) onFrame) async {
    if (_cameraController == null || !_cameraController!.value.isInitialized) {
      return;
    }
    if (_cameraController!.value.isStreamingImages) {
      return;
    }
    await _cameraController!.startImageStream((CameraImage image) {
      if (_frontCamera != null) {
        onFrame(image, _frontCamera!);
      }
    });
  }

  /// Stop image stream
  Future<void> stopImageStream() async {
    if (_cameraController != null &&
        _cameraController!.value.isInitialized &&
        _cameraController!.value.isStreamingImages) {
      await _cameraController!.stopImageStream();
    }
  }

  /// Dispose camera controller
  Future<void> dispose() async {
    await stopImageStream();
    await _cameraController?.dispose();
    _cameraController = null;
  }
}
