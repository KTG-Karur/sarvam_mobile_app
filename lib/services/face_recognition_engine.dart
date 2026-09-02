import 'dart:io';
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/services.dart' show rootBundle, AssetManifest;
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

    final available = await _bundledAssets();
    for (final asset in _assetCandidates) {
      if (!available.contains(asset)) continue;
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

  /// Asset keys bundled into the app, read from the manifest so a missing
  /// model does NOT raise a caught exception on every launch (which trips the
  /// debugger's "all exceptions" mode) before someone adds the file.
  Future<Set<String>> _bundledAssets() async {
    try {
      final manifest = await AssetManifest.loadFromAssetBundle(rootBundle);
      return manifest.listAssets().toSet();
    } catch (e) {
      if (kDebugMode) print('[FaceRecognitionEngine] asset manifest read failed: $e');
      return <String>{};
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

    final aligned = _alignFace(decoded, face);
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

  /// ArcFace canonical 5-point template for a 112x112 aligned face:
  /// left eye, right eye, nose tip, left mouth corner, right mouth corner.
  static const List<List<double>> _arcFaceTemplate = <List<double>>[
    <double>[38.2946, 51.6963],
    <double>[73.5318, 51.5014],
    <double>[56.0252, 71.7366],
    <double>[41.5493, 92.3655],
    <double>[70.7299, 92.2041],
  ];

  /// Warps the face onto the canonical [_inputSize] template using a
  /// similarity transform fitted to ML Kit landmarks (proper alignment gives
  /// MobileFaceNet a much steadier embedding than a plain crop). Falls back
  /// to an eyes-only fit, then to a margin crop.
  img.Image? _alignFace(img.Image src, Face face) {
    final lm = face.landmarks;
    final le = lm[FaceLandmarkType.leftEye]?.position;
    final re = lm[FaceLandmarkType.rightEye]?.position;
    final nose = lm[FaceLandmarkType.noseBase]?.position;
    final lmo = lm[FaceLandmarkType.leftMouth]?.position;
    final rmo = lm[FaceLandmarkType.rightMouth]?.position;

    if (le != null && re != null && nose != null && lmo != null && rmo != null) {
      final m = _fitSimilarity(
        <List<double>>[
          <double>[le.x.toDouble(), le.y.toDouble()],
          <double>[re.x.toDouble(), re.y.toDouble()],
          <double>[nose.x.toDouble(), nose.y.toDouble()],
          <double>[lmo.x.toDouble(), lmo.y.toDouble()],
          <double>[rmo.x.toDouble(), rmo.y.toDouble()],
        ],
        _arcFaceTemplate,
      );
      if (m != null) return _warpInverse(src, m);
    }

    if (le != null && re != null) {
      final m = _fitSimilarity(
        <List<double>>[
          <double>[le.x.toDouble(), le.y.toDouble()],
          <double>[re.x.toDouble(), re.y.toDouble()],
        ],
        <List<double>>[_arcFaceTemplate[0], _arcFaceTemplate[1]],
      );
      if (m != null) return _warpInverse(src, m);
    }

    return _marginCrop(src, face);
  }

  /// Least-squares similarity transform (scale + rotation + translation)
  /// mapping [srcPts] -> [dstPts]. Returns `[a, b, c, d]` where
  /// `X = a*x - b*y + c`, `Y = b*x + a*y + d`. Null if degenerate.
  List<double>? _fitSimilarity(
      List<List<double>> srcPts, List<List<double>> dstPts) {
    final n = srcPts.length;
    if (n < 2 || dstPts.length != n) return null;

    // Normal equations for the 4 unknowns [a, b, c, d].
    final ata = List<List<double>>.generate(4, (_) => List<double>.filled(4, 0));
    final atb = List<double>.filled(4, 0);
    for (int i = 0; i < n; i++) {
      final x = srcPts[i][0], y = srcPts[i][1];
      final xx = dstPts[i][0], yy = dstPts[i][1];
      final rows = <List<double>>[
        <double>[x, -y, 1, 0], // -> X
        <double>[y, x, 0, 1], // -> Y
      ];
      final targets = <double>[xx, yy];
      for (int r = 0; r < 2; r++) {
        for (int p = 0; p < 4; p++) {
          atb[p] += rows[r][p] * targets[r];
          for (int q = 0; q < 4; q++) {
            ata[p][q] += rows[r][p] * rows[r][q];
          }
        }
      }
    }
    final sol = _solve4(ata, atb);
    if (sol == null) return null;
    if ((sol[0] * sol[0] + sol[1] * sol[1]) < 1e-9) return null;
    return sol;
  }

  /// Gaussian elimination with partial pivoting for a 4x4 system.
  List<double>? _solve4(List<List<double>> a, List<double> b) {
    final m = List<List<double>>.generate(4, (i) => <double>[...a[i], b[i]]);
    for (int col = 0; col < 4; col++) {
      int piv = col;
      for (int r = col + 1; r < 4; r++) {
        if (m[r][col].abs() > m[piv][col].abs()) piv = r;
      }
      if (m[piv][col].abs() < 1e-12) return null;
      final tmp = m[col];
      m[col] = m[piv];
      m[piv] = tmp;
      for (int r = 0; r < 4; r++) {
        if (r == col) continue;
        final f = m[r][col] / m[col][col];
        for (int k = col; k <= 4; k++) {
          m[r][k] -= f * m[col][k];
        }
      }
    }
    return <double>[
      m[0][4] / m[0][0],
      m[1][4] / m[1][1],
      m[2][4] / m[2][2],
      m[3][4] / m[3][3],
    ];
  }

  /// Inverse-warps [src] into an [_inputSize] square using similarity
  /// coefficients `[a, b, c, d]`, sampling bilinearly with edge clamping.
  img.Image _warpInverse(img.Image src, List<double> m) {
    final a = m[0], b = m[1], c = m[2], d = m[3];
    final det = a * a + b * b;
    final out = img.Image(width: _inputSize, height: _inputSize, numChannels: 3);
    for (int oy = 0; oy < _inputSize; oy++) {
      for (int ox = 0; ox < _inputSize; ox++) {
        final xt = ox - c;
        final yt = oy - d;
        final sx = (a * xt + b * yt) / det;
        final sy = (-b * xt + a * yt) / det;
        final px = _sampleBilinear(src, sx, sy);
        out.setPixelRgb(ox, oy, px[0], px[1], px[2]);
      }
    }
    return out;
  }

  List<int> _sampleBilinear(img.Image src, double x, double y) {
    final x0 = x.floor().clamp(0, src.width - 1);
    final y0 = y.floor().clamp(0, src.height - 1);
    final x1 = (x0 + 1).clamp(0, src.width - 1);
    final y1 = (y0 + 1).clamp(0, src.height - 1);
    final fx = (x - x0).clamp(0.0, 1.0);
    final fy = (y - y0).clamp(0.0, 1.0);
    final p00 = src.getPixel(x0, y0);
    final p10 = src.getPixel(x1, y0);
    final p01 = src.getPixel(x0, y1);
    final p11 = src.getPixel(x1, y1);
    double lerp(num a, num b, num c, num dd) =>
        (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + dd * fx) * fy;
    return <int>[
      lerp(p00.r, p10.r, p01.r, p11.r).round().clamp(0, 255),
      lerp(p00.g, p10.g, p01.g, p11.g).round().clamp(0, 255),
      lerp(p00.b, p10.b, p01.b, p11.b).round().clamp(0, 255),
    ];
  }

  /// Fallback when landmarks are missing: square crop around the face box
  /// with margin, resized to the model input.
  img.Image? _marginCrop(img.Image src, Face face) {
    final box = face.boundingBox;
    final marginX = box.width * 0.30;
    final marginY = box.height * 0.30;
    final left = (box.left - marginX).round().clamp(0, src.width - 1);
    final top = (box.top - marginY).round().clamp(0, src.height - 1);
    final right = (box.right + marginX).round().clamp(0, src.width - 1);
    final bottom = (box.bottom + marginY).round().clamp(0, src.height - 1);
    final cropW = right - left;
    final cropH = bottom - top;
    if (cropW < 20 || cropH < 20) return null;
    final side = max(cropW, cropH);
    final cx = left + cropW / 2.0;
    final cy = top + cropH / 2.0;
    final l = (cx - side / 2).round().clamp(0, src.width - 1);
    final t = (cy - side / 2).round().clamp(0, src.height - 1);
    final sq = min(side, min(src.width - l, src.height - t));
    if (sq < 20) return null;
    final patch = img.copyCrop(src, x: l, y: t, width: sq, height: sq);
    return img.copyResize(patch,
        width: _inputSize,
        height: _inputSize,
        interpolation: img.Interpolation.linear);
  }

  List<double> _runModel(img.Image face112) {
    final input = List.generate(
      1,
      (_) => List.generate(
        _inputSize,
        (y) => List.generate(_inputSize, (x) {
          final p = face112.getPixel(x, y);
          // MobileFaceNet preprocessing: (pixel - 128) / 128  ->  [-1, 1).
          return <double>[
            (p.r - 128.0) / 128.0,
            (p.g - 128.0) / 128.0,
            (p.b - 128.0) / 128.0,
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
