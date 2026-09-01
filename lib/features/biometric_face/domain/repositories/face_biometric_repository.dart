import '../models/face_embedding.dart';

abstract class IFaceBiometricRepository {
  /// Save encrypted face embedding for enrolled user
  Future<bool> saveEnrolledEmbedding(FaceEmbedding embedding);

  /// Get decrypted face embedding for enrolled user
  Future<FaceEmbedding?> getEnrolledEmbedding(String userId);

  /// Check if user has completed biometric enrollment
  Future<bool> isFaceEnrolled(String userId);

  /// Delete enrolled face biometric template securely
  Future<bool> deleteEnrolledFace(String userId);

  /// Record verification attempt and check rate limit status
  Future<bool> isRateLimited();

  /// Get remaining cooldown duration in seconds if rate limited
  Future<int> getRateLimitCooldownSeconds();

  /// Increment failed attempt counter
  Future<void> recordFailedAttempt();

  /// Reset failed attempt counter on successful verification
  Future<void> resetFailedAttempts();

  /// Save consent status
  Future<void> setConsentGranted(bool granted);

  /// Check consent status
  Future<bool> isConsentGranted();
}
