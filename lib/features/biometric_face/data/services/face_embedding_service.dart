import 'dart:math';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../domain/models/face_embedding.dart';
import '../../domain/providers/biometric_provider_interface.dart';

/// Default Face Biometric Engine implementation using MLKit facial geometry vector extraction.
/// Can be replaced with MobileFaceNet TFLite, AWS Rekognition, or vendor SDK by providing another IFaceBiometricEngine.
class DefaultFaceBiometricEngine implements IFaceBiometricEngine {
  @override
  String get engineName => 'MLKit_Facial_Geometry_v1.0';

  @override
  double get matchingThreshold => 60.0; // 60.0% similarity score required for match

  @override
  Future<FaceEmbedding> generateEmbeddingFromFace({
    required Face face,
    required String userId,
    required int imageWidth,
    required int imageHeight,
  }) async {
    final boundingBox = face.boundingBox;
    final boxWidth = boundingBox.width > 0 ? boundingBox.width : 1.0;
    final boxHeight = boundingBox.height > 0 ? boundingBox.height : 1.0;
    final boxDiag = sqrt(boxWidth * boxWidth + boxHeight * boxHeight);

    // Extract landmarks
    final leftEye = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final rightEye = face.landmarks[FaceLandmarkType.rightEye]?.position;
    final noseBase = face.landmarks[FaceLandmarkType.noseBase]?.position;
    final bottomMouth = face.landmarks[FaceLandmarkType.bottomMouth]?.position;
    final leftMouth = face.landmarks[FaceLandmarkType.leftMouth]?.position;
    final rightMouth = face.landmarks[FaceLandmarkType.rightMouth]?.position;
    final leftEar = face.landmarks[FaceLandmarkType.leftEar]?.position;
    final rightEar = face.landmarks[FaceLandmarkType.rightEar]?.position;
    final leftCheek = face.landmarks[FaceLandmarkType.leftCheek]?.position;
    final rightCheek = face.landmarks[FaceLandmarkType.rightCheek]?.position;

    // Feature vector values (normalized relative to bounding box scale to ensure scale invariance)
    final List<double> rawFeatures = [];

    // 1. Eye-to-Eye distance
    double eyeDist = (leftEye != null && rightEye != null)
        ? _distance(leftEye, rightEye) / boxDiag
        : 0.25;
    rawFeatures.add(eyeDist);

    // 2. Nose-to-LeftEye & Nose-to-RightEye
    if (noseBase != null && leftEye != null && rightEye != null) {
      rawFeatures.add(_distance(noseBase, leftEye) / boxDiag);
      rawFeatures.add(_distance(noseBase, rightEye) / boxDiag);
    } else {
      rawFeatures.addAll([0.18, 0.18]);
    }

    // 3. Mouth width & Mouth-to-Nose
    if (leftMouth != null && rightMouth != null) {
      rawFeatures.add(_distance(leftMouth, rightMouth) / boxDiag);
    } else {
      rawFeatures.add(0.20);
    }

    if (bottomMouth != null && noseBase != null) {
      rawFeatures.add(_distance(bottomMouth, noseBase) / boxDiag);
    } else {
      rawFeatures.add(0.15);
    }

    // 4. Cheek-to-Cheek distance
    if (leftCheek != null && rightCheek != null) {
      rawFeatures.add(_distance(leftCheek, rightCheek) / boxDiag);
    } else {
      rawFeatures.add(0.35);
    }

    // 5. Ear-to-Ear distance
    if (leftEar != null && rightEar != null) {
      rawFeatures.add(_distance(leftEar, rightEar) / boxDiag);
    } else {
      rawFeatures.add(0.45);
    }

    // 6. Add contour polygon point ratios if available
    for (final contourType in FaceContourType.values) {
      final contour = face.contours[contourType];
      if (contour != null && contour.points.isNotEmpty) {
        // Sample first, middle, last points
        final pts = contour.points;
        final p1 = pts.first;
        final p2 = pts[pts.length ~/ 2];
        final p3 = pts.last;
        rawFeatures.add(((p1.x - boundingBox.left) / boxWidth).clamp(0.0, 1.0));
        rawFeatures.add(((p1.y - boundingBox.top) / boxHeight).clamp(0.0, 1.0));
        rawFeatures.add(((p2.x - boundingBox.left) / boxWidth).clamp(0.0, 1.0));
        rawFeatures.add(((p2.y - boundingBox.top) / boxHeight).clamp(0.0, 1.0));
        rawFeatures.add(((p3.x - boundingBox.left) / boxWidth).clamp(0.0, 1.0));
        rawFeatures.add(((p3.y - boundingBox.top) / boxHeight).clamp(0.0, 1.0));
      }
    }

    // Ensure fixed dimension vector (e.g. 64 dimensions by padding or normalizing)
    final List<double> normalizedVector = _normalizeToFixedLength(rawFeatures, 64);

    return FaceEmbedding(
      userId: userId,
      vector: normalizedVector,
      createdAt: DateTime.now(),
      engineVersion: engineName,
    );
  }

  @override
  double compareEmbeddings({
    required FaceEmbedding enrolled,
    required FaceEmbedding probe,
  }) {
    final cosineSim = enrolled.cosineSimilarity(probe);
    // Convert Cosine Similarity (-1 to 1) into percentage score (0% to 100%)
    double similarityPercent = ((cosineSim + 1.0) / 2.0) * 100.0;
    return similarityPercent.clamp(0.0, 100.0);
  }

  double _distance(Point<int> p1, Point<int> p2) {
    final dx = (p1.x - p2.x).toDouble();
    final dy = (p1.y - p2.y).toDouble();
    return sqrt(dx * dx + dy * dy);
  }

  List<double> _normalizeToFixedLength(List<double> raw, int targetLength) {
    List<double> result = List<double>.filled(targetLength, 0.0);
    for (int i = 0; i < targetLength; i++) {
      if (i < raw.length) {
        result[i] = raw[i];
      } else {
        result[i] = (i % 2 == 0) ? 0.05 * (i / targetLength) : 0.02;
      }
    }

    // L2 Normalization
    double sumSquares = result.fold(0.0, (sum, val) => sum + val * val);
    double norm = sqrt(sumSquares);
    if (norm > 0) {
      for (int i = 0; i < targetLength; i++) {
        result[i] = result[i] / norm;
      }
    }
    return result;
  }
}
