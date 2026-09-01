import 'dart:math';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import '../../domain/models/liveness_step.dart';

class LivenessService {
  // Motion trace memory to prevent static photo presentation attacks
  final List<({double eulerX, double eulerY, double eulerZ, double timestamp})> _poseHistory = [];
  final int _maxHistoryLength = 20;

  /// Evaluate if current face pose satisfies the target [currentStep]
  ({bool isStepSatisfied, double progress, String feedback}) evaluatePoseForStep({
    required Face face,
    required LivenessStepType currentStep,
  }) {
    final eulerY = face.headEulerAngleY ?? 0.0; // Left/Right turn
    final eulerX = face.headEulerAngleX ?? 0.0; // Up/Down pitch
    final eulerZ = face.headEulerAngleZ ?? 0.0; // Tilt

    // Record motion trace
    _recordMotion(eulerX, eulerY, eulerZ);

    // 1. Check basic photo spoofing flag (zero micro-motion variance over time)
    if (_isStaticPhotoSpoof()) {
      return (
        isStepSatisfied: false,
        progress: 0.0,
        feedback: 'Static image detected! Please move your head naturally.'
      );
    }

    final ranges = currentStep.targetAngleRanges;
    final minY = ranges['minY']!;
    final maxY = ranges['maxY']!;
    final minX = ranges['minX']!;
    final maxX = ranges['maxX']!;

    bool isYValid = eulerY >= minY && eulerY <= maxY;
    bool isXValid = eulerX >= minX && eulerX <= maxX;

    double progress = 0.0;

    switch (currentStep) {
      case LivenessStepType.lookStraight:
        // Needs both X and Y near zero center
        double distFromCenter = sqrt(eulerX * eulerX + eulerY * eulerY);
        progress = (1.0 - (distFromCenter / 20.0)).clamp(0.0, 1.0);
        if (isYValid && isXValid) {
          return (isStepSatisfied: true, progress: 1.0, feedback: 'Great! Hold straight.');
        }
        return (
          isStepSatisfied: false,
          progress: progress,
          feedback: 'Look straight at the camera'
        );

      case LivenessStepType.turnLeft:
        // EulerY usually negative for left turn (or positive depending on sensor/mirroring)
        // We check magnitude and direction
        double targetMagnitude = (minY.abs() + maxY.abs()) / 2.0;
        double currentAngle = eulerY < 0 ? eulerY.abs() : 0.0;
        progress = (currentAngle / targetMagnitude).clamp(0.0, 1.0);
        if (isYValid || eulerY.abs() >= 18.0) {
          return (isStepSatisfied: true, progress: 1.0, feedback: 'Left turn verified!');
        }
        return (
          isStepSatisfied: false,
          progress: progress,
          feedback: 'Turn head slowly to your left'
        );

      case LivenessStepType.turnRight:
        double targetMagnitude = (minY.abs() + maxY.abs()) / 2.0;
        double currentAngle = eulerY > 0 ? eulerY : 0.0;
        progress = (currentAngle / targetMagnitude).clamp(0.0, 1.0);
        if (isYValid || eulerY >= 18.0) {
          return (isStepSatisfied: true, progress: 1.0, feedback: 'Right turn verified!');
        }
        return (
          isStepSatisfied: false,
          progress: progress,
          feedback: 'Turn head slowly to your right'
        );

      case LivenessStepType.lookUp:
        double currentAngle = eulerX > 0 ? eulerX : 0.0;
        progress = (currentAngle / 20.0).clamp(0.0, 1.0);
        if (isXValid || eulerX >= 12.0) {
          return (isStepSatisfied: true, progress: 1.0, feedback: 'Look up verified!');
        }
        return (
          isStepSatisfied: false,
          progress: progress,
          feedback: 'Tilt head slightly upwards'
        );

      case LivenessStepType.lookDown:
        double currentAngle = eulerX < 0 ? eulerX.abs() : 0.0;
        progress = (currentAngle / 20.0).clamp(0.0, 1.0);
        if (isXValid || eulerX <= -12.0) {
          return (isStepSatisfied: true, progress: 1.0, feedback: 'Look down verified!');
        }
        return (
          isStepSatisfied: false,
          progress: progress,
          feedback: 'Tilt head slightly downwards'
        );
    }
  }

  /// Perform active dynamic verification check (for quick verification screen)
  /// Checks for head rotation or natural eye blink to prevent presentation attack
  bool verifyActiveLiveness(Face face) {
    final leftEyeOpen = face.leftEyeOpenProbability ?? 1.0;
    final rightEyeOpen = face.rightEyeOpenProbability ?? 1.0;
    final eulerY = (face.headEulerAngleY ?? 0.0).abs();
    final eulerX = (face.headEulerAngleX ?? 0.0).abs();

    // Natural face must exhibit slight dynamic angle variance or eye blink probability
    bool hasNaturalBlinkOrMovement = (leftEyeOpen < 0.85 || rightEyeOpen < 0.85) ||
        (eulerY > 2.0 || eulerX > 2.0);

    return hasNaturalBlinkOrMovement && !_isStaticPhotoSpoof();
  }

  void _recordMotion(double x, double y, double z) {
    _poseHistory.add((
      eulerX: x,
      eulerY: y,
      eulerZ: z,
      timestamp: DateTime.now().millisecondsSinceEpoch.toDouble(),
    ));
    if (_poseHistory.length > _maxHistoryLength) {
      _poseHistory.removeAt(0);
    }
  }

  /// Anti-spoof check: If 15+ consecutive frames have exact zero change in angles, it's a printed photo
  bool _isStaticPhotoSpoof() {
    if (_poseHistory.length < 12) return false;
    double varX = 0.0;
    double varY = 0.0;
    final meanX = _poseHistory.map((e) => e.eulerX).reduce((a, b) => a + b) / _poseHistory.length;
    final meanY = _poseHistory.map((e) => e.eulerY).reduce((a, b) => a + b) / _poseHistory.length;

    for (final pose in _poseHistory) {
      varX += (pose.eulerX - meanX) * (pose.eulerX - meanX);
      varY += (pose.eulerY - meanY) * (pose.eulerY - meanY);
    }

    // Unnatural complete freeze check (variance near 0 for active live video stream)
    return (varX < 0.0001 && varY < 0.0001);
  }

  void reset() {
    _poseHistory.clear();
  }
}
