enum VerificationStatus {
  success,
  failed,
  spoofDetected,
  rateLimited,
  noFaceEnrolled,
  error,
}

class VerificationResult {
  final VerificationStatus status;
  final double confidenceScore; // 0.0 to 100.0%
  final double similarityDistance;
  final String message;
  final int? cooldownSecondsRemaining;
  final DateTime timestamp;

  VerificationResult({
    required this.status,
    required this.confidenceScore,
    required this.similarityDistance,
    required this.message,
    this.cooldownSecondsRemaining,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  bool get isSuccess => status == VerificationStatus.success;

  factory VerificationResult.success({
    required double confidence,
    required double similarityDistance,
  }) {
    return VerificationResult(
      status: VerificationStatus.success,
      confidenceScore: confidence,
      similarityDistance: similarityDistance,
      message: 'Face Verified Successfully',
    );
  }

  factory VerificationResult.failed({
    required String reason,
    double confidence = 0.0,
    double similarityDistance = 1.0,
  }) {
    return VerificationResult(
      status: VerificationStatus.failed,
      confidenceScore: confidence,
      similarityDistance: similarityDistance,
      message: reason,
    );
  }

  factory VerificationResult.spoofDetected() {
    return VerificationResult(
      status: VerificationStatus.spoofDetected,
      confidenceScore: 0.0,
      similarityDistance: 1.0,
      message: 'Face Verification Failed: Potential static photo/video spoof detected',
    );
  }

  factory VerificationResult.rateLimited(int remainingSeconds) {
    return VerificationResult(
      status: VerificationStatus.rateLimited,
      confidenceScore: 0.0,
      similarityDistance: 1.0,
      cooldownSecondsRemaining: remainingSeconds,
      message: 'Too many failed attempts. Try again in $remainingSeconds seconds.',
    );
  }

  factory VerificationResult.noEnrolledFace() {
    return VerificationResult(
      status: VerificationStatus.noFaceEnrolled,
      confidenceScore: 0.0,
      similarityDistance: 1.0,
      message: 'No enrolled face data found. Please complete face training first.',
    );
  }
}
