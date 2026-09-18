/// Liveness step enum for training and verification workflows.
enum LivenessStepType {
  lookStraight,
  turnLeft,
  turnRight,
  lookUp,
  lookDown,
}

/// Extension helper for LivenessStepType
extension LivenessStepTypeX on LivenessStepType {
  String get title {
    switch (this) {
      case LivenessStepType.lookStraight:
        return 'Look Straight';
      case LivenessStepType.turnLeft:
        return 'Turn Left';
      case LivenessStepType.turnRight:
        return 'Turn Right';
      case LivenessStepType.lookUp:
        return 'Look Up';
      case LivenessStepType.lookDown:
        return 'Look Down';
    }
  }

  String get instruction {
    switch (this) {
      case LivenessStepType.lookStraight:
        return 'Center your face and look directly at the camera';
      case LivenessStepType.turnLeft:
        return 'Slowly turn your head to the left';
      case LivenessStepType.turnRight:
        return 'Slowly turn your head to the right';
      case LivenessStepType.lookUp:
        return 'Tilt your head slightly upwards';
      case LivenessStepType.lookDown:
        return 'Tilt your head slightly downwards';
    }
  }

  /// Expected head Euler angle target parameters
  /// Euler Y: Head turn left/right (+ve is right, -ve is left or vice versa depending on front camera mirror)
  /// Euler X: Pitch up/down (+ve is up, -ve is down)
  Map<String, double> get targetAngleRanges {
    switch (this) {
      case LivenessStepType.lookStraight:
        return {'minY': -12.0, 'maxY': 12.0, 'minX': -12.0, 'maxX': 12.0};
      case LivenessStepType.turnLeft:
        return {'minY': -45.0, 'maxY': -18.0, 'minX': -20.0, 'maxX': 20.0};
      case LivenessStepType.turnRight:
        return {'minY': 18.0, 'maxY': 45.0, 'minX': -20.0, 'maxX': 20.0};
      case LivenessStepType.lookUp:
        return {'minY': -20.0, 'maxY': 20.0, 'minX': 12.0, 'maxX': 45.0};
      case LivenessStepType.lookDown:
        return {'minY': -20.0, 'maxY': 20.0, 'minX': -45.0, 'maxX': -12.0};
    }
  }
}

/// State model tracking current step execution
class LivenessStepState {
  final LivenessStepType step;
  final bool isCompleted;
  final double progress; // 0.0 to 1.0 step progress
  final String? feedback;

  const LivenessStepState({
    required this.step,
    this.isCompleted = false,
    this.progress = 0.0,
    this.feedback,
  });

  LivenessStepState copyWith({
    LivenessStepType? step,
    bool? isCompleted,
    double? progress,
    String? feedback,
  }) {
    return LivenessStepState(
      step: step ?? this.step,
      isCompleted: isCompleted ?? this.isCompleted,
      progress: progress ?? this.progress,
      feedback: feedback ?? this.feedback,
    );
  }
}
