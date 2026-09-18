import 'package:flutter/material.dart';

/// Stylized face-landmark wireframe (dots + connecting lines over face silhouette)
/// drawn over the camera preview during face training & verification —
/// creates an AI face-mesh look matching KTG HR app.
class FaceMeshOverlayPainter extends CustomPainter {
  final double progress;
  final bool faceDetected;

  FaceMeshOverlayPainter({
    required this.progress,
    required this.faceDetected,
  });

  // Normalized (0-1) landmark positions within the face bounding box —
  // eyebrow/eye/nose/cheek/mouth/jaw coordinates.
  static const List<Offset> _points = [
    Offset(0.50, 0.04), // 0 forehead
    Offset(0.16, 0.20), // 1 left temple
    Offset(0.84, 0.20), // 2 right temple
    Offset(0.24, 0.27), // 3 left eyebrow outer
    Offset(0.38, 0.24), // 4 left eyebrow inner
    Offset(0.62, 0.24), // 5 right eyebrow inner
    Offset(0.76, 0.27), // 6 right eyebrow outer
    Offset(0.22, 0.37), // 7 left eye outer
    Offset(0.30, 0.36), // 8 left eye top
    Offset(0.38, 0.37), // 9 left eye inner
    Offset(0.62, 0.37), // 10 right eye inner
    Offset(0.70, 0.36), // 11 right eye top
    Offset(0.78, 0.37), // 12 right eye outer
    Offset(0.50, 0.33), // 13 nose bridge
    Offset(0.50, 0.50), // 14 nose tip
    Offset(0.44, 0.53), // 15 left nostril
    Offset(0.56, 0.53), // 16 right nostril
    Offset(0.14, 0.50), // 17 left cheek
    Offset(0.86, 0.50), // 18 right cheek
    Offset(0.38, 0.66), // 19 mouth top-left corner
    Offset(0.50, 0.63), // 20 mouth top center
    Offset(0.62, 0.66), // 21 mouth top-right corner
    Offset(0.42, 0.73), // 22 mouth bottom-left
    Offset(0.50, 0.75), // 23 mouth bottom center
    Offset(0.58, 0.73), // 24 mouth bottom-right
    Offset(0.20, 0.78), // 25 jaw left
    Offset(0.80, 0.78), // 26 jaw right
    Offset(0.50, 0.94), // 27 chin
  ];

  static const List<List<int>> _edges = [
    [0, 1], [0, 2],
    [1, 3], [2, 6],
    [3, 4], [4, 13], [13, 5], [5, 6],
    [1, 17], [2, 18],
    [3, 7], [4, 9], [5, 10], [6, 12],
    [7, 8], [8, 9], [10, 11], [11, 12],
    [9, 13], [10, 13],
    [13, 14], [14, 15], [14, 16], [15, 16],
    [17, 15], [18, 16],
    [17, 19], [18, 21],
    [19, 20], [20, 21],
    [22, 23], [23, 24],
    [19, 22], [21, 24],
    [20, 23],
    [17, 25], [18, 26],
    [22, 25], [24, 26],
    [25, 27], [26, 27],
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final faceWidth = size.width * 0.6;
    final faceHeight = size.height * 0.82;
    final origin = Offset(
      (size.width - faceWidth) / 2,
      (size.height - faceHeight) / 2 - size.height * 0.02,
    );

    Offset map(Offset p) => origin + Offset(p.dx * faceWidth, p.dy * faceHeight);

    final baseColor = faceDetected
        ? const Color(0xFF2DD4BF) // Emerald/Teal when face is aligned
        : const Color(0xFF60A5FA); // Sky Blue searching
    final t = (progress.clamp(0, 100) / 100).toDouble();

    final linePaint = Paint()
      ..strokeWidth = 1.2
      ..style = PaintingStyle.stroke
      ..color = baseColor.withValues(alpha: 0.25 + 0.35 * t);

    for (final edge in _edges) {
      canvas.drawLine(map(_points[edge[0]]), map(_points[edge[1]]), linePaint);
    }

    final dotPaint = Paint()..color = baseColor.withValues(alpha: 0.55 + 0.45 * t);
    for (final p in _points) {
      canvas.drawCircle(map(p), 2.8, dotPaint);
    }

    // Outer framing ring
    final ringPaint = Paint()
      ..strokeWidth = 2.0
      ..style = PaintingStyle.stroke
      ..color = baseColor.withValues(alpha: 0.15 + 0.25 * t);
    canvas.drawCircle(size.center(Offset.zero), size.width / 2 - 1, ringPaint);
  }

  @override
  bool shouldRepaint(covariant FaceMeshOverlayPainter oldDelegate) =>
      oldDelegate.progress != progress || oldDelegate.faceDetected != faceDetected;
}
