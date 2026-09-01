import 'package:flutter/material.dart';
import '../../domain/models/face_quality_metrics.dart';

class FaceQualityBadge extends StatelessWidget {
  final FaceQualityMetrics metrics;

  const FaceQualityBadge({
    super.key,
    required this.metrics,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.70),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(
          color: metrics.isOverallQualityValid
              ? const Color(0xFF10B981)
              : const Color(0xFFEF4444),
          width: 1.2,
        ),
      ),
      child: Wrap(
        spacing: 12,
        runSpacing: 4,
        alignment: WrapAlignment.center,
        children: [
          _buildChip(
            label: metrics.faceCount == 1
                ? '1 Face'
                : metrics.faceCount == 0
                    ? 'No Face'
                    : '${metrics.faceCount} Faces',
            isValid: metrics.faceCount == 1,
            icon: Icons.person_outline,
          ),
          _buildChip(
            label: metrics.isGoodLighting ? 'Lighting OK' : 'Bad Lighting',
            isValid: metrics.isGoodLighting,
            icon: Icons.wb_sunny_outlined,
          ),
          _buildChip(
            label: metrics.isGoodSharpness ? 'Sharp' : 'Blurry',
            isValid: metrics.isGoodSharpness,
            icon: Icons.camera_outlined,
          ),
          _buildChip(
            label: metrics.isGoodSize ? 'Distance OK' : 'Adjust Distance',
            isValid: metrics.isGoodSize,
            icon: Icons.straighten_outlined,
          ),
        ],
      ),
    );
  }

  Widget _buildChip({
    required String label,
    required bool isValid,
    required IconData icon,
  }) {
    final color = isValid ? const Color(0xFF10B981) : const Color(0xFFEF4444);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 13, color: color),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 11,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
