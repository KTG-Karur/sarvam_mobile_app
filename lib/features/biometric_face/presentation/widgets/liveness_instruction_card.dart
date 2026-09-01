import 'package:flutter/material.dart';
import '../../domain/models/liveness_step.dart';

class LivenessInstructionCard extends StatelessWidget {
  final LivenessStepType currentStep;
  final List<LivenessStepType> completedSteps;
  final double currentStepProgress;
  final String activeFeedback;

  const LivenessInstructionCard({
    super.key,
    required this.currentStep,
    required this.completedSteps,
    required this.currentStepProgress,
    required this.activeFeedback,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B).withValues(alpha: 0.90),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Active step title and feedback message
          Text(
            currentStep.title.toUpperCase(),
            style: const TextStyle(
              color: Color(0xFF10B981),
              fontSize: 16,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            activeFeedback.isNotEmpty ? activeFeedback : currentStep.instruction,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 13,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 14),

          // 5-Step horizontal sequence icons
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: LivenessStepType.values.map((step) {
              final isDone = completedSteps.contains(step);
              final isActive = step == currentStep;
              return _buildStepBadge(step, isDone, isActive);
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildStepBadge(LivenessStepType step, bool isDone, bool isActive) {
    Color bg;
    Color iconColor;
    if (isDone) {
      bg = const Color(0xFF10B981);
      iconColor = Colors.white;
    } else if (isActive) {
      bg = const Color(0xFF3B82F6);
      iconColor = Colors.white;
    } else {
      bg = Colors.white.withValues(alpha: 0.1);
      iconColor = Colors.white38;
    }

    IconData icon;
    switch (step) {
      case LivenessStepType.lookStraight:
        icon = Icons.face;
        break;
      case LivenessStepType.turnLeft:
        icon = Icons.turn_left;
        break;
      case LivenessStepType.turnRight:
        icon = Icons.turn_right;
        break;
      case LivenessStepType.lookUp:
        icon = Icons.arrow_drop_up;
        break;
      case LivenessStepType.lookDown:
        icon = Icons.arrow_drop_down;
        break;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: isActive ? 44 : 36,
      height: isActive ? 44 : 36,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
        border: isActive
            ? Border.all(color: Colors.white, width: 2)
            : null,
        boxShadow: isActive
            ? [
                BoxShadow(
                  color: const Color(0xFF3B82F6).withValues(alpha: 0.5),
                  blurRadius: 8,
                  spreadRadius: 2,
                )
              ]
            : null,
      ),
      child: Center(
        child: isDone
            ? const Icon(Icons.check, size: 20, color: Colors.white)
            : Icon(icon, size: isActive ? 22 : 18, color: iconColor),
      ),
    );
  }
}
