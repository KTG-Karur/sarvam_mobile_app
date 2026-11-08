import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:sarvam/services/photo_stamp_service.dart';

void main() {
  final stamp = PhotoStamp(
    capturedAt: DateTime(2026, 11, 10, 16, 35, 12),
    latitude: 12.345678,
    longitude: 78.123456,
    address: 'Main Street, Sample Village',
  );

  // An 800x400 landscape test photo: left half red, right half blue (big enough
  // that the stamp band covers only its bottom part, as on a real photo).
  Uint8List sourcePhoto() {
    final image = img.Image(width: 800, height: 400);
    for (var y = 0; y < 400; y++) {
      for (var x = 0; x < 800; x++) {
        image.setPixelRgb(x, y, x < 400 ? 255 : 0, 0, x < 400 ? 0 : 255);
      }
    }
    return Uint8List.fromList(img.encodeJpg(image, quality: 95));
  }

  testWidgets('render keeps the size and draws a stamp band', (tester) async {
    await tester.runAsync(() async {
      final out = await PhotoStampService.render(sourcePhoto(), stamp);
      final decoded = img.decodeJpg(out)!;
      expect(decoded.width, 800);
      expect(decoded.height, 400);

      // The bottom band is dark, the top of the photo is untouched colour.
      final top = decoded.getPixel(200, 20);
      final bottom = decoded.getPixel(5, 395);
      expect(top.r.toInt(), greaterThan(180)); // still red
      expect(bottom.r.toInt() + bottom.b.toInt(), lessThan(200)); // darkened
    });
  });

  testWidgets('a quarter turn swaps width and height', (tester) async {
    await tester.runAsync(() async {
      final out = await PhotoStampService.render(
        sourcePhoto(),
        stamp,
        quarterTurns: 1,
      );
      final decoded = img.decodeJpg(out)!;
      expect(decoded.width, 400);
      expect(decoded.height, 800);

      // Rotated clockwise: the red (left) half ends up on top.
      final top = decoded.getPixel(200, 20);
      expect(top.r.toInt(), greaterThan(180));
      expect(top.b.toInt(), lessThan(80));
    });
  });

  testWidgets('three quarter turns put the red half at the bottom-left side',
      (tester) async {
    await tester.runAsync(() async {
      final out = await PhotoStampService.render(
        sourcePhoto(),
        stamp,
        quarterTurns: 3,
      );
      final decoded = img.decodeJpg(out)!;
      expect(decoded.width, 400);
      expect(decoded.height, 800);

      // Rotated counter-clockwise: the blue (right) half ends up on top.
      final top = decoded.getPixel(200, 20);
      expect(top.b.toInt(), greaterThan(180));
    });
  });

  test('only the three house images are stamped', () {
    expect(PhotoStampService.requiresStamp('house_image_1'), isTrue);
    expect(PhotoStampService.requiresStamp('house_image_2'), isTrue);
    expect(PhotoStampService.requiresStamp('house_image_3'), isTrue);
    expect(PhotoStampService.requiresStamp('location_qr'), isFalse);
    expect(PhotoStampService.requiresStamp('noc_image_1'), isFalse);
    expect(PhotoStampService.requiresStamp('aadhaar_front'), isFalse);
  });
}
