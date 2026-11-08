import 'dart:async';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/widgets/stamped_photo_review_dialog.dart';

/// What gets printed on a house photo.
class PhotoStamp {
  const PhotoStamp({
    required this.capturedAt,
    required this.latitude,
    required this.longitude,
    this.address,
  });

  final DateTime capturedAt;
  final double latitude;
  final double longitude;

  /// Street and village, when the phone's geocoder could find them.
  final String? address;
}

class StampedPhoto {
  const StampedPhoto({required this.bytes, required this.filename});

  final Uint8List bytes;
  final String filename;
}

/// Captures a house photo with a location + date/time stamp burned into it,
/// like a "GPS camera" app — free, using only the phone's GPS and built-in
/// geocoder.
///
/// Flow: check location is available → open the camera (camera only, no
/// gallery, so the stamp always belongs to a photo taken right now) → wait up
/// to 15 s for a GPS fix, telling the user what's happening → look up the
/// street / village → show the stamped photo for rotation → return the JPEG.
class PhotoStampService {
  PhotoStampService._();

  /// Only the three house images are stamped.
  static const stampedDocumentTypes = {
    EnrollmentOptions.docHouseImage1,
    EnrollmentOptions.docHouseImage2,
    EnrollmentOptions.docHouseImage3,
  };

  static bool requiresStamp(String documentType) =>
      stampedDocumentTypes.contains(documentType);

  /// How long to wait for a GPS fix after the photo is taken.
  static const _fixWait = Duration(seconds: 15);

  /// A fix at least this accurate is used straight away; otherwise we keep
  /// waiting (up to [_fixWait]) for a better one and use the best we have.
  static const _goodAccuracyMeters = 50.0;

  static const _addressWait = Duration(seconds: 4);

  static final _timeFormat = DateFormat('dd MMM yyyy, hh:mm:ss a');

  /// The full capture flow. Returns null if the user cancels or no usable
  /// location could be obtained.
  static Future<StampedPhoto?> captureStampedPhoto() async {
    if (!await _ensureLocationReady()) return null;

    // Start listening for GPS before the camera opens, so a fix is often
    // ready by the time the photo is taken.
    final tracker = _FixTracker()..start();
    try {
      final picked = await ImagePicker().pickImage(
        source: ImageSource.camera,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 80,
      );
      if (picked == null) return null;
      final capturedAt = DateTime.now();
      final raw = await picked.readAsBytes();

      PhotoStamp? stamp;
      while (stamp == null) {
        stamp = await _acquireStamp(tracker, capturedAt);
        if (stamp != null) break;
        final retry = await _confirm(
          title: 'Could not get your location',
          message:
              'No GPS signal was found. Move to an open area, or near a '
              'window, and try again.',
          confirmLabel: 'Try Again',
          cancelLabel: 'Cancel',
        );
        if (retry != true) return null;
      }

      final reviewed = await showStampedPhotoReview(bytes: raw, stamp: stamp);
      if (reviewed == null) return null;
      return StampedPhoto(bytes: reviewed, filename: picked.name);
    } finally {
      await tracker.stop();
    }
  }

  // ── location permission ────────────────────────────────────────────────

  static Future<bool> _ensureLocationReady() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      final open = await _confirm(
        title: 'Turn on location',
        message:
            'Location (GPS) is off. Turn it on to take house photos with '
            'location, date and time.',
        confirmLabel: 'Open Settings',
        cancelLabel: 'Cancel',
      );
      if (open == true) await Geolocator.openLocationSettings();
      return false;
    }

    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      Get.snackbar(
        'Location needed',
        'Allow location access to take house photos.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    }
    if (permission == LocationPermission.deniedForever) {
      final open = await _confirm(
        title: 'Location permission needed',
        message:
            'Location access is blocked for this app. Allow it in Settings '
            'to take house photos with location.',
        confirmLabel: 'Open Settings',
        cancelLabel: 'Cancel',
      );
      if (open == true) await Geolocator.openAppSettings();
      return false;
    }
    return true;
  }

  // ── waiting for the fix ────────────────────────────────────────────────

  /// Shows a progress dialog while waiting (up to 15 s) for a GPS fix and
  /// then the address. Returns null when no fix arrives in time.
  static Future<PhotoStamp?> _acquireStamp(
    _FixTracker tracker,
    DateTime capturedAt,
  ) async {
    final message = ValueNotifier<String>('Getting your location…');
    Get.dialog<void>(
      _ProgressDialog(message: message),
      barrierDismissible: false,
    );
    try {
      final started = DateTime.now();
      while (true) {
        final fix = tracker.latest;
        final elapsed = DateTime.now().difference(started);
        if (fix != null && fix.accuracy <= _goodAccuracyMeters) break;
        if (elapsed >= _fixWait) break;

        final secondsLeft = (_fixWait - elapsed).inSeconds + 1;
        final String base;
        if (elapsed.inSeconds < 5) {
          base = 'Getting your location…';
        } else if (elapsed.inSeconds < 10) {
          base =
              'Still searching for GPS signal…\n'
              'Stay outdoors or near a window.';
        } else {
          base = 'Almost there…\nImproving location accuracy.';
        }
        message.value = '$base\n(${secondsLeft}s)';
        await Future<void>.delayed(const Duration(milliseconds: 300));
      }

      // Use the best fix we have, even if it is not very precise.
      final fix = tracker.latest;
      if (fix == null) return null;

      message.value = 'Finding village & street…';
      final address = await _lookupAddress(fix.latitude, fix.longitude);
      return PhotoStamp(
        capturedAt: capturedAt,
        latitude: fix.latitude,
        longitude: fix.longitude,
        address: address,
      );
    } finally {
      if (Get.isDialogOpen == true) Get.back<void>();
      message.dispose();
    }
  }

  /// Street + village from the phone's built-in geocoder (free, no key).
  /// Returns null when it isn't available — the stamp then just shows
  /// coordinates, date and time.
  static Future<String?> _lookupAddress(double lat, double lng) async {
    try {
      final marks = await Geocoding()
          .placemarkFromCoordinates(lat, lng)
          .timeout(_addressWait);
      if (marks.isEmpty) return null;
      final m = marks.first;

      String? clean(String? v) {
        final t = v?.trim();
        return t == null || t.isEmpty ? null : t;
      }

      // A "street" that is really a Plus Code (e.g. 7QH8+XX) isn't useful.
      String? street = clean(m.thoroughfare) ?? clean(m.street);
      if (street != null && street.contains('+')) street = null;
      final village = clean(m.subLocality) ?? clean(m.locality);

      final parts = <String>[];
      for (final p in [street, village]) {
        if (p == null) continue;
        final lower = p.toLowerCase();
        if (parts.any((e) => e.toLowerCase() == lower)) continue;
        parts.add(p);
      }
      return parts.isEmpty ? null : parts.join(', ');
    } catch (_) {
      return null;
    }
  }

  // ── drawing ────────────────────────────────────────────────────────────

  /// Draws [bytes] rotated clockwise by [quarterTurns] with the stamp along
  /// the bottom, and returns it as a JPEG. The stamp is drawn after the
  /// rotation, so its text is always upright.
  static Future<Uint8List> render(
    Uint8List bytes,
    PhotoStamp stamp, {
    int quarterTurns = 0,
  }) async {
    final codec = await ui.instantiateImageCodec(bytes);
    final frame = await codec.getNextFrame();
    final src = frame.image;

    final turns = quarterTurns % 4;
    final swap = turns.isOdd;
    final w = swap ? src.height : src.width;
    final h = swap ? src.width : src.height;
    final wd = w.toDouble();
    final hd = h.toDouble();

    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder, Rect.fromLTWH(0, 0, wd, hd));
    canvas.save();
    switch (turns) {
      case 1:
        canvas.translate(wd, 0);
        canvas.rotate(math.pi / 2);
      case 2:
        canvas.translate(wd, hd);
        canvas.rotate(math.pi);
      case 3:
        canvas.translate(0, hd);
        canvas.rotate(-math.pi / 2);
    }
    canvas.drawImage(src, Offset.zero, Paint()..filterQuality = FilterQuality.high);
    canvas.restore();
    _drawStamp(canvas, wd, hd, stamp);

    final picture = recorder.endRecording();
    final out = await picture.toImage(w, h);
    final data = await out.toByteData(format: ui.ImageByteFormat.rawRgba);
    src.dispose();
    out.dispose();
    picture.dispose();
    if (data == null) return bytes;

    final image = img.Image.fromBytes(
      width: w,
      height: h,
      bytes: data.buffer,
      numChannels: 4,
      order: img.ChannelOrder.rgba,
    );
    return Uint8List.fromList(img.encodeJpg(image, quality: 88));
  }

  static void _drawStamp(Canvas canvas, double w, double h, PhotoStamp stamp) {
    final fontSize = (math.min(w, h) * 0.034).clamp(16.0, 64.0);
    final pad = fontSize * 0.6;

    final lines = <String>[
      'Lat ${stamp.latitude.toStringAsFixed(6)}   '
          'Lng ${stamp.longitude.toStringAsFixed(6)}',
      _timeFormat.format(stamp.capturedAt),
      if (stamp.address != null && stamp.address!.isNotEmpty) stamp.address!,
    ];

    final painter = TextPainter(
      text: TextSpan(
        text: lines.join('\n'),
        style: TextStyle(
          color: Colors.white,
          fontSize: fontSize,
          height: 1.3,
          fontWeight: FontWeight.w600,
          shadows: const [
            Shadow(color: Colors.black87, blurRadius: 3, offset: Offset(1, 1)),
          ],
        ),
      ),
      textDirection: ui.TextDirection.ltr,
      maxLines: 4,
      ellipsis: '…',
    )..layout(maxWidth: w - pad * 2);

    final bandHeight = painter.height + pad * 2;
    canvas.drawRect(
      Rect.fromLTWH(0, h - bandHeight, w, bandHeight),
      Paint()..color = const Color(0x99000000),
    );
    painter.paint(canvas, Offset(pad, h - bandHeight + pad));
  }

  // ── small dialogs ──────────────────────────────────────────────────────

  static Future<bool?> _confirm({
    required String title,
    required String message,
    required String confirmLabel,
    required String cancelLabel,
  }) {
    return Get.dialog<bool>(
      AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          title,
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        content: Text(message, style: const TextStyle(fontSize: 13)),
        actions: [
          TextButton(
            onPressed: () => Get.back(result: false),
            child: Text(cancelLabel),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: const Color(0xFF00843D),
              foregroundColor: Colors.white,
            ),
            onPressed: () => Get.back(result: true),
            child: Text(confirmLabel),
          ),
        ],
      ),
      barrierDismissible: false,
    );
  }
}

/// Listens to the GPS and keeps the latest position.
class _FixTracker {
  StreamSubscription<Position>? _sub;
  Position? latest;

  void start() {
    _sub =
        Geolocator.getPositionStream(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.best,
            distanceFilter: 0,
          ),
        ).listen((p) => latest = p, onError: (_) {});
  }

  Future<void> stop() async => _sub?.cancel();
}

class _ProgressDialog extends StatelessWidget {
  const _ProgressDialog({required this.message});

  final ValueNotifier<String> message;

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      child: Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: 28,
                height: 28,
                child: CircularProgressIndicator(
                  strokeWidth: 3,
                  color: Color(0xFF00843D),
                ),
              ),
              const SizedBox(width: 16),
              Flexible(
                child: ValueListenableBuilder<String>(
                  valueListenable: message,
                  builder: (_, text, __) => Text(
                    text,
                    style: const TextStyle(fontSize: 13.5, height: 1.35),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
