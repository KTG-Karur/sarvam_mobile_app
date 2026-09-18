import 'package:flutter/material.dart';
import '../../domain/models/verification_result.dart';

class VerificationResultModal extends StatelessWidget {
  final VerificationResult result;
  final VoidCallback onRetry;
  final VoidCallback onDismiss;

  const VerificationResultModal({
    super.key,
    required this.result,
    required this.onRetry,
    required this.onDismiss,
  });

  static Future<void> show(
    BuildContext context, {
    required VerificationResult result,
    required VoidCallback onRetry,
    required VoidCallback onDismiss,
  }) async {
    await showModalBottomSheet(
      context: context,
      isDismissible: false,
      enableDrag: false,
      backgroundColor: Colors.transparent,
      builder: (ctx) => VerificationResultModal(
        result: result,
        onRetry: () {
          Navigator.of(ctx).pop();
          onRetry();
        },
        onDismiss: () {
          Navigator.of(ctx).pop();
          onDismiss();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isSuccess = result.isSuccess;
    final isRateLimited = result.status == VerificationStatus.rateLimited;
    final cardColor = isSuccess ? const Color(0xFF064E3B) : const Color(0xFF7F1D1D);
    final accentColor = isSuccess ? const Color(0xFF10B981) : const Color(0xFFEF4444);
    final icon = isSuccess
        ? Icons.check_circle_outline_rounded
        : (result.status == VerificationStatus.spoofDetected
            ? Icons.security_rounded
            : Icons.highlight_off_rounded);

    return Container(
      padding: const EdgeInsets.all(28),
      decoration: BoxDecoration(
        color: const Color(0xFF0F172A),
        borderRadius: const BorderRadius.vertical(top: Radius.circular(32)),
        border: Border.all(color: accentColor.withValues(alpha: 0.5), width: 2),
        boxShadow: [
          BoxShadow(
            color: accentColor.withValues(alpha: 0.25),
            blurRadius: 24,
            spreadRadius: 4,
          )
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: cardColor,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: accentColor.withValues(alpha: 0.4),
                  blurRadius: 16,
                )
              ],
            ),
            child: Icon(icon, color: Colors.white, size: 54),
          ),
          const SizedBox(height: 18),
          Text(
            isSuccess ? 'Face Verified' : 'Face Verification Failed',
            style: TextStyle(
              color: isSuccess ? const Color(0xFF10B981) : const Color(0xFFEF4444),
              fontSize: 22,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            result.message,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white70,
              fontSize: 14,
            ),
          ),
          if (isSuccess) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              decoration: BoxDecoration(
                color: const Color(0xFF10B981).withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Text(
                'Match Score: ${result.confidenceScore.toStringAsFixed(1)}%',
                style: const TextStyle(
                  color: Color(0xFF10B981),
                  fontWeight: FontWeight.bold,
                  fontSize: 13,
                ),
              ),
            ),
          ],
          if (isRateLimited && result.cooldownSecondsRemaining != null) ...[
            const SizedBox(height: 12),
            Text(
              'Cooldown timer active: ${result.cooldownSecondsRemaining} seconds',
              style: const TextStyle(
                color: Color(0xFFF59E0B),
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ],
          const SizedBox(height: 24),
          Row(
            children: [
              if (!isSuccess && !isRateLimited) ...[
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.white,
                      side: BorderSide(color: Colors.white.withValues(alpha: 0.3)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(14),
                      ),
                    ),
                    onPressed: onRetry,
                    child: const Text('Retry', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(width: 12),
              ],
              Expanded(
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: accentColor,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  onPressed: onDismiss,
                  child: Text(
                    isSuccess ? 'Continue' : 'Close',
                    style: const TextStyle(fontWeight: FontWeight.bold),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
