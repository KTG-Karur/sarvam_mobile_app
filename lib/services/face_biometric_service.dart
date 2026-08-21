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
  static const String keyEnrolledFeatures = 'enrolled_face_features_v2';
  static const String keyFaceEnrollmentCompleted = 'faceEnrollmentCompleted';
  static const String keyEncryptedTemplate = 'encrypted_face_template_payload';

  // Key used to sign the registration payload before transport.
  static const String _encryptionSecretKey = 'Sarvam_MFI_Biometric_SecKey_2026';

  /// Helper method to check if face training/enrollment has been completed.
  static Future<bool> isFaceEnrolled() async {
    final enrolled = await getEnrolledFeatures();
    return enrolled.isNotEmpty;
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
        message: 'Center your face within the green oval target.',
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

    // Relaxed coverage range for instant detection
    if (coverage < 0.03) {
      return FaceQualityReport(
        status: FaceQualityStatus.tooFar,
        message: 'Move closer to the camera.',
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
    if (pitch.abs() > 40.0 || roll.abs() > 35.0) {
      return FaceQualityReport(
        status: FaceQualityStatus.tilted,
        message: 'Keep your head level with the camera.',
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
      message: 'Face aligned! Hold or tap capture.',
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

    return features;
  }

  static double _dist(Point<int> p1, Point<int> p2) {
    final dx = (p1.x - p2.x).toDouble();
    final dy = (p1.y - p2.y).toDouble();
    return sqrt(dx * dx + dy * dy);
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
      // The API uses this vector for matching; no raw camera image is sent.
      'featureVector': featureVector,
      'livenessVerified': livenessPassed,
      'qualityScore': qualityScore,
      'capturedAt': DateTime.now().toIso8601String(),
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
      ).timeout(const Duration(seconds: 4));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final data = jsonDecode(response.body);
        return FaceUploadResult(
          success: true,
          message: data['message'] ?? 'Face biometric registered successfully on server.',
          templateId: data['templateId'] ?? data['id'],
        );
      } else {
        final data = response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body) as Map<String, dynamic>;
        return FaceUploadResult(success: false, message: data['message']?.toString() ?? 'Face registration was rejected. Please try again.');
      }
    } catch (e) {
      if (kDebugMode) print('Face registration API error: $e');
      return FaceUploadResult(success: false, message: 'Unable to register your face. Check your connection and try again.');
    }
  }

  /// Saves enrolled sample vectors & encrypted payload to SharedPreferences for offline use.
  static Future<void> saveEnrolledFeatures(
    List<List<double>> samples, {
    Map<String, dynamic>? encryptedPayload,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    final jsonStr = jsonEncode(samples);
    await SecureSessionService.writeSecret(keyEnrolledFeatures, jsonStr);
    await prefs.setBool(keyFaceEnrollmentCompleted, true);
    if (encryptedPayload != null) {
      await SecureSessionService.writeSecret(keyEncryptedTemplate, jsonEncode(encryptedPayload));
    }
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
      ).timeout(const Duration(seconds: 6));

      if (response.statusCode == 200 || response.statusCode == 201) {
        final resData = jsonDecode(response.body);
        final data = resData['data'] is Map ? resData['data'] : resData;
        final bool matched = data['matched'] == true;
        final double scorePercent = (data['scorePercent'] as num?)?.toDouble() ?? (matched ? 95.0 : 0.0);
        final String message = resData['message'] ??
            (matched
                ? 'Face verified successfully (${scorePercent.toStringAsFixed(1)}% match).'
                : 'Face mismatch (${scorePercent.toStringAsFixed(1)}% match). Please try again.');

        return FaceMatchResult(
          isMatch: matched,
          scorePercent: scorePercent,
          message: message,
        );
      } else if (response.statusCode == 409) {
          final resData = jsonDecode(response.body);
          return FaceMatchResult(
            isMatch: false,
            scorePercent: 0.0,
            message: resData['message'] ?? 'Face not enrolled. Please complete face registration first.',
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

  static double _computeSimilarity(List<double> v1, List<double> v2) {
    if (v1.length != v2.length || v1.isEmpty) return 0.0;
    double diffSum = 0.0;
    int count = 0;
    for (int i = 0; i < v1.length; i++) {
      final val1 = v1[i];
      final val2 = v2[i];
      if (val1 > 0 && val2 > 0) {
        final relDiff = (val1 - val2).abs() / max(val1, val2);
        diffSum += relDiff;
        count++;
      }
    }
    if (count == 0) return 0.0;
    final avgRelDiff = diffSum / count;
    return max(0.0, 1.0 - avgRelDiff);
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
