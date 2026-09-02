import 'dart:io';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:image/image.dart' as img;
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:path_provider/path_provider.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

/// Real on-device face-recognition engine backed by a MobileFaceNet TFLite model.
///
/// Drop the model at `assets/models/mobilefacenet.tflite`:
///   * input  : `1 x S x S x 3` float32, RGB, normalised `(pixel - 127.5) / 128`
///              (S is read from the model, normally 112)
///   * output : `1 x N` embedding, N is typically 128 / 192 / 512
///
/// Until that asset exists [isReady] stays `false` and every caller in the
/// auth flow must treat verification as UNAVAILABLE (fail closed) instead of
/// letting anyone through. The previous build shipped no model and silently
/// fell back to a face-geometry heuristic, which is why two different people
/// scored a ~95% "match".
class FaceRecognitionEngine {
  FaceRecognitionEngine._();
  static final FaceRecognitionEngine instance = FaceRecognitionEngine._();

  /// Model asset lookup order. First one that loads wins.
  static const List<String> _assetCandidates = <String>[
    'assets/models/mobilefacenet.tflite',
    'assets/models/mobile_face_net.tflite',
    'assets/mobile_face_net.tflite',
  ];

  /// Bump when the model / preprocessing changes so stale templates are rejected.
  static const String modelVersion = 'mobilefacenet-tflite-v1';

  Interpreter? _interpreter;
  int _inputSize = 112;
  int _embeddingSize = 192;
  bool _ready = false;
  bool _initStarted = false;

  final FaceDetector _stillDetector = FaceDetector(
    options: FaceDetectorOptions(
      performanceMode: FaceDetectorMode.accurate,
      enableLandmarks: true,
      enableContours: false,
      enableClassification: false,
    ),
  );

  bool get isReady => _ready;
  int get embeddingSize => _embeddingSize;

  /// Loads the TFLite model. Safe to call multiple times; only the first call
  /// does work. Never throws — on failure [isReady] simply stays false.
  Future<void> initialize() async {
    if (_ready || _initStarted) return;
    _initStarted = true;
    for (final asset in _assetCandidates) {
      if (!await _assetExists(asset)) continue;
      try {
        final interp = await Interpreter.fromAsset(
          asset,
          options: InterpreterOptions()..threads = 2,
        );
        final inShape = interp.getInputTensor(0).shape; // [1, S, S, 3]
        final outShape = interp.getOutputTensor(0).shape; // [1, N]
        _inputSize = inShape.length >= 3 ? inShape[1] : 112;
        _embeddingSize = outShape.isNotEmpty ? outShape.last : 192;
        _interpreter = interp;
        _ready = true;
        if (kDebugMode) {
          print('[FaceRecognitionEngine] loaded "$asset" '
              'input=$inShape output=$outShape');
        }
        return;
      } catch (e) {
        if (kDebugMode) print('[FaceRecognitionEngine] failed to load $asset: $e');
      }
    }
    _ready = false;
    if (kDebugMode) {
      print('[FaceRecognitionEngine] NO model asset found — face auth disabled '
          '(fail closed). Add assets/models/mobilefacenet.tflite');
    }
  }

  Future<bool> _assetExists(String key) async {
    try {
      await rootBundle.load(key);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Detects the largest face in a captured still ([jpegBytes]), crops and
  /// eye-aligns it, and returns an L2-normalised embedding.
  ///
  /// Returns `null` when the model is unavailable or no usable face is found —
  /// callers MUST treat null as "cannot verify", never as a pass.
  Future<List<double>?> embedFromJpeg(Uint8List jpegBytes) async {
    if (!_ready || _interpreter == null) return null;

    img.Image? decoded;
    try {
      decoded = img.decodeImage(jpegBytes);
    } catch (_) {
      decoded = null;
    }
    if (decoded == null) return null;

    // Re-run detection on the still itself so landmark coordinates match these
    // exact pixels (stream-frame landmarks do not map onto takePicture output).
    final face = await _detectLargestFace(jpegBytes);
    if (face == null) return null;

    final aligned = _cropAndAlign(decoded, face);
    if (aligned == null) return null;

    return _runModel(aligned);
  }

  Future<Face?> _detectLargestFace(Uint8List jpegBytes) async {
    File? tmp;
    try {
      final dir = await getTemporaryDirectory();
      tmp = File('${dir.path}/fr_${DateTime.now().microsecondsSinceEpoch}.jpg');
      await tmp.writeAsBytes(jpegBytes, flush: true);
      final faces =
          await _stillDetector.processImage(InputImage.fromFilePath(tmp.path));
      if (faces.isEmpty) return null;
      faces.sort((a, b) => (b.boundingBox.width * b.boundingBox.height)
          .compareTo(a.boundingBox.width * a.boundingBox.height));
      return faces.first;
    } catch (e) {
      if (kDebugMode) print('[FaceRecognitionEngine] still detection error: $e');
      return null;
    } finally {
      try {
        await tmp?.delete();
      } catch (_) {}
    }
  }

  /// Expands the face box by a margin, rotates so the eyes are level, and
  /// returns a square [_inputSize] RGB image ready for the model.
  img.Image? _cropAndAlign(img.Image src, Face face) {
    final box = face.boundingBox;

    // Margin around the detected box (forehead + chin room).
    final marginX = box.width * 0.30;
    final marginY = box.height * 0.30;
    int left = (box.left - marginX).round().clamp(0, src.width - 1);
    int top = (box.top - marginY).round().clamp(0, src.height - 1);
    int right = (box.right + marginX).round().clamp(0, src.width - 1);
    int bottom = (box.bottom + marginY).round().clamp(0, src.height - 1);
    int cropW = right - left;
    int cropH = bottom - top;
    if (cropW < 20 || cropH < 20) return null;

    // Make the crop square around its centre.
    final side = max(cropW, cropH);
    final cx = left + cropW / 2.0;
    final cy = top + cropH / 2.0;
    left = (cx - side / 2).round().clamp(0, src.width - 1);
    top = (cy - side / 2).round().clamp(0, src.height - 1);
    final sqSide = min(side, min(src.width - left, src.height - top));
    if (sqSide < 20) return null;

    img.Image patch =
        img.copyCrop(src, x: left, y: top, width: sqSide, height: sqSide);

    // Eye-level alignment (landmarks are in src coordinates).
    final le = face.landmarks[FaceLandmarkType.leftEye]?.position;
    final re = face.landmarks[FaceLandmarkType.rightEye]?.position;
    if (le != null && re != null) {
      final dx = (re.x - le.x).toDouble();
      final dy = (re.y - le.y).toDouble();
      final angleDeg = atan2(dy, dx) * 180.0 / pi;
      if (angleDeg.abs() > 3.0 && angleDeg.abs() < 35.0) {
        patch = img.copyRotate(patch, angle: -angleDeg);
        // Re-centre-crop to drop the rotation border.
        final keep = (patch.width * 0.86).round();
        final off = ((patch.width - keep) / 2).round();
        patch = img.copyCrop(patch, x: off, y: off, width: keep, height: keep);
      }
    }

    return img.copyResize(patch,
        width: _inputSize, height: _inputSize, interpolation: img.Interpolation.linear);
  }

  List<double> _runModel(img.Image face112) {
    final input = List.generate(
      1,
      (_) => List.generate(
        _inputSize,
        (y) => List.generate(_inputSize, (x) {
          final p = face112.getPixel(x, y);
          return <double>[
            (p.r - 127.5) / 128.0,
            (p.g - 127.5) / 128.0,
            (p.b - 127.5) / 128.0,
          ];
        }),
      ),
    );

    final output =
        List.generate(1, (_) => List<double>.filled(_embeddingSize, 0.0));
    _interpreter!.run(input, output);
    return l2Normalize(output[0]);
  }

  static List<double> l2Normalize(List<double> v) {
    double sum = 0.0;
    for (final x in v) {
      sum += x * x;
    }
    final norm = sqrt(sum);
    if (norm < 1e-10) return v;
    return v.map((x) => x / norm).toList();
  }

  /// Cosine similarity of two L2-normalised embeddings, clamped to [-1, 1].
  static double cosine(List<double> a, List<double> b) {
    if (a.isEmpty || a.length != b.length) return -1.0;
    double dot = 0.0;
    for (int i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot.clamp(-1.0, 1.0);
  }

  Future<void> dispose() async {
    try {
      _interpreter?.close();
    } catch (_) {}
    try {
      await _stillDetector.close();
    } catch (_) {}
    _interpreter = null;
    _ready = false;
    _initStarted = false;
  }
}
