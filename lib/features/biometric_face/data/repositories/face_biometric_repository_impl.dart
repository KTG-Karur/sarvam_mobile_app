import '../../domain/models/face_embedding.dart';
import '../../domain/repositories/face_biometric_repository.dart';
import '../services/secure_biometric_storage_service.dart';
import '../../../../services/face_biometric_service.dart';

class FaceBiometricRepositoryImpl implements IFaceBiometricRepository {
  final SecureBiometricStorageService _storageService;

  static const int maxAllowedFailedAttempts = 3;
  static const int lockCooldownDurationSeconds = 30;

  FaceBiometricRepositoryImpl({
    SecureBiometricStorageService? storageService,
  }) : _storageService = storageService ?? SecureBiometricStorageService();

  @override
  Future<bool> saveEnrolledEmbedding(FaceEmbedding embedding) async {
    return await _storageService.saveEmbedding(embedding);
  }

  @override
  Future<FaceEmbedding?> getEnrolledEmbedding(String userId) async {
    return await _storageService.getEmbedding(userId);
  }

  @override
  Future<bool> isFaceEnrolled(String userId) async {
    return await _storageService.hasEnrolledFace(userId);
  }

  @override
  Future<bool> deleteEnrolledFace(String userId) async {
    final deleted = await _storageService.deleteEmbedding(userId);
    if (deleted) {
      await _storageService.resetFailedAttempts();
    }
    // Also clear enrolled features on backend and local prefs
    await FaceBiometricService.clearEnrolledFeatures();
    return deleted;
  }

  @override
  Future<bool> isRateLimited() async {
    final attempts = await _storageService.getFailedAttempts();
    if (attempts < maxAllowedFailedAttempts) {
      return false;
    }

    final lastTs = await _storageService.getLastFailedTimestamp();
    if (lastTs == null) return false;

    final now = DateTime.now().millisecondsSinceEpoch;
    final elapsedSeconds = (now - lastTs) ~/ 1000;

    if (elapsedSeconds >= lockCooldownDurationSeconds) {
      // Cooldown expired, reset failed attempts
      await resetFailedAttempts();
      return false;
    }
    return true;
  }

  @override
  Future<int> getRateLimitCooldownSeconds() async {
    final lastTs = await _storageService.getLastFailedTimestamp();
    if (lastTs == null) return 0;

    final now = DateTime.now().millisecondsSinceEpoch;
    final elapsedSeconds = (now - lastTs) ~/ 1000;
    final remaining = lockCooldownDurationSeconds - elapsedSeconds;
    return remaining > 0 ? remaining : 0;
  }

  @override
  Future<void> recordFailedAttempt() async {
    await _storageService.incrementFailedAttempts();
  }

  @override
  Future<void> resetFailedAttempts() async {
    await _storageService.resetFailedAttempts();
  }

  @override
  Future<void> setConsentGranted(bool granted) async {
    await _storageService.setConsentGranted(granted);
  }

  @override
  Future<bool> isConsentGranted() async {
    return await _storageService.getConsentGranted();
  }
}
