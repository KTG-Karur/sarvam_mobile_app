import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/services/tracking_service.dart';

void main() {
  bool usable(double accuracy, int? secondsSinceStored) =>
      TrackingService.isAccuracyUsable(
        accuracy,
        secondsSinceStored == null
            ? null
            : Duration(seconds: secondsSinceStored),
      );

  test('a good fix is always used', () {
    expect(usable(12, 5), isTrue);
    expect(usable(25, 5), isTrue);
  });

  test('a weak fix is skipped while a stored one is recent', () {
    expect(usable(35, 30), isFalse);
    expect(usable(35, 89), isFalse);
  });

  test('a weak fix is used once nothing has been stored for a while', () {
    expect(usable(35, 90), isTrue);
    expect(usable(100, 600), isTrue);
    expect(usable(35, null), isTrue);
  });

  test('a fix the server would not use is never kept', () {
    expect(usable(101, 600), isFalse);
    expect(usable(500, null), isFalse);
  });
}
