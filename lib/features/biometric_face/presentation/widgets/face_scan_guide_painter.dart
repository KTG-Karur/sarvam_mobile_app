import 'dart:math' as math;
import 'package:flutter/material.dart';

/// Dotted oval face guide + landmark dots (eyes, nose, mouth)
/// matching KTG HR app face scan guide overlay.
class FaceScanGuidePainter extends CustomPainter {
  final Color color;

  FaceScanGuidePainter({required this.color});

  static const int _ovalDotCount = 40;
  static const double _ovalDotRadius = 2.4;

  // Normalized landmark positions inside oval frame
  static const List<Offset> _landmarks = [
    Offset(0.36, 0.42), // left eye
    Offset(0.64, 0.42), // right eye
    Offset(0.50, 0.58), // nose tip
    Offset(0.40, 0.72), // mouth left
    Offset(0.60, 0.72), // mouth right
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Rect.fromLTWH(
      size.width * 0.06,
      size.height * 0.04,
      size.width * 0.88,
      size.height * 0.90,
    );
    final center = rect.center;
    final rx = rect.width / 2;
    final ry = rect.height / 2;

    final dotPaint = Paint()..color = color.withValues(alpha: 0.75);
    for (int i = 0; i < _ovalDotCount; i++) {
      final angle = 2 * math.pi * i / _ovalDotCount;
      final point = Offset(
        center.dx + rx * math.cos(angle),
        center.dy + ry * math.sin(angle),
      );
      canvas.drawCircle(point, _ovalDotRadius, dotPaint);
    }

    final landmarkPaint = Paint()
      ..color = const Color(0xFF2ECC71).withValues(alpha: 0.7);
    for (final p in _landmarks) {
      canvas.drawCircle(
        Offset(rect.left + p.dx * rect.width, rect.top + p.dy * rect.height),
        2.8,
        landmarkPaint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant FaceScanGuidePainter oldDelegate) =>
      oldDelegate.color != color;
}
