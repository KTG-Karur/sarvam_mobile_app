import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../models/face_embedding.dart';

/// Abstract interface for Face Biometric Engine.
/// Decouples MLKit / FaceNet / AWS / Azure or vendor Face SDKs from application business logic.
abstract class IFaceBiometricEngine {
  /// Engine name identifier (e.g. "MLKit_Geometry_v1", "MobileFaceNet_TFLite", "AWS_Rekognition")
  String get engineName;

  /// Generates a normalized face embedding vector from a detected ML Kit Face object
  Future<FaceEmbedding> generateEmbeddingFromFace({
    required Face face,
    required String userId,
    required int imageWidth,
    required int imageHeight,
  });

  /// Compares two embeddings and returns similarity score (0.0 to 100.0)
  double compareEmbeddings({
    required FaceEmbedding enrolled,
    required FaceEmbedding probe,
  });

  /// Minimum similarity threshold percentage required for verification match
  double get matchingThreshold;
}
