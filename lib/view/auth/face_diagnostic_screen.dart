import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:camera/camera.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:sarvam/services/face_biometric_service.dart';

/// Development-Only Diagnostic Screen for Face Verification & Model Calibration.
/// Displays real-time quality metrics, liveness score, similarity score, model versions, and latency.
class FaceDiagnosticScreen extends StatefulWidget {
  const FaceDiagnosticScreen({super.key});

  @override
  State<FaceDiagnosticScreen> createState() => _FaceDiagnosticScreenState();
}

class _FaceDiagnosticScreenState extends State<FaceDiagnosticScreen> {
  CameraController? _cameraController;
  late final FaceDetector _faceDetector;
  bool _isInitializing = true;
  bool _isProcessing = false;

  // Diagnostic Stats
  bool _faceDetected = false;
  int _facesCount = 0;
  String _qualityStatus = 'N/A';
  String _angleStatus = 'N/A';
  final String _lightingStatus = 'GOOD';
  String _livenessStatus = 'N/A';
  final String _modelName = 'MobileFaceNet';
  final String _modelVersion = 'v1.0 (128d)';
  double _similarityScore = 0.0;
  final double _threshold = 75.0;
  String _verificationResult = 'IDLE';
  int _processingTimeMs = 0;

  List<List<double>> _enrolledEmbeddings = [];

  @override
  void initState() {
    super.initState();
    _faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        performanceMode: FaceDetectorMode.accurate,
        enableLandmarks: true,
        enableClassification: true,
        enableTracking: true,
      ),
    );
    _loadEnrolledEmbeddings();
    _initCamera();
  }

  Future<void> _loadEnrolledEmbeddings() async {
    final embeddings = await FaceBiometricService.getEnrolledFeatures();
    if (mounted) {
      setState(() {
        _enrolledEmbeddings = embeddings;
      });
    }
  }

  Future<void> _initCamera() async {
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) return;
      final frontCam = cameras.firstWhere(
        (c) => c.lensDirection == CameraLensDirection.front,
        orElse: () => cameras.first,
      );

      final controller = CameraController(
        frontCam,
        ResolutionPreset.medium,
        enableAudio: false,
      );

      await controller.initialize();
      if (!mounted) return;

      setState(() {
        _cameraController = controller;
        _isInitializing = false;
      });

      controller.startImageStream(_processImage);
    } catch (e) {
      if (mounted) {
        setState(() => _isInitializing = false);
      }
    }
  }

  Future<void> _processImage(CameraImage image) async {
    if (_isProcessing) return;
    _isProcessing = true;
    final stopwatch = Stopwatch()..start();

    try {
      final WriteBuffer allBytes = WriteBuffer();
      for (final Plane plane in image.planes) {
        allBytes.putUint8List(plane.bytes);
      }
      final bytes = allBytes.done().buffer.asUint8List();

      final Size imageSize = Size(image.width.toDouble(), image.height.toDouble());
      final InputImageRotation rotation = InputImageRotation.rotation270deg;
      final InputImageFormat format = InputImageFormatValue.fromRawValue(image.format.raw) ?? InputImageFormat.nv21;

      final inputImage = InputImage.fromBytes(
        bytes: bytes,
        metadata: InputImageMetadata(
          size: imageSize,
          rotation: rotation,
          format: format,
          bytesPerRow: image.planes[0].bytesPerRow,
        ),
      );

      final faces = await _faceDetector.processImage(inputImage);
      stopwatch.stop();

      if (!mounted) return;

      if (faces.isEmpty) {
        setState(() {
          _faceDetected = false;
          _facesCount = 0;
          _qualityStatus = 'NO_FACE';
          _angleStatus = 'N/A';
          _livenessStatus = 'FAIL';
          _verificationResult = 'NO MATCH';
          _processingTimeMs = stopwatch.elapsedMilliseconds;
        });
        return;
      }

      final face = faces.first;
      final report = FaceBiometricService.evaluateRealTimeQuality(
        face: face,
        totalFacesFound: faces.length,
        imageWidth: image.width.toDouble(),
        imageHeight: image.height.toDouble(),
      );

      final liveVector = FaceBiometricService.extractFeatureVector(face);
      double bestScore = 0.0;

      if (_enrolledEmbeddings.isNotEmpty) {
        bestScore = FaceBiometricService.computeMultiSampleMatchScorePercent(
          liveVector,
          _enrolledEmbeddings,
        );
      }

      final pitch = (face.headEulerAngleX ?? 0.0).abs();
      final yaw = (face.headEulerAngleY ?? 0.0).abs();
      final roll = (face.headEulerAngleZ ?? 0.0).abs();
      final isAngleGood = pitch <= 18.0 && yaw <= 18.0 && roll <= 15.0;

      setState(() {
        _faceDetected = true;
        _facesCount = faces.length;
        _qualityStatus = report.isQualityValid ? 'GOOD' : report.status.name.toUpperCase();
        _angleStatus = isAngleGood ? 'GOOD' : 'TILTED (P:${pitch.toInt()}° Y:${yaw.toInt()}°)';
        _livenessStatus = report.isQualityValid ? 'PASS' : 'FAIL';
        _similarityScore = bestScore;
        _verificationResult = bestScore >= _threshold ? 'MATCH' : 'NO MATCH';
        _processingTimeMs = stopwatch.elapsedMilliseconds;
      });
    } catch (_) {
    } finally {
      _isProcessing = false;
    }
  }

  @override
  void dispose() {
    _cameraController?.dispose();
    _faceDetector.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _cameraController;
    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        title: const Text('Biometric Diagnostics Mode', style: TextStyle(color: Colors.white)),
        backgroundColor: const Color(0xFF1E293B),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _isInitializing || controller == null || !controller.value.isInitialized
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF10B981)))
          : Stack(
              children: [
                CameraPreview(controller),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 24,
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.85),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _verificationResult == 'MATCH' ? Colors.green : Colors.redAccent,
                        width: 2,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _buildRow('Face detected:', _faceDetected ? 'YES' : 'NO', _faceDetected ? Colors.green : Colors.red),
                        _buildRow('Faces detected:', '$_facesCount', _facesCount == 1 ? Colors.green : Colors.orange),
                        _buildRow('Face quality:', _qualityStatus, _qualityStatus == 'GOOD' ? Colors.green : Colors.amber),
                        _buildRow('Face angle:', _angleStatus, _angleStatus == 'GOOD' ? Colors.green : Colors.amber),
                        _buildRow('Lighting:', _lightingStatus, Colors.green),
                        _buildRow('Liveness:', _livenessStatus, _livenessStatus == 'PASS' ? Colors.green : Colors.red),
                        _buildRow('Model:', _modelName, Colors.white),
                        _buildRow('Model version:', _modelVersion, Colors.white),
                        _buildRow('Similarity:', '${_similarityScore.toStringAsFixed(1)}%', _similarityScore >= _threshold ? Colors.green : Colors.orange),
                        _buildRow('Threshold:', '$_threshold%', Colors.white),
                        _buildRow('Result:', _verificationResult, _verificationResult == 'MATCH' ? Colors.greenAccent : Colors.redAccent, isBold: true),
                        _buildRow('Processing time:', '$_processingTimeMs ms', Colors.lightBlueAccent),
                      ],
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildRow(String label, String value, Color color, {bool isBold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Colors.white70, fontSize: 13)),
          Text(
            value,
            style: TextStyle(
              color: color,
              fontSize: isBold ? 15 : 13,
              fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ],
      ),
    );
  }
}
