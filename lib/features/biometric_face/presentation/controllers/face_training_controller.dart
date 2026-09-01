import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:get/get.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../data/repositories/face_biometric_repository_impl.dart';
import '../../data/services/camera_service.dart';
import '../../data/services/face_detection_service.dart';
import '../../data/services/face_embedding_service.dart';
import '../../data/services/liveness_service.dart';
import '../../domain/models/face_embedding.dart';
import '../../domain/models/face_quality_metrics.dart';
import '../../domain/models/liveness_step.dart';
import '../../domain/providers/biometric_provider_interface.dart';
import '../../domain/repositories/face_biometric_repository.dart';

class FaceTrainingController extends GetxController {
  final String userId;
  final CameraService cameraService = CameraService();
  final FaceDetectionService faceDetectionService = FaceDetectionService();
  final LivenessService livenessService = LivenessService();
  final IFaceBiometricEngine biometricEngine;
  final IFaceBiometricRepository repository;

  FaceTrainingController({
    required this.userId,
    IFaceBiometricEngine? engine,
    IFaceBiometricRepository? repo,
  })  : biometricEngine = engine ?? DefaultFaceBiometricEngine(),
        repository = repo ?? FaceBiometricRepositoryImpl();

  // Reactive UI States
  final RxBool isInitializing = true.obs;
  final RxBool isProcessingFrame = false.obs;
  final RxBool isTrainingCompleted = false.obs;
  final RxBool isTrainingFailed = false.obs;
  final RxString failureReason = ''.obs;

  final Rx<FaceQualityMetrics> qualityMetrics = FaceQualityMetrics.noFace().obs;
  final Rx<LivenessStepType> currentStep = LivenessStepType.lookStraight.obs;
  final RxList<LivenessStepType> completedSteps = <LivenessStepType>[].obs;
  final RxDouble currentStepProgress = 0.0.obs;
  final RxDouble overallProgress = 0.0.obs;
  final RxString activeFeedback = 'Position face inside the circle'.obs;

  // Internal data capture stores
  final List<FaceEmbedding> _capturedEmbeddings = [];
  bool _isStepTransitionLock = false;

  @override
  void onInit() {
    super.onInit();
    startTrainingSession();
  }

  Future<void> startTrainingSession() async {
    isInitializing.value = true;
    isTrainingCompleted.value = false;
    isTrainingFailed.value = false;
    completedSteps.clear();
    _capturedEmbeddings.clear();
    currentStep.value = LivenessStepType.lookStraight;
    overallProgress.value = 0.0;
    currentStepProgress.value = 0.0;
    livenessService.reset();

    final cameraOk = await cameraService.initializeFrontCamera();
    if (!cameraOk) {
      isTrainingFailed.value = true;
      failureReason.value = 'Failed to open front camera';
      isInitializing.value = false;
      return;
    }

    isInitializing.value = false;
    _startCameraStreaming();
  }

  void _startCameraStreaming() {
    cameraService.startImageStream((image, description) async {
      if (isProcessingFrame.value || isTrainingCompleted.value || isTrainingFailed.value || _isStepTransitionLock) {
        return;
      }
      isProcessingFrame.value = true;

      try {
        final result = await faceDetectionService.processImageFrame(
          image: image,
          cameraDescription: description,
        );

        qualityMetrics.value = result.metrics;

        // Step 1: Ensure exactly 1 face and overall quality pass
        if (!result.metrics.isOverallQualityValid) {
          activeFeedback.value = result.metrics.qualityMessage ?? 'Adjust your position';
          isProcessingFrame.value = false;
          return;
        }

        final primaryFace = result.faces.first;

        // Step 2: Evaluate liveness pose for current step
        final eval = livenessService.evaluatePoseForStep(
          face: primaryFace,
          currentStep: currentStep.value,
        );

        currentStepProgress.value = eval.progress;
        activeFeedback.value = eval.feedback;

        if (eval.isStepSatisfied) {
          await _onStepSatisfied(primaryFace, image.width, image.height);
        }
      } catch (e) {
        debugPrint('FaceTrainingController frame error: $e');
      } finally {
        isProcessingFrame.value = false;
      }
    });
  }

  Future<void> _onStepSatisfied(Face face, int width, int height) async {
    _isStepTransitionLock = true;
    try {
      // Capture biometric embedding for satisfied step
      final embedding = await biometricEngine.generateEmbeddingFromFace(
        face: face,
        userId: userId,
        imageWidth: width,
        imageHeight: height,
      );
      _capturedEmbeddings.add(embedding);

      if (!completedSteps.contains(currentStep.value)) {
        completedSteps.add(currentStep.value);
      }

      overallProgress.value = completedSteps.length / LivenessStepType.values.length;

      // Check if training fully completed
      if (completedSteps.length == LivenessStepType.values.length) {
        await _finishTrainingAndSaveTemplate();
      } else {
        // Advance to next step
        final currentIndex = LivenessStepType.values.indexOf(currentStep.value);
        if (currentIndex < LivenessStepType.values.length - 1) {
          currentStep.value = LivenessStepType.values[currentIndex + 1];
          currentStepProgress.value = 0.0;
          activeFeedback.value = currentStep.value.instruction;
          await Future.delayed(const Duration(milliseconds: 600));
        }
      }
    } finally {
      _isStepTransitionLock = false;
    }
  }

  Future<void> _finishTrainingAndSaveTemplate() async {
    await cameraService.stopImageStream();
    if (_capturedEmbeddings.isEmpty) {
      isTrainingFailed.value = true;
      failureReason.value = 'Insufficient frame quality during training';
      return;
    }

    // Aggregate embeddings into single normalized biometric template
    final masterEmbedding = _aggregateEmbeddings(_capturedEmbeddings);

    // Save encrypted embedding to secure storage
    final saved = await repository.saveEnrolledEmbedding(masterEmbedding);
    if (saved) {
      isTrainingCompleted.value = true;
      activeFeedback.value = 'Face Training Complete!';
    } else {
      isTrainingFailed.value = true;
      failureReason.value = 'Failed to securely store face template';
    }
  }

  FaceEmbedding _aggregateEmbeddings(List<FaceEmbedding> list) {
    if (list.length == 1) return list.first;
    int length = list.first.vector.length;
    List<double> avgVector = List<double>.filled(length, 0.0);

    for (final emb in list) {
      for (int i = 0; i < length; i++) {
        avgVector[i] += emb.vector[i];
      }
    }
    for (int i = 0; i < length; i++) {
      avgVector[i] /= list.length;
    }

    return FaceEmbedding(
      userId: userId,
      vector: avgVector,
      createdAt: DateTime.now(),
      engineVersion: biometricEngine.engineName,
    );
  }

  Future<void> retryTraining() async {
    await cameraService.stopImageStream();
    startTrainingSession();
  }

  @override
  void onClose() {
    cameraService.dispose();
    faceDetectionService.dispose();
    super.onClose();
  }
}
