import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

/// Represents a secure face biometric embedding vector.
class FaceEmbedding {
  final String userId;
  final List<double> vector;
  final DateTime createdAt;
  final String engineVersion;
  final String checksum;

  FaceEmbedding({
    required this.userId,
    required this.vector,
    required this.createdAt,
    this.engineVersion = 'MLKit_Geometric_v1.0',
    String? checksum,
  }) : checksum = checksum ?? _calculateChecksum(vector);

  /// Compute SHA-256 integrity checksum of embedding vector
  static String _calculateChecksum(List<double> vector) {
    final bytes = utf8.encode(vector.map((e) => e.toStringAsFixed(6)).join(','));
    return sha256.convert(bytes).toString();
  }

  /// Calculates cosine similarity between this embedding and another [other]
  /// Returns a value between -1.0 and 1.0 (1.0 = identical).
  double cosineSimilarity(FaceEmbedding other) {
    if (vector.length != other.vector.length) {
      throw ArgumentError('Embedding dimension mismatch');
    }
    double dotProduct = 0.0;
    double normA = 0.0;
    double normB = 0.0;

    for (int i = 0; i < vector.length; i++) {
      dotProduct += vector[i] * other.vector[i];
      normA += vector[i] * vector[i];
      normB += other.vector[i] * other.vector[i];
    }

    if (normA == 0 || normB == 0) return 0.0;
    return dotProduct / (sqrt(normA) * sqrt(normB));
  }

  /// Calculates Euclidean distance between two embeddings
  double euclideanDistance(FaceEmbedding other) {
    if (vector.length != other.vector.length) {
      throw ArgumentError('Embedding dimension mismatch');
    }
    double sumOfSquares = 0.0;
    for (int i = 0; i < vector.length; i++) {
      final diff = vector[i] - other.vector[i];
      sumOfSquares += diff * diff;
    }
    return sqrt(sumOfSquares);
  }

  /// Converts embedding to JSON map for secure encryption
  Map<String, dynamic> toJson() => {
        'userId': userId,
        'vector': vector,
        'createdAt': createdAt.toIso8601String(),
        'engineVersion': engineVersion,
        'checksum': checksum,
      };

  /// Constructs FaceEmbedding from JSON map
  factory FaceEmbedding.fromJson(Map<String, dynamic> json) {
    return FaceEmbedding(
      userId: json['userId'] as String? ?? 'default_user',
      vector: (json['vector'] as List<dynamic>)
          .map((e) => (e as num).toDouble())
          .toList(),
      createdAt: DateTime.parse(json['createdAt'] as String),
      engineVersion: json['engineVersion'] as String? ?? 'v1.0',
      checksum: json['checksum'] as String?,
    );
  }

  String toRawJson() => jsonEncode(toJson());

  factory FaceEmbedding.fromRawJson(String rawJson) =>
      FaceEmbedding.fromJson(jsonDecode(rawJson) as Map<String, dynamic>);
}
