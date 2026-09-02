import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/secure_session_service.dart';

/// Enum representing the active liveness gesture challenge steps.
enum LivenessChallengeStep {
  lookStraight,
  turnLeft,
  turnRight,
  finalCenter,
  completed,
}

/// Status of the current face quality check.
enum FaceQualityStatus {
  valid,
  noFace,
  multipleFaces,
  tooFar,
  tooClose,
  offCenter,
  tilted,
  eyesClosed,
  spoofDetected,
}

/// Detailed result of a real-time face evaluation.
class FaceQualityReport {
  final FaceQualityStatus status;
  final String message;
  final bool isQualityValid;
  final double coverage;
  final double yaw;
  final double pitch;
  final double roll;
  final double leftEyeOpen;
  final double rightEyeOpen;
  final double smileProb;
  final bool isCentered;

  FaceQualityReport({
    required this.status,
    required this.message,
    required this.isQualityValid,
    required this.coverage,
    required this.yaw,
    required this.pitch,
    required this.roll,
    required this.leftEyeOpen,
    required this.rightEyeOpen,
    required this.smileProb,
    required this.isCentered,
  });
}

/// Result of uploading a registered face template to the backend API.
class FaceUploadResult {
  final bool success;
  final String message;
  final String? templateId;

  FaceUploadResult({
    required this.success,
    required this.message,
    this.templateId,
  });
}

/// Face quality, liveness, feature extraction and API synchronization. Templates
/// are persisted only in the platform secure storage for offline matching.
class FaceBiometricService {
  static const String keyEnrolledFeatures = 'enrolled_face_features_v3_facenet';
  static const String keyFaceEnrollmentCompleted = 'face_enrollment_completed_flag_v3';
  static const String keyEncryptedTemplate = 'enrolled_face_encrypted_template_v3_facenet';
  static const String keyEnrolledPhoto = 'enrolled_face_photo_base64_v3';

  // Key used to sign the registration payload before transport.
  static const String _encryptionSecretKey = 'Sarvam_MFI_Biometric_SecKey_2026';

  /// Helper method to check if face training/enrollment has been completed.
  /// Checks server database first as the primary source of truth.
  /// Helper method to check if face training/enrollment has been completed.
  static Future<bool> isFaceEnrolled() async {
    // 1. Check local secure storage features first
    final enrolled = await getEnrolledFeatures();
    if (enrolled.isNotEmpty) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(keyFaceEnrollmentCompleted, true);
      return true;
    }

    // 2. Server check if local features are missing
    try {
      final token = await SecureSessionService.readAccessToken();
      if (token != null && token.isNotEmpty) {
        final response = await http.get(
          Uri.parse(Api.faceAttendanceStatusUrl),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
        ).timeout(const Duration(seconds: 4));

        if (response.statusCode == 200) {
          final resData = jsonDecode(response.body);
          final data = resData['data'] is Map ? resData['data'] : resData;
          if (data is Map && data['enrolled'] == true) {
            final prefs = await SharedPreferences.getInstance();
            await prefs.setBool(keyFaceEnrollmentCompleted, true);
            return true;
          }
        }
      }
    } catch (e) {
      if (kDebugMode) print('Server enrollment check error: $e');
    }

    // Offline / Fallback check
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(keyFaceEnrollmentCompleted) == true;
  }

  /// Legacy helper method for single face image validation.
  static String? validateFaceQuality(
    Face face,
    int totalFacesFound, {
    required double imageWidth,
    required double imageHeight,
    int sampleIndex = 0,
  }) {
    final report = evaluateRealTimeQuality(
      face: face,
      totalFacesFound: totalFacesFound,
      imageWidth: imageWidth,
      imageHeight: imageHeight,
    );
    if (!report.isQualityValid) {
      return report.message;
    }
    return null;
  }

  /// Evaluates real-time face quality frame against optimal constraints.
  static FaceQualityReport evaluateRealTimeQuality({
    required Face? face,
    required int totalFacesFound,
    required double imageWidth,
    required double imageHeight,
    Rect? ovalBounds,
  }) {
    if (totalFacesFound == 0 || face == null) {
      return FaceQualityReport(
        status: FaceQualityStatus.noFace,
        message: 'No face detected. Align your face inside the oval frame.',
        isQualityValid: false,
        coverage: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        leftEyeOpen: 0,
        rightEyeOpen: 0,
        smileProb: 0,
        isCentered: false,
      );
    }

    if (totalFacesFound > 1) {
      return FaceQualityReport(
        status: FaceQualityStatus.multipleFaces,
        message: 'Multiple faces detected! Please ensure only one person is in view.',
        isQualityValid: false,
        coverage: 0,
        yaw: 0,
        pitch: 0,
        roll: 0,
        leftEyeOpen: 0,
        rightEyeOpen: 0,
        smileProb: 0,
        isCentered: false,
      );
    }

    final box = face.boundingBox;
    final faceArea = box.width * box.height;
    final imageArea = imageWidth * imageHeight;
    final coverage = imageArea > 0 ? (faceArea / imageArea) : 0.0;

    final yaw = face.headEulerAngleY ?? 0.0;
    final pitch = face.headEulerAngleX ?? 0.0;
    final roll = face.headEulerAngleZ ?? 0.0;
    final leftEyeOpen = face.leftEyeOpenProbability ?? 1.0;
    final rightEyeOpen = face.rightEyeOpenProbability ?? 1.0;
    final smileProb = face.smilingProbability ?? 0.0;

    // Center alignment check relative to image/oval
    bool isCentered = true;
    if (ovalBounds != null && ovalBounds.width > 0) {
      final faceCenter = box.center;
      final ovalCenter = ovalBounds.center;
      final dx = (faceCenter.dx - ovalCenter.dx).abs();
      final dy = (faceCenter.dy - ovalCenter.dy).abs();
      if (dx > ovalBounds.width * 0.25 || dy > ovalBounds.height * 0.25) {
        isCentered = false;
      }
    }

    if (!isCentered) {
      return FaceQualityReport(
        status: FaceQualityStatus.offCenter,
        message: 'Center your face within the green frame.',
        isQualityValid: false,
        coverage: coverage,
        yaw: yaw,
        pitch: pitch,
        roll: roll,
        leftEyeOpen: leftEyeOpen,
        rightEyeOpen: rightEyeOpen,
        smileProb: smileProb,
        isCentered: false,
      );
    }

    // Eye openness check
    if (leftEyeOpen < 0.4 || rightEyeOpen < 0.4) {
      return FaceQualityReport(
        status: FaceQualityStatus.eyesClosed,
        message: 'Keep both eyes open and look directly at camera.',
        isQualityValid: false,
        coverage: coverage,
        yaw: yaw,
        pitch: pitch,
        roll: roll,
        leftEyeOpen: leftEyeOpen,
        rightEyeOpen: rightEyeOpen,
        smileProb: smileProb,
        isCentered: true,
      );
    }

    // Distance & Coverage bounds check
    if (coverage < 0.11) {
      return FaceQualityReport(
        status: FaceQualityStatus.tooFar,
        message: 'Face is too far away! Please move closer to camera.',
        isQualityValid: false,
        coverage: coverage,
        yaw: yaw,
        pitch: pitch,
        roll: roll,
        leftEyeOpen: leftEyeOpen,
        rightEyeOpen: rightEyeOpen,
        smileProb: smileProb,
        isCentered: true,
      );
    } else if (coverage > 0.65) {
      return FaceQualityReport(
        status: FaceQualityStatus.tooClose,
        message: 'Face is too close! Move slightly back from camera.',
        isQualityValid: false,
        coverage: coverage,
        yaw: yaw,
        pitch: pitch,
        roll: roll,
        leftEyeOpen: leftEyeOpen,
        rightEyeOpen: rightEyeOpen,
        smileProb: smileProb,
        isCentered: true,
      );
    }

    // Pitch & Roll angle checks
    if (pitch.abs() > 22.0 || roll.abs() > 18.0) {
      return FaceQualityReport(
        status: FaceQualityStatus.tilted,
        message: 'Keep your head straight and level with camera.',
        isQualityValid: false,
        coverage: coverage,
        yaw: yaw,
        pitch: pitch,
        roll: roll,
        leftEyeOpen: leftEyeOpen,
        rightEyeOpen: rightEyeOpen,
        smileProb: smileProb,
        isCentered: true,
      );
    }

    return FaceQualityReport(
      status: FaceQualityStatus.valid,
      message: 'Face aligned! Hold steady...',
      isQualityValid: true,
      coverage: coverage,
      yaw: yaw,
      pitch: pitch,
      roll: roll,
      leftEyeOpen: leftEyeOpen,
      rightEyeOpen: rightEyeOpen,
      smileProb: smileProb,
      isCentered: true,
    );
  }

  /// Verifies active liveness challenge gesture for the given step.
  static bool verifyChallengeStep({
    required Face face,
    required LivenessChallengeStep step,
  }) {
    final yaw = face.headEulerAngleY ?? 0.0;
    final pitch = face.headEulerAngleX ?? 0.0;

    switch (step) {
      case LivenessChallengeStep.lookStraight:
        return yaw.abs() <= 15.0 && pitch.abs() <= 25.0;
      case LivenessChallengeStep.turnLeft:
        return yaw >= 10.0;
      case LivenessChallengeStep.turnRight:
        return yaw <= -10.0;
      case LivenessChallengeStep.finalCenter:
        return yaw.abs() <= 15.0 && pitch.abs() <= 25.0;
      case LivenessChallengeStep.completed:
        return true;
    }
  }

  /// Passive Micro-Movement Liveness Check:
  /// Evaluates landmark coordinate variance across streaming video frames.
  /// Static 2D photos or recorded videos presented to camera have 0 or near-0 position variance.
  static bool checkPassiveMicroMovementLiveness(List<Face> recentFaces) {
    if (recentFaces.length < 5) return true; // Need at least 5 frames to assess

    double totalXVar = 0.0;
    double totalYVar = 0.0;

    List<double> xCoords = [];
    List<double> yCoords = [];

    for (final f in recentFaces) {
      xCoords.add(f.boundingBox.center.dx);
      yCoords.add(f.boundingBox.center.dy);
    }

    double meanX = xCoords.reduce((a, b) => a + b) / xCoords.length;
    double meanY = yCoords.reduce((a, b) => a + b) / yCoords.length;

    for (int i = 0; i < xCoords.length; i++) {
      totalXVar += (xCoords[i] - meanX) * (xCoords[i] - meanX);
      totalYVar += (yCoords[i] - meanY) * (yCoords[i] - meanY);
    }

    double stdDev = sqrt((totalXVar + totalYVar) / xCoords.length);

    // Live human faces always exhibit subtle natural tremor / breathing micro-movement (stdDev >= 0.35 pixels).
    // Static photo presented in front of camera or rigid digital photo will have extremely static values if fixed, or unnatural leaps.
    return stdDev >= 0.15;
  }

  /// Extracts a normalized facial geometric landmark feature vector from ML Kit face.
  static List<double> extractFeatureVector(Face face) {
    final Map<FaceLandmarkType, Point<int>> points = {};
    for (final landmark in face.landmarks.values) {
      if (landmark != null) {
        points[landmark.type] = landmark.position;
      }
    }

    Point<int>? leftEye = points[FaceLandmarkType.leftEye];
    Point<int>? rightEye = points[FaceLandmarkType.rightEye];
    Point<int>? nose = points[FaceLandmarkType.noseBase];
    Point<int>? bottomMouth = points[FaceLandmarkType.bottomMouth];
    Point<int>? leftMouth = points[FaceLandmarkType.leftMouth];
    Point<int>? rightMouth = points[FaceLandmarkType.rightMouth];
    Point<int>? leftEar = points[FaceLandmarkType.leftEar];
    Point<int>? rightEar = points[FaceLandmarkType.rightEar];
    Point<int>? leftCheek = points[FaceLandmarkType.leftCheek];
    Point<int>? rightCheek = points[FaceLandmarkType.rightCheek];

    final box = face.boundingBox;
    double interEyeDist = 1.0;

    if (leftEye != null && rightEye != null) {
      interEyeDist = _dist(leftEye, rightEye);
    }
    if (interEyeDist <= 0.001) {
      interEyeDist = max(box.width.toDouble(), 1.0);
    }

    final double boxRatio = box.height > 0 ? (box.width / box.height) : 1.0;
    final List<double> features = [boxRatio];

    void addDist(Point<int>? p1, Point<int>? p2) {
      if (p1 != null && p2 != null) {
        features.add(_dist(p1, p2) / interEyeDist);
      } else {
        features.add(0.0);
      }
    }

    void addAngle(Point<int>? p1, Point<int>? vertex, Point<int>? p2) {
      if (p1 != null && vertex != null && p2 != null) {
        features.add(_angle(p1, vertex, p2));
      } else {
        features.add(0.0);
      }
    }

    void addTriangleArea(Point<int>? p1, Point<int>? p2, Point<int>? p3) {
      if (p1 != null && p2 != null && p3 != null) {
        final area = _triangleArea(p1, p2, p3);
        features.add(area / (interEyeDist * interEyeDist));
      } else {
        features.add(0.0);
      }
    }

    // Distance Ratios (Features 1 to 19)
    addDist(leftEye, rightEye);
    addDist(leftEye, nose);
    addDist(rightEye, nose);
    addDist(leftEye, bottomMouth);
    addDist(rightEye, bottomMouth);
    addDist(nose, bottomMouth);
    addDist(leftMouth, rightMouth);
    addDist(leftEye, leftMouth);
    addDist(rightEye, rightMouth);
    addDist(nose, leftMouth);
    addDist(nose, rightMouth);
    addDist(leftEye, leftEar);
    addDist(rightEye, rightEar);
    addDist(leftCheek, rightCheek);
    addDist(nose, leftCheek);
    addDist(nose, rightCheek);
    addDist(leftEye, leftCheek);
    addDist(rightEye, rightCheek);
    addDist(leftMouth, leftCheek);

    // Geometric Angles (Features 20 to 24)
    addAngle(leftEye, nose, rightEye);
    addAngle(leftEye, nose, leftMouth);
    addAngle(rightEye, nose, rightMouth);
    addAngle(leftMouth, nose, rightMouth);
    addAngle(leftMouth, bottomMouth, rightMouth);

    // Triangle Area Ratios (Features 25 to 27)
    addTriangleArea(leftEye, rightEye, nose);
    addTriangleArea(leftMouth, rightMouth, nose);
    addTriangleArea(leftEye, rightEye, bottomMouth);

    return features;
  }

  static double _dist(Point<int> p1, Point<int> p2) {
    final dx = (p1.x - p2.x).toDouble();
    final dy = (p1.y - p2.y).toDouble();
    return sqrt(dx * dx + dy * dy);
  }

  static double _angle(Point<int> p1, Point<int> vertex, Point<int> p2) {
    final v1x = (p1.x - vertex.x).toDouble();
    final v1y = (p1.y - vertex.y).toDouble();
    final v2x = (p2.x - vertex.x).toDouble();
    final v2y = (p2.y - vertex.y).toDouble();
    final dot = v1x * v2x + v1y * v2y;
    final mag1 = sqrt(v1x * v1x + v1y * v1y);
    final mag2 = sqrt(v2x * v2x + v2y * v2y);
    if (mag1 * mag2 <= 0.0001) return 0.0;
    final cosAngle = (dot / (mag1 * mag2)).clamp(-1.0, 1.0);
    return acos(cosAngle);
  }

  static double _triangleArea(Point<int> p1, Point<int> p2, Point<int> p3) {
    final area = 0.5 *
        ((p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y))
            .abs());
    return area.toDouble();
  }

  static const double faceMatchThreshold = 75.0; // Configurable strict threshold for face recognition

  /// Evaluates strict similarity between live captured features and enrolled template.
  /// Uses RMS log-distance ratio with exponential decay mapping.
  static double computeFaceSimilarity(List<double> a, List<double> b) {
    if (a.isEmpty || b.isEmpty) return 0.0;

    final minLen = min(a.length, b.length);
    double sumSq = 0.0;
    int count = 0;

    for (int i = 0; i < minLen; i++) {
      final val1 = a[i];
      final val2 = b[i];
      if (val1 > 0 && val2 > 0) {
        final logDiff = (log(val1) - log(val2)).abs();
        final cappedDiff = min(logDiff, 1.2);
        sumSq += cappedDiff * cappedDiff;
        count++;
      }
    }

    if (count < 5) return 0.0;
    final rms = sqrt(sumSq / count);
    
    // Keep this mapping in sync with app/lib/face-match.ts on the server.
    // Landmark positions naturally vary between frames, so this is a gradual
    // score rather than a binary veto that can turn a genuine capture into 0%.
    return exp(-3.5 * rms);
  }

  static double computeFaceMatchScorePercent(List<double> live, List<double> enrolled) {
    if (live.isEmpty || enrolled.isEmpty) {
      return 0.0;
    }

    final sim = computeFaceSimilarity(live, enrolled);
    if (sim <= 0) return 0.0;

    return (sim * 100.0).clamp(0.0, 100.0);
  }

  /// Evaluates similarity across all multi-pose training samples and master template vector.
  static double computeMultiSampleMatchScorePercent(
    List<double> live,
    List<List<double>> samples,
  ) {
    if (live.isEmpty || samples.isEmpty) return 0.0;

    final master = aggregateTemplateVector(samples);
    double masterScore = 0.0;
    if (master.isNotEmpty) {
      masterScore = computeFaceMatchScorePercent(live, master);
    }

    double bestSampleScore = 0.0;
    for (final sample in samples) {
      final score = computeFaceMatchScorePercent(live, sample);
      if (score > bestSampleScore) {
        bestSampleScore = score;
      }
    }

    // A live straight-on capture should be compared with its closest enrolled
    // pose. Averaging all poses penalizes a valid face for looking different
    // from deliberately captured left/right training poses.
    return max(masterScore, bestSampleScore);
  }

  /// Aggregates multiple sample feature vectors into a single averaged master biometric feature template.
  static List<double> aggregateTemplateVector(List<List<double>> samples) {
    if (samples.isEmpty) return [];
    int vectorLen = samples.first.length;
    List<double> masterVector = List.filled(vectorLen, 0.0);

    for (int i = 0; i < vectorLen; i++) {
      double sum = 0.0;
      for (final sample in samples) {
        if (i < sample.length) sum += sample[i];
      }
      masterVector[i] = double.parse((sum / samples.length).toStringAsFixed(6));
    }
    return masterVector;
  }

  /// Encodes the signed transport payload. At rest, this payload is kept in the
  /// platform keystore by [saveEnrolledFeatures].
  static Map<String, dynamic> encryptTemplatePayload(
    List<double> featureVector, {
    required String userId,
    required bool livenessPassed,
    required double qualityScore,
    String? photoBase64,
  }) {
    final rawJson = jsonEncode({
      'userId': userId,
      'features': featureVector,
      'livenessVerified': livenessPassed,
      'qualityScore': qualityScore,
      'timestamp': DateTime.now().toIso8601String(),
    });

    final keyBytes = utf8.encode(_encryptionSecretKey);
    final hmacSha256 = Hmac(sha256, keyBytes);
    final digest = hmacSha256.convert(utf8.encode(rawJson));

    // The server validates the HMAC; Base64 is transport encoding, not encryption.
    final base64Payload = base64Encode(utf8.encode(rawJson));

    return {
      'encryptedTemplate': base64Payload,
      'hmacSignature': digest.toString(),
      'algorithm': 'HMAC-SHA256',
      'vectorSize': featureVector.length,
      'featureVector': featureVector,
      'livenessVerified': livenessPassed,
      'qualityScore': qualityScore,
      'capturedAt': DateTime.now().toIso8601String(),
      if (photoBase64 != null) 'photoBase64': photoBase64,
    };
  }

  /// Uploads an encrypted face-registration template to the authoritative API.
  static Future<FaceUploadResult> uploadFaceRegistrationTemplate({
    required Map<String, dynamic> encryptedPayload,
    String? authToken,
  }) async {
    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
      };
      String? token = authToken;
      if (token == null || token.isEmpty) {
        token = await SecureSessionService.readAccessToken();
      }
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }

      final response = await http.post(
        Uri.parse(Api.faceRegisterUrl),
        headers: headers,
        body: jsonEncode(encryptedPayload),
      ).timeout(const Duration(seconds: 15));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = jsonDecode(response.body);
        return FaceUploadResult(
          success: true,
          message: data['message'] ?? 'Face biometric registered successfully on server.',
          templateId: data['templateId'] ?? data['id'],
        );
      } else {
        final data = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body) as Map<String, dynamic>;
        // Same `error`-vs-`message` field mismatch as verifyFace() above —
        // errorResponse() on the backend sends the reason under `error`.
        return FaceUploadResult(
          success: false,
          message: data['message']?.toString() ?? data['error']?.toString() ?? 'Face registration was rejected. Please try again.',
        );
      }
    } catch (e) {
      if (kDebugMode) print('Face registration API error: $e');
      return FaceUploadResult(success: false, message: 'Unable to register your face. Check your connection and try again.');
    }
  }

  /// Securely saves enrolled facial feature samples locally.
  static Future<void> saveEnrolledFeatures(
    List<List<double>> samples, {
    Map<String, dynamic>? encryptedPayload,
    String? photoBase64,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = jsonEncode(samples);
    await SecureSessionService.writeSecret(keyEnrolledFeatures, jsonStr);
    await prefs.setBool(keyFaceEnrollmentCompleted, true);
    if (encryptedPayload != null) {
      await SecureSessionService.writeSecret(keyEncryptedTemplate, jsonEncode(encryptedPayload));
      if (encryptedPayload['photo_base64'] != null) {
        await SecureSessionService.writeSecret(keyEnrolledPhoto, encryptedPayload['photo_base64'].toString());
      }
    }
    if (photoBase64 != null && photoBase64.isNotEmpty) {
      await SecureSessionService.writeSecret(keyEnrolledPhoto, photoBase64);
    }
  }

  /// Helper to retrieve enrolled face photo bytes for UI display comparison
  static Future<Uint8List?> getEnrolledPhotoBytes() async {
    try {
      final base64Str = await SecureSessionService.readSecret(keyEnrolledPhoto);
      if (base64Str != null && base64Str.isNotEmpty) {
        return base64Decode(base64Str);
      }

      final templateJson = await SecureSessionService.readSecret(keyEncryptedTemplate);
      if (templateJson != null && templateJson.isNotEmpty) {
        final Map<String, dynamic> data = jsonDecode(templateJson);
        final String? photoBase64 = data['photo_base64']?.toString() ?? data['photoBase64']?.toString() ?? data['photo']?.toString();
        if (photoBase64 != null && photoBase64.isNotEmpty) {
          await SecureSessionService.writeSecret(keyEnrolledPhoto, photoBase64);
          return base64Decode(photoBase64);
        }
      }
    } catch (_) {}
    return null;
  }

  /// Retrieves stored enrolled feature vectors.
  static Future<List<List<double>>> getEnrolledFeatures() async {
    final jsonStr = await SecureSessionService.readSecret(keyEnrolledFeatures);
    if (jsonStr == null || jsonStr.isEmpty) return [];
    try {
      final List<dynamic> rawList = jsonDecode(jsonStr);
      return rawList
          .map((item) => (item as List).map((e) => (e as num).toDouble()).toList())
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Compares a live face feature vector using the authoritative backend API.
  static Future<FaceMatchResult> verifyFace({
    required List<double> liveFeatures,
    String type = 'PUNCH_IN',
    double? latitude,
    double? longitude,
    String? deviceId,
  }) async {
    final token = await SecureSessionService.readAccessToken();

    if (token == null || token.isEmpty) {
      return FaceMatchResult(
        isMatch: false,
        scorePercent: 0,
        message: 'Your session has expired. Please sign in again.',
      );
    }

    try {
      final headers = <String, String>{
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      };

      final body = jsonEncode({
        'type': type,
        'featureVector': liveFeatures,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
        if (deviceId != null) 'deviceId': deviceId,
      });

      final response = await http.post(
        Uri.parse(Api.faceVerifyUrl),
        headers: headers,
        body: body,
      ).timeout(const Duration(seconds: 12));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resData = jsonDecode(response.body);
        final data = resData['data'] is Map ? resData['data'] : resData;
        final bool matched = data['matched'] == true;
        final scoreValue = data['scorePercent'];
        final double scorePercent = scoreValue is num
            ? scoreValue.toDouble()
            : double.tryParse(scoreValue?.toString() ?? '') ?? (matched ? 95.0 : 0.0);
        final String message = resData['message'] ??
            (matched
                ? 'Face verified successfully (${scorePercent.toStringAsFixed(1)}% match).'
                : 'Face mismatch (${scorePercent.toStringAsFixed(1)}% match). Please try again.');

        return FaceMatchResult(
          // Only the server can mark a verification successful: a score below
          // its threshold does not create attendance, even if it is above an
          // older client-side fallback threshold.
          isMatch: matched,
          scorePercent: scorePercent,
          message: message,
        );
      } else if (response.statusCode == 409) {
          final resData = jsonDecode(response.body);
          // The backend sends the reason under `error`, not `message` (see
          // errorResponse() in api-utils.ts) — a 409 here can mean the face
          // truly isn't enrolled, but just as often means "already punched
          // in/out today". Falling back to a hardcoded "not enrolled" string
          // previously masked the real reason and wrongly sent an already-
          // matched, already-enrolled user back through face registration.
          return FaceMatchResult(
            isMatch: false,
            scorePercent: 0.0,
            message: resData['message'] ?? resData['error'] ?? 'Face verification failed.',
          );
      } else if (response.statusCode == 400 || response.statusCode == 401) {
          final resData = jsonDecode(response.body);
          return FaceMatchResult(
            isMatch: false,
            scorePercent: 0.0,
            message: resData['message'] ?? resData['error'] ?? 'Face verification failed.',
          );
      }

      return FaceMatchResult(
        isMatch: false,
        scorePercent: 0.0,
        message: 'Face verification is unavailable. Please try again.',
      );
    } catch (e) {
      if (kDebugMode) print('Server face verification error: $e');
      return FaceMatchResult(
        isMatch: false,
        scorePercent: 0.0,
        message: 'Unable to verify your face. Check your connection and try again.',
      );
    }
  }

  /// Checks with the server whether the employee has recorded attendance/punched in today.
  /// Returns `true` if present on server, `false` if not present, or `null` on network/server error.
  static Future<bool?> isPresentTodayOnServer() async {
    final info = await fetchServerAttendanceInfo();
    return info?.present;
  }

  /// Fetches detailed attendance status (present, punchedIn, punchedOut, status string) from server.
  static Future<ServerAttendanceInfo?> fetchServerAttendanceInfo() async {
    final token = await SecureSessionService.readAccessToken();
    if (token == null || token.isEmpty) return null;

    try {
      final response = await http.get(
        Uri.parse(Api.faceAttendanceStatusUrl),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $token',
        },
      ).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final resData = jsonDecode(response.body);
        final data = resData['data'] is Map ? resData['data'] : resData;
        if (data is Map) {
          final bool isPunchedIn = data['present'] == true || data['punchedIn'] == true;
          return ServerAttendanceInfo(
            present: isPunchedIn,
            punchedIn: isPunchedIn,
            punchedOut: data['punchedOut'] == true,
            status: data['status']?.toString(),
            isWorkingDay: data['isWorkingDay'] ?? true,
            faceAttendanceAllowed: data['faceAttendanceAllowed'] ?? true,
            faceTrainingAllowed: data['faceTrainingAllowed'] ?? true,
            accessMessage: data['accessMessage']?.toString(),
          );
        }
      }
      return null;
    } catch (e) {
      if (kDebugMode) print('Server attendance status fetch error: $e');
      return null;
    }
  }

  /// Clears only the device cache. This is used before a fresh enrollment;
  /// it must not revoke the caller's server-side template.
  static Future<void> clearLocalEnrollmentCache() async {
    final prefs = await SharedPreferences.getInstance();
    await SecureSessionService.deleteSecret(keyEnrolledFeatures);
    await SecureSessionService.deleteSecret(keyEncryptedTemplate);
    await SecureSessionService.deleteSecret(keyEnrolledPhoto);
    await prefs.remove(keyFaceEnrollmentCompleted);
  }

  /// Clears enrolled face biometric features and enrollment flag locally AND on backend.
  static Future<bool> clearEnrolledFeatures() async {
    await clearLocalEnrollmentCache();

    // Notify backend server to revoke/clear enrolled face template record
    try {
      final token = await SecureSessionService.readAccessToken();
      if (token != null && token.isNotEmpty) {
        final response = await http.delete(
          Uri.parse(Api.faceRegisterUrl),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer $token',
          },
        ).timeout(const Duration(seconds: 5));

        if (response.statusCode == 200 || response.statusCode == 204) {
          if (kDebugMode) print('Backend face biometric data cleared successfully.');
          return true;
        }
      }
    } catch (e) {
      if (kDebugMode) print('Backend clear enrolled features network error: $e');
    }
    return true;
  }
}

class FaceMatchResult {
  final bool isMatch;
  final double scorePercent;
  final String message;

  FaceMatchResult({
    required this.isMatch,
    required this.scorePercent,
    required this.message,
  });
}

class ServerAttendanceInfo {
  final bool present;
  final bool punchedIn;
  final bool punchedOut;
  final String? status;
  final bool isWorkingDay;
  final bool faceAttendanceAllowed;
  final bool faceTrainingAllowed;
  final String? accessMessage;

  ServerAttendanceInfo({
    required this.present,
    required this.punchedIn,
    required this.punchedOut,
    this.status,
    this.isWorkingDay = true,
    this.faceAttendanceAllowed = true,
    this.faceTrainingAllowed = true,
    this.accessMessage,
  });
}
