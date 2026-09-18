import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/features/biometric_face/domain/models/face_embedding.dart';
import 'package:sarvam/features/biometric_face/data/services/face_embedding_service.dart';

void main() {
  group('FaceEmbedding & Engine Tests', () {
    final now = DateTime.now();

    test('identical vectors should yield 100% cosine similarity', () {
      final emb1 = FaceEmbedding(
        userId: 'user1',
        vector: [0.5, 0.5, 0.5, 0.5],
        createdAt: now,
      );
      final emb2 = FaceEmbedding(
        userId: 'user1',
        vector: [0.5, 0.5, 0.5, 0.5],
        createdAt: now,
      );

      final similarity = emb1.cosineSimilarity(emb2);
      expect(similarity, closeTo(1.0, 0.001));

      final engine = DefaultFaceBiometricEngine();
      final score = engine.compareEmbeddings(enrolled: emb1, probe: emb2);
      expect(score, closeTo(100.0, 0.1));
    });

    test('orthogonal vectors should yield zero similarity score near 0.0%', () {
      final emb1 = FaceEmbedding(
        userId: 'user1',
        vector: [1.0, 0.0, 0.0, 0.0],
        createdAt: now,
      );
      final emb2 = FaceEmbedding(
        userId: 'user1',
        vector: [0.0, 1.0, 0.0, 0.0],
        createdAt: now,
      );

      final engine = DefaultFaceBiometricEngine();
      final score = engine.compareEmbeddings(enrolled: emb1, probe: emb2);
      expect(score, closeTo(0.0, 0.1));
    });

    test('serialization round-trip', () {
      final orig = FaceEmbedding(
        userId: 'user123',
        vector: [0.1, 0.2, 0.3, 0.4],
        createdAt: now,
        engineVersion: 'TestEngine_v1',
      );

      final jsonStr = orig.toRawJson();
      final restored = FaceEmbedding.fromRawJson(jsonStr);

      expect(restored.userId, equals(orig.userId));
      expect(restored.vector, equals(orig.vector));
      expect(restored.checksum, equals(orig.checksum));
    });
  });
}
