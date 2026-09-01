import 'package:flutter/material.dart';
import '../../domain/models/liveness_step.dart';
import 'face_mesh_overlay_painter.dart';
import 'face_scan_guide_painter.dart';

class CircularFaceGuide extends StatelessWidget {
  final bool isValidQuality;
  final LivenessStepType currentStep;
  final double stepProgress; // 0.0 to 1.0
  final double overallProgress; // 0.0 to 1.0

  const CircularFaceGuide({
    super.key,
    required this.isValidQuality,
    required this.currentStep,
    required this.stepProgress,
    required this.overallProgress,
  });

  @override
  Widget build(BuildContext context) {
    final themeColor = isValidQuality ? const Color(0xFF2DD4BF) : const Color(0xFFF59E0B);

    return Stack(
      alignment: Alignment.center,
      children: [
        // 1. AI Mesh Overlay Painter from KTG HR
        CustomPaint(
          size: const Size(260, 320),
          painter: FaceMeshOverlayPainter(
            progress: overallProgress * 100,
            faceDetected: isValidQuality,
          ),
        ),

        // 2. Dotted Oval Guide Painter from KTG HR
        CustomPaint(
          size: const Size(270, 330),
          painter: FaceScanGuidePainter(color: themeColor),
        ),

        // 3. Step directional arrow hint
        Positioned(
          top: 15,
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 300),
            child: _buildDirectionHintIcon(currentStep, themeColor),
          ),
        ),
      ],
    );
  }

  Widget _buildDirectionHintIcon(LivenessStepType step, Color color) {
    IconData icon;
    String text;
    switch (step) {
      case LivenessStepType.lookStraight:
        icon = Icons.center_focus_strong;
        text = 'Center Face';
        break;
      case LivenessStepType.turnLeft:
        icon = Icons.arrow_back_rounded;
        text = 'Turn Left';
        break;
      case LivenessStepType.turnRight:
        icon = Icons.arrow_forward_rounded;
        text = 'Turn Right';
        break;
      case LivenessStepType.lookUp:
        icon = Icons.arrow_upward_rounded;
        text = 'Look Up';
        break;
      case LivenessStepType.lookDown:
        icon = Icons.arrow_downward_rounded;
        text = 'Look Down';
        break;
    }

    return Container(
      key: ValueKey(step),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.75),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withValues(alpha: 0.8), width: 1.5),
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.3),
            blurRadius: 10,
            spreadRadius: 1,
          )
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 8),
          Text(
            text,
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }
}
