import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controllers/face_verification_controller.dart';
import '../widgets/circular_face_guide.dart';
import '../widgets/face_quality_badge.dart';
import '../widgets/verification_result_dialog.dart';
import '../../domain/models/liveness_step.dart';

class FaceVerificationScreen extends StatelessWidget {
  final String userId;

  const FaceVerificationScreen({
    super.key,
    this.userId = 'user_default',
  });

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(FaceVerificationController(userId: userId));

    ever(controller.verificationResult, (result) {
      if (result != null && context.mounted) {
        VerificationResultModal.show(
          context,
          result: result,
          onRetry: () {
            Navigator.of(context, rootNavigator: true).pop();
            controller.retryVerification();
          },
          onDismiss: () => Get.back(result: result.isSuccess),
        );
      }
    });

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Colors.white),
          onPressed: () => Get.back(),
        ),
        title: const Text(
          'Face Verification',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
        ),
        centerTitle: true,
      ),
      body: Obx(() {
        if (controller.isInitializing.value) {
          return const Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CircularProgressIndicator(color: Color(0xFF3B82F6)),
                SizedBox(height: 16),
                Text(
                  'Preparing Face Verification...',
                  style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          );
        }

        return Stack(
          children: [
            // 1. Front Camera Preview
            Positioned.fill(
              child: controller.cameraService.controller != null &&
                      controller.cameraService.controller!.value.isInitialized
                  ? CameraPreview(controller.cameraService.controller!)
                  : Container(color: Colors.black),
            ),

            // 2. Circular Guide
            Center(
              child: CircularFaceGuide(
                isValidQuality: controller.qualityMetrics.value.isOverallQualityValid,
                currentStep: LivenessStepType.lookStraight,
                stepProgress: 1.0,
                overallProgress: 1.0,
              ),
            ),

            // 3. Top Real-time Quality Badges
            Positioned(
              top: 12,
              left: 0,
              right: 0,
              child: Center(
                child: FaceQualityBadge(
                  metrics: controller.qualityMetrics.value,
                ),
              ),
            ),

            // 4. Verification Banner / Loading state overlay
            Positioned(
              bottom: 30,
              left: 20,
              right: 20,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                decoration: BoxDecoration(
                  color: const Color(0xFF1E293B).withValues(alpha: 0.92),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.15)),
                ),
                child: Row(
                  children: [
                    if (controller.isVerifying.value) ...[
                      const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Color(0xFF10B981),
                        ),
                      ),
                      const SizedBox(width: 14),
                    ] else ...[
                      const Icon(Icons.face_retouching_natural, color: Color(0xFF3B82F6), size: 24),
                      const SizedBox(width: 14),
                    ],
                    Expanded(
                      child: Text(
                        controller.feedbackMessage.value,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        );
      }),
    );
  }
}
