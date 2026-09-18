import 'dart:ui';

/// Represents real-time frame quality analysis for face biometric capture.
class FaceQualityMetrics {
  final bool isFaceDetected;
  final int faceCount;
  final bool isCentered;
  final double faceSizeRatio; // Bounding box area relative to camera frame / guide
  final bool isGoodSize;
  final double lightingScore; // Estimated brightness (0.0 to 1.0)
  final bool isGoodLighting;
  final double blurScore; // Estimated frame sharpness score
  final bool isGoodSharpness;
  final Rect? faceBoundingBox;
  final String? qualityMessage;

  const FaceQualityMetrics({
    required this.isFaceDetected,
    required this.faceCount,
    required this.isCentered,
    required this.faceSizeRatio,
    required this.isGoodSize,
    required this.lightingScore,
    required this.isGoodLighting,
    required this.blurScore,
    required this.isGoodSharpness,
    this.faceBoundingBox,
    this.qualityMessage,
  });

  /// Factory for empty or no face detected state
  factory FaceQualityMetrics.noFace() {
    return const FaceQualityMetrics(
      isFaceDetected: false,
      faceCount: 0,
      isCentered: false,
      faceSizeRatio: 0.0,
      isGoodSize: false,
      lightingScore: 0.0,
      isGoodLighting: false,
      blurScore: 0.0,
      isGoodSharpness: false,
      qualityMessage: 'No face detected in camera view',
    );
  }

  /// Factory for multiple faces state
  factory FaceQualityMetrics.multipleFaces(int count) {
    return FaceQualityMetrics(
      isFaceDetected: true,
      faceCount: count,
      isCentered: false,
      faceSizeRatio: 0.0,
      isGoodSize: false,
      lightingScore: 0.5,
      isGoodLighting: true,
      blurScore: 0.5,
      isGoodSharpness: true,
      qualityMessage: 'Multiple faces detected! Exactly 1 face required.',
    );
  }

  /// Overall quality evaluation
  bool get isOverallQualityValid =>
      isFaceDetected &&
      faceCount == 1 &&
      isCentered &&
      isGoodSize &&
      isGoodLighting &&
      isGoodSharpness;

  Map<String, dynamic> toJson() => {
        'isFaceDetected': isFaceDetected,
        'faceCount': faceCount,
        'isCentered': isCentered,
        'faceSizeRatio': faceSizeRatio,
        'isGoodSize': isGoodSize,
        'lightingScore': lightingScore,
        'isGoodLighting': isGoodLighting,
        'blurScore': blurScore,
        'isGoodSharpness': isGoodSharpness,
        'qualityMessage': qualityMessage,
      };
}
