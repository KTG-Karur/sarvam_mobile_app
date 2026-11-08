import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/photo_stamp_service.dart';

/// Review dialog for a stamped house photo. Shows the photo exactly as it will
/// be uploaded — with the location / date / time stamp on it — and lets the
/// user rotate it. Each rotation re-draws the stamp so it stays upright.
/// Returns the final JPEG, or null if the user cancels.
Future<Uint8List?> showStampedPhotoReview({
  required Uint8List bytes,
  required PhotoStamp stamp,
}) {
  return Get.dialog<Uint8List?>(
    _StampedPhotoReviewDialog(bytes: bytes, stamp: stamp),
    barrierDismissible: false,
  );
}

class _StampedPhotoReviewDialog extends StatefulWidget {
  const _StampedPhotoReviewDialog({required this.bytes, required this.stamp});

  final Uint8List bytes;
  final PhotoStamp stamp;

  @override
  State<_StampedPhotoReviewDialog> createState() =>
      _StampedPhotoReviewDialogState();
}

class _StampedPhotoReviewDialogState extends State<_StampedPhotoReviewDialog> {
  static const _green = Color(0xFF00843D);

  int _turns = 0;
  bool _busy = true;
  Uint8List? _preview;

  @override
  void initState() {
    super.initState();
    _render();
  }

  Future<void> _render() async {
    setState(() => _busy = true);
    try {
      final out = await PhotoStampService.render(
        widget.bytes,
        widget.stamp,
        quarterTurns: _turns,
      );
      if (mounted) setState(() => _preview = out);
    } catch (_) {
      // Fall back to the unstamped photo only for display; upload is blocked
      // below because _preview stays null.
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _rotate() {
    if (_busy) return;
    _turns = (_turns + 1) % 4;
    _render();
  }

  @override
  Widget build(BuildContext context) {
    final ready = !_busy && _preview != null;
    return Dialog(
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(20, 16, 20, 8),
            child: Row(
              children: [
                Icon(Icons.rotate_right_rounded, color: _green),
                SizedBox(width: 10),
                Text(
                  'Review & Rotate',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF073E23),
                  ),
                ),
              ],
            ),
          ),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 20),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                'Location, date & time are stamped on this photo.',
                style: TextStyle(fontSize: 11.5, color: Color(0xFF64748B)),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Container(
            height: 320,
            width: double.infinity,
            color: const Color(0xFFF8FBF9),
            child: Stack(
              alignment: Alignment.center,
              children: [
                if (_preview != null)
                  Opacity(
                    opacity: _busy ? 0.4 : 1,
                    child: Image.memory(_preview!, fit: BoxFit.contain),
                  ),
                if (_busy) const CircularProgressIndicator(color: _green),
                if (!_busy && _preview == null)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'Could not prepare the photo. Please cancel and retake.',
                      textAlign: TextAlign.center,
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                IconButton.filledTonal(
                  onPressed: _busy ? null : _rotate,
                  icon: const Icon(Icons.rotate_right_rounded, color: _green),
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFFF0FAF4),
                    foregroundColor: _green,
                  ),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => Get.back<Uint8List?>(result: null),
                  child: const Text(
                    'Cancel',
                    style: TextStyle(color: Color(0xFF64748B)),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: ready
                      ? () => Get.back<Uint8List?>(result: _preview)
                      : null,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: const Text('Upload'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
