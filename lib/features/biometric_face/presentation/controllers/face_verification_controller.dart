import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../data/repositories/face_biometric_repository_impl.dart';
import '../../data/services/camera_service.dart';
import '../../data/services/face_detection_service.dart';
import '../../data/services/face_embedding_service.dart';
import '../../data/services/liveness_service.dart';
import '../../domain/models/face_quality_metrics.dart';
import '../../domain/models/verification_result.dart';
import '../../domain/providers/biometric_provider_interface.dart';
import '../../domain/repositories/face_biometric_repository.dart';

class FaceVerificationController extends GetxController {
  final String userId;
  final CameraService cameraService = CameraService();
  final FaceDetectionService faceDetectionService = FaceDetectionService();
  final LivenessService livenessService = LivenessService();
  final IFaceBiometricEngine biometricEngine;
  final IFaceBiometricRepository repository;

  FaceVerificationController({
    required this.userId,
    IFaceBiometricEngine? engine,
    IFaceBiometricRepository? repo,
  })  : biometricEngine = engine ?? DefaultFaceBiometricEngine(),
        repository = repo ?? FaceBiometricRepositoryImpl();

  final RxBool isInitializing = true.obs;
  final RxBool isVerifying = false.obs;
  final RxBool isProcessingFrame = false.obs;
  final RxString feedbackMessage = 'Position your face in front of the camera'.obs;
  final Rx<FaceQualityMetrics> qualityMetrics = FaceQualityMetrics.noFace().obs;

  final Rxn<VerificationResult> verificationResult = Rxn<VerificationResult>();
  Timer? _cooldownTimer;
  final RxInt cooldownSeconds = 0.obs;

  @override
  void onInit() {
    super.onInit();
    startVerificationSession();
  }

  Future<void> startVerificationSession() async {
    isInitializing.value = true;
    isVerifying.value = false;
    verificationResult.value = null;
    feedbackMessage.value = 'Position your face in front of the camera';
    livenessService.reset();

    // 1. Rate Limit Check
    final isLimited = await repository.isRateLimited();
    if (isLimited) {
      final remaining = await repository.getRateLimitCooldownSeconds();
      cooldownSeconds.value = remaining;
      verificationResult.value = VerificationResult.rateLimited(remaining);
      _startCooldownTimer();
      isInitializing.value = false;
      return;
    }

    // 2. Check Enrollment
    final isEnrolled = await repository.isFaceEnrolled(userId);
    if (!isEnrolled) {
      verificationResult.value = VerificationResult.noEnrolledFace();
      isInitializing.value = false;
      return;
    }

    // 3. Initialize Camera
    final ok = await cameraService.initializeFrontCamera();
    if (!ok) {
      verificationResult.value = VerificationResult.failed(
        reason: 'Unable to initialize front camera',
      );
      isInitializing.value = false;
      return;
    }

    isInitializing.value = false;
    _startCameraStreaming();
  }

  void _startCameraStreaming() {
    cameraService.startImageStream((image, description) async {
      if (isProcessingFrame.value || isVerifying.value || verificationResult.value != null) {
        return;
      }
      isProcessingFrame.value = true;

      try {
        final result = await faceDetectionService.processImageFrame(
          image: image,
          cameraDescription: description,
        );

        qualityMetrics.value = result.metrics;

        if (!result.metrics.isOverallQualityValid) {
          feedbackMessage.value = result.metrics.qualityMessage ?? 'Center face with good lighting';
          isProcessingFrame.value = false;
          return;
        }

        final primaryFace = result.faces.first;

        // Step 4. Active Liveness Check (anti photo spoofing)
        final isLive = livenessService.verifyActiveLiveness(primaryFace);
        if (!isLive) {
          feedbackMessage.value = 'Blink or move slightly to verify liveness';
          isProcessingFrame.value = false;
          return;
        }

        // Step 5. Perform Biometric Verification
        await _performBiometricMatch(primaryFace, image.width, image.height);
      } catch (e) {
        debugPrint('FaceVerificationController error: $e');
      } finally {
        isProcessingFrame.value = false;
      }
    });
  }

  Future<void> _performBiometricMatch(Face face, int width, int height) async {
    isVerifying.value = true;
    feedbackMessage.value = 'Verifying biometric signature...';

    try {
      await cameraService.stopImageStream();

      // Retrieve enrolled template
      final enrolledEmbedding = await repository.getEnrolledEmbedding(userId);
      if (enrolledEmbedding == null) {
        verificationResult.value = VerificationResult.noEnrolledFace();
        return;
      }

      // Generate live probe embedding
      final probeEmbedding = await biometricEngine.generateEmbeddingFromFace(
        face: face,
        userId: userId,
        imageWidth: width,
        imageHeight: height,
      );

      // Compare embeddings
      final matchScore = biometricEngine.compareEmbeddings(
        enrolled: enrolledEmbedding,
        probe: probeEmbedding,
      );

      final distance = enrolledEmbedding.euclideanDistance(probeEmbedding);

      if (matchScore >= biometricEngine.matchingThreshold) {
        // SUCCESS
        await repository.resetFailedAttempts();
        verificationResult.value = VerificationResult.success(
          confidence: matchScore,
          similarityDistance: distance,
        );
      } else {
        // FAILURE
        await repository.recordFailedAttempt();
        final isNowLimited = await repository.isRateLimited();

        if (isNowLimited) {
          final remaining = await repository.getRateLimitCooldownSeconds();
          verificationResult.value = VerificationResult.rateLimited(remaining);
          _startCooldownTimer();
        } else {
          verificationResult.value = VerificationResult.failed(
            reason: 'Face match score below threshold ($matchScore% < ${biometricEngine.matchingThreshold}%)',
            confidence: matchScore,
            similarityDistance: distance,
          );
        }
      }
    } finally {
      isVerifying.value = false;
    }
  }

  void _startCooldownTimer() {
    _cooldownTimer?.cancel();
    _cooldownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (cooldownSeconds.value > 0) {
        cooldownSeconds.value--;
      } else {
        timer.cancel();
        startVerificationSession();
      }
    });
  }

  Future<void> retryVerification() async {
    verificationResult.value = null;
    isVerifying.value = false;
    isProcessingFrame.value = false;
    qualityMetrics.value = FaceQualityMetrics.noFace();
    feedbackMessage.value = 'Position your face in front of the camera';
    livenessService.reset();
    await cameraService.stopImageStream();
    await startVerificationSession();
  }

  @override
  void onClose() {
    _cooldownTimer?.cancel();
    cameraService.dispose();
    faceDetectionService.dispose();
    super.onClose();
  }
}
