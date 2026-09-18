import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../domain/models/face_quality_metrics.dart';

class FaceDetectionService {
  final FaceDetector _faceDetector;

  FaceDetectionService()
      : _faceDetector = FaceDetector(
          options: FaceDetectorOptions(
            enableLandmarks: true,
            enableClassification: true,
            enableTracking: true,
            enableContours: true,
            performanceMode: FaceDetectorMode.accurate,
            minFaceSize: 0.15,
          ),
        );

  /// Process camera frame image and return detected faces with quality analysis
  Future<({List<Face> faces, FaceQualityMetrics metrics})> processImageFrame({
    required CameraImage image,
    required CameraDescription cameraDescription,
  }) async {
    final inputImage = _convertCameraImageToInputImage(image, cameraDescription);
    if (inputImage == null) {
      return (faces: <Face>[], metrics: FaceQualityMetrics.noFace());
    }

    final faces = await _faceDetector.processImage(inputImage);

    if (faces.isEmpty) {
      return (faces: faces, metrics: FaceQualityMetrics.noFace());
    }

    if (faces.length > 1) {
      return (faces: faces, metrics: FaceQualityMetrics.multipleFaces(faces.length));
    }

    final primaryFace = faces.first;
    final metrics = _evaluateQualityMetrics(
      face: primaryFace,
      imageWidth: image.width,
      imageHeight: image.height,
      yPlaneBytes: image.planes.isNotEmpty ? image.planes[0].bytes : Uint8List(0),
    );

    return (faces: faces, metrics: metrics);
  }

  /// Converts Flutter CameraImage to Google ML Kit InputImage
  InputImage? _convertCameraImageToInputImage(
    CameraImage image,
    CameraDescription camera,
  ) {
    try {
      final sensorOrientation = camera.sensorOrientation;
      InputImageRotation? rotation = InputImageRotationValue.fromRawValue(sensorOrientation);
      if (rotation == null) return null;

      final format = InputImageFormatValue.fromRawValue(image.format.raw);
      if (format == null) return null;

      if (image.planes.isEmpty) return null;

      final WriteBuffer allBytes = WriteBuffer();
      for (final Plane plane in image.planes) {
        allBytes.putUint8List(plane.bytes);
      }
      final bytes = allBytes.done().buffer.asUint8List();

      final inputImageMetadata = InputImageMetadata(
        size: Size(image.width.toDouble(), image.height.toDouble()),
        rotation: rotation,
        format: format,
        bytesPerRow: image.planes[0].bytesPerRow,
      );

      return InputImage.fromBytes(
        bytes: bytes,
        metadata: inputImageMetadata,
      );
    } catch (e) {
      debugPrint('FaceDetectionService: InputImage conversion error: $e');
      return null;
    }
  }

  /// Evaluates lighting, blur, face size ratio, and centering relative to circular guide
  FaceQualityMetrics _evaluateQualityMetrics({
    required Face face,
    required int imageWidth,
    required int imageHeight,
    required Uint8List yPlaneBytes,
  }) {
    final boundingBox = face.boundingBox;

    // 1. Calculate Face Size Ratio
    final faceArea = boundingBox.width * boundingBox.height;
    final frameArea = imageWidth * imageHeight;
    final faceSizeRatio = faceArea / frameArea;
    final isGoodSize = faceSizeRatio >= 0.12 && faceSizeRatio <= 0.65;

    // 2. Centering Check (Offset from center of frame)
    final frameCenterX = imageWidth / 2.0;
    final frameCenterY = imageHeight / 2.0;
    final faceCenterX = boundingBox.center.dx;
    final faceCenterY = boundingBox.center.dy;

    final offsetX = (faceCenterX - frameCenterX).abs() / imageWidth;
    final offsetY = (faceCenterY - frameCenterY).abs() / imageHeight;
    final isCentered = offsetX < 0.20 && offsetY < 0.20;

    // 3. Lighting Score (Average luminance across Y-plane sample)
    double meanLuminance = 0.0;
    if (yPlaneBytes.isNotEmpty) {
      int step = (yPlaneBytes.length / 500).clamp(1, 100).toInt();
      double sum = 0.0;
      int count = 0;
      for (int i = 0; i < yPlaneBytes.length; i += step) {
        sum += yPlaneBytes[i];
        count++;
      }
      meanLuminance = count > 0 ? (sum / count) / 255.0 : 0.5;
    } else {
      meanLuminance = 0.5; // fallback
    }
    final isGoodLighting = meanLuminance >= 0.22 && meanLuminance <= 0.90;

    // 4. Sharpness / Blur estimation
    // Estimate variance from luminance samples
    double blurScore = 0.85; // Default sharp score
    if (yPlaneBytes.length > 1000) {
      double varianceSum = 0.0;
      int count = 0;
      int step = 20;
      for (int i = 0; i < yPlaneBytes.length - 1; i += step) {
        double diff = (yPlaneBytes[i] - yPlaneBytes[i + 1]).abs().toDouble();
        varianceSum += diff;
        count++;
      }
      double avgDiff = count > 0 ? varianceSum / count : 10.0;
      blurScore = (avgDiff / 30.0).clamp(0.0, 1.0);
    }
    final isGoodSharpness = blurScore >= 0.25;

    String? message;
    if (!isCentered) {
      message = 'Center your face inside the guide';
    } else if (!isGoodSize) {
      message = faceSizeRatio < 0.12 ? 'Move closer to the camera' : 'Move further back';
    } else if (!isGoodLighting) {
      message = meanLuminance < 0.22 ? 'Environment too dark' : 'Too much bright light';
    } else if (!isGoodSharpness) {
      message = 'Hold device steady (Blur detected)';
    }

    return FaceQualityMetrics(
      isFaceDetected: true,
      faceCount: 1,
      isCentered: isCentered,
      faceSizeRatio: faceSizeRatio,
      isGoodSize: isGoodSize,
      lightingScore: meanLuminance,
      isGoodLighting: isGoodLighting,
      blurScore: blurScore,
      isGoodSharpness: isGoodSharpness,
      faceBoundingBox: boundingBox,
      qualityMessage: message,
    );
  }

  Future<void> dispose() async {
    await _faceDetector.close();
  }
}
