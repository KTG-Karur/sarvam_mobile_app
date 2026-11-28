import 'dart:io';

import 'package:sqflite/sqflite.dart' show getDatabasesPath;

/// A small on-device record of what Live Tracking did: fixes stored or skipped
/// (and why), GPS errors, service starts and uploads. The server only sees the
/// points that survive, so this is what explains a hole in a route.
class TrackingLog {
  TrackingLog._();

  /// When the file grows past this, the older half is dropped.
  static const int _maxBytes = 300 * 1024;

  // Writes are queued so two lines never interleave.
  static Future<void> _queue = Future<void>.value();

  static Future<File> _file() async =>
      File('${await getDatabasesPath()}/tracking_log.txt');

  static void add(String message) {
    final time = DateTime.now().toIso8601String().substring(5, 19);
    _queue = _queue.then((_) async {
      try {
        final file = await _file();
        await file.parent.create(recursive: true);
        await file.writeAsString(
          '$time $message\n',
          mode: FileMode.append,
          flush: true,
        );
        if (await file.length() > _maxBytes) {
          final lines = await file.readAsLines();
          final kept = lines.skip(lines.length ~/ 2).join('\n');
          await file.writeAsString('$kept\n');
        }
      } catch (_) {
        // Logging must never stop tracking.
      }
    });
  }

  static Future<String> read() async {
    try {
      final file = await _file();
      return await file.exists() ? await file.readAsString() : '';
    } catch (e) {
      return 'Could not read the log: $e';
    }
  }
}
