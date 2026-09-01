import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controllers/face_training_controller.dart';
import '../widgets/circular_face_guide.dart';
import '../widgets/face_quality_badge.dart';
import '../widgets/liveness_instruction_card.dart';

class FaceTrainingScreen extends StatelessWidget {
  final String userId;

  const FaceTrainingScreen({
    super.key,
    this.userId = 'user_default',
  });

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(FaceTrainingController(userId: userId));

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
          'Face Enrollment & Training',
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
                CircularProgressIndicator(color: Color(0xFF10B981)),
                SizedBox(height: 16),
                Text(
                  'Initializing Front Camera...',
                  style: TextStyle(color: Colors.white70, fontWeight: FontWeight.w500),
                ),
              ],
            ),
          );
        }

        if (controller.isTrainingFailed.value) {
          return _buildFailureView(controller);
        }

        if (controller.isTrainingCompleted.value) {
          return _buildSuccessView(controller);
        }

        return Stack(
          children: [
            // 1. Camera Preview Stream
            Positioned.fill(
              child: controller.cameraService.controller != null &&
                      controller.cameraService.controller!.value.isInitialized
                  ? CameraPreview(controller.cameraService.controller!)
                  : Container(color: Colors.black),
            ),

            // 2. Center Circular Guide Overlay
            Center(
              child: CircularFaceGuide(
                isValidQuality: controller.qualityMetrics.value.isOverallQualityValid,
                currentStep: controller.currentStep.value,
                stepProgress: controller.currentStepProgress.value,
                overallProgress: controller.overallProgress.value,
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

            // 4. Bottom Guided Liveness Instruction Card
            Positioned(
              bottom: 24,
              left: 0,
              right: 0,
              child: LivenessInstructionCard(
                currentStep: controller.currentStep.value,
                completedSteps: controller.completedSteps,
                currentStepProgress: controller.currentStepProgress.value,
                activeFeedback: controller.activeFeedback.value,
              ),
            ),
          ],
        );
      }),
    );
  }

  Widget _buildSuccessView(FaceTrainingController controller) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.2),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFF10B981), width: 3),
              ),
              child: const Icon(
                Icons.check_circle_rounded,
                color: Color(0xFF10B981),
                size: 72,
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Face Training Complete!',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'Your biometric face template has been generated and securely encrypted in local hardware storage.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 36),
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF10B981),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                onPressed: () => Get.back(result: true),
                child: const Text('Finish & Go to Dashboard', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFailureView(FaceTrainingController controller) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: const Color(0xFFEF4444).withValues(alpha: 0.2),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFEF4444), width: 3),
              ),
              child: const Icon(
                Icons.error_outline_rounded,
                color: Color(0xFFEF4444),
                size: 72,
              ),
            ),
            const SizedBox(height: 24),
            const Text(
              'Training Insufficient',
              style: TextStyle(
                color: Colors.white,
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              controller.failureReason.value.isNotEmpty
                  ? controller.failureReason.value
                  : 'Training could not be completed. Please ensure adequate lighting and follow instructions.',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, fontSize: 14),
            ),
            const SizedBox(height: 36),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: const BorderSide(color: Colors.white38),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    onPressed: () => Get.back(),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF3B82F6),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    onPressed: () => controller.retryTraining(),
                    child: const Text('Retry Training', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
