import 'package:flutter/material.dart';
import 'package:get/get.dart';
import '../controllers/face_management_controller.dart';
import '../widgets/biometric_consent_dialog.dart';
import 'face_training_screen.dart';
import 'face_verification_screen.dart';

class BiometricDashboardScreen extends StatelessWidget {
  final String userId;

  const BiometricDashboardScreen({
    super.key,
    this.userId = 'user_default',
  });

  @override
  Widget build(BuildContext context) {
    final controller = Get.put(FaceManagementController(userId: userId));

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text(
          'Biometric Face Security',
          style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 20),
        ),
        centerTitle: true,
      ),
      body: Obx(() {
        if (controller.isLoading.value) {
          return const Center(
            child: CircularProgressIndicator(color: Color(0xFF10B981)),
          );
        }

        final isEnrolled = controller.isEnrolled.value;

        return SingleChildScrollView(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 1. Enrollment Status Banner
              _buildEnrollmentCard(isEnrolled),
              const SizedBox(height: 24),

              // 2. Quick Action Buttons
              const Text(
                'Biometric Actions',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              _buildActionButton(
                title: isEnrolled ? 'Retrain Face Biometrics' : 'Enroll & Train Face',
                subtitle: 'Capture high-quality 5-step guided face template',
                icon: Icons.face_retouching_natural,
                color: const Color(0xFF10B981),
                onTap: () => _handleStartTraining(context, controller),
              ),
              const SizedBox(height: 12),
              _buildActionButton(
                title: 'Verify Face Identity',
                subtitle: 'Authenticate using front camera & dynamic liveness check',
                icon: Icons.verified_user_outlined,
                color: isEnrolled ? const Color(0xFF3B82F6) : Colors.grey,
                enabled: isEnrolled,
                onTap: () => _handleStartVerification(context, controller),
              ),
              const SizedBox(height: 28),

              // 3. Security Highlights Card
              const Text(
                'Biometric Security & Encryption',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 12),
              _buildSecurityInfoCard(),
              const SizedBox(height: 28),

              // 4. Delete Enrolled Face Template
              if (isEnrolled) ...[
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFFEF4444),
                      side: const BorderSide(color: Color(0xFFEF4444), width: 1.5),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    ),
                    icon: const Icon(Icons.delete_forever_outlined),
                    label: const Text(
                      'Revoke & Delete Enrolled Face Data',
                      style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                    ),
                    onPressed: () => _confirmDeleteData(context, controller),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ],
          ),
        );
      }),
    );
  }

  Widget _buildEnrollmentCard(bool isEnrolled) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isEnrolled
              ? [const Color(0xFF065F46), const Color(0xFF047857)]
              : [const Color(0xFF1E293B), const Color(0xFF334155)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: (isEnrolled ? const Color(0xFF047857) : Colors.black).withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 6),
          )
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            child: Icon(
              isEnrolled ? Icons.verified_sharp : Icons.gpp_maybe_outlined,
              color: Colors.white,
              size: 32,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  isEnrolled ? 'Face Biometrics Enrolled' : 'Face Biometrics Not Enrolled',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  isEnrolled
                      ? 'Biometric template is active and encrypted with AES-256.'
                      : 'Enroll your face to enable secure passwordless verification.',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButton({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
    required VoidCallback onTap,
    bool enabled = true,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(18),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF1E293B),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: enabled ? color.withValues(alpha: 0.4) : Colors.white10,
              width: 1.2,
            ),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: enabled ? Colors.white : Colors.white38,
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        color: enabled ? Colors.white60 : Colors.white24,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                color: enabled ? Colors.white54 : Colors.white10,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSecurityInfoCard() {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B).withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: const Column(
        children: [
          _SecurityInfoRow(
            icon: Icons.enhanced_encryption_outlined,
            title: 'Hardware Backed AES-256 Storage',
            subtitle: 'Embeddings are stored using Keychain & EncryptedSharedPreferences.',
          ),
          Divider(color: Colors.white10, height: 20),
          _SecurityInfoRow(
            icon: Icons.shield_outlined,
            title: 'Dynamic Liveness & Anti-Spoofing',
            subtitle: 'Multi-angle pose tracking rejects photo and video presentation attacks.',
          ),
          Divider(color: Colors.white10, height: 20),
          _SecurityInfoRow(
            icon: Icons.timer_outlined,
            title: 'Rate-Limiting Protection',
            subtitle: 'Locks verification for 30s after 3 consecutive failed attempts.',
          ),
        ],
      ),
    );
  }

  Future<void> _handleStartTraining(
    BuildContext context,
    FaceManagementController controller,
  ) async {
    // 1. Consent Dialog if not already granted
    if (!controller.isConsentGranted.value) {
      final consentAccepted = await BiometricConsentDialog.show(context);
      if (!consentAccepted) return;
      await controller.setConsent(true);
    }

    // 2. Navigate to Face Training Screen
    final success = await Get.to<bool>(() => FaceTrainingScreen(userId: userId));
    if (success == true) {
      controller.checkEnrollmentStatus();
    }
  }

  Future<void> _handleStartVerification(
    BuildContext context,
    FaceManagementController controller,
  ) async {
    await Get.to(() => FaceVerificationScreen(userId: userId));
  }

  void _confirmDeleteData(
    BuildContext context,
    FaceManagementController controller,
  ) {
    Get.defaultDialog(
      title: 'Delete Face Data?',
      titleStyle: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
      backgroundColor: const Color(0xFF0F172A),
      contentPadding: const EdgeInsets.all(20),
      content: const Text(
        'Are you sure you want to delete your enrolled face biometric data? You will need to complete training again.',
        style: TextStyle(color: Colors.white70, fontSize: 13),
      ),
      textConfirm: 'Delete',
      confirmTextColor: Colors.white,
      buttonColor: const Color(0xFFEF4444),
      textCancel: 'Cancel',
      cancelTextColor: Colors.white54,
      onConfirm: () async {
        Get.back();
        final success = await controller.deleteEnrolledBiometricData();
        if (success) {
          Get.snackbar(
            'Biometrics Deleted',
            'Enrolled face data removed securely.',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFF10B981),
            colorText: Colors.white,
          );
        }
      },
    );
  }
}

class _SecurityInfoRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;

  const _SecurityInfoRow({
    required this.icon,
    required this.title,
    required this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: const Color(0xFF10B981)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
