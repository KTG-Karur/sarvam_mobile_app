import 'package:sqflite/sqflite.dart';

/// One location fix waiting to be uploaded.
class TrackingOutboxRow {
  const TrackingOutboxRow({
    required this.id,
    required this.clientPingId,
    required this.payload,
  });

  final int id;
  final String clientPingId;

  /// The JSON object exactly as it is sent to the server (already encoded).
  final String payload;
}

/// Local SQLite queue for live-tracking fixes (replaces the JSON list that used
/// to live in SharedPreferences).
///
/// Rules (see docs/live_tracking_mobile_spec.md):
///  * a fix is written here BEFORE any network call, so killing the app in the
///    middle of an upload loses nothing;
///  * a row is deleted only after the server has answered for it, and always by
///    its own id, so rows added meanwhile can never be erased;
///  * only the background-service isolate writes. The UI isolate asks the
///    service to flush instead of touching the database.
class TrackingOutbox {
  TrackingOutbox._();

  static const _table = 'tracking_outbox';

  /// Rows older than this are dropped (the server rejects fixes older than 7 days anyway).
  static const Duration maxAge = Duration(hours: 48);

  /// Hard cap; when exceeded the oldest rows go first.
  static const int maxRows = 5000;

  static Database? _db;

  static Future<Database> _open() async {
    final existing = _db;
    if (existing != null) return existing;
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      '$dir/tracking_outbox.db',
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_table (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            client_ping_id  TEXT    NOT NULL UNIQUE,
            captured_at     INTEGER NOT NULL,
            payload         TEXT    NOT NULL,
            attempts        INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL
          )
        ''');
        await db.execute(
          'CREATE INDEX tracking_outbox_order ON $_table (captured_at, id)',
        );
      },
    );
    _db = db;
    return db;
  }

  /// Stores a fix. A fix with an id that is already queued is ignored.
  static Future<void> add({
    required String clientPingId,
    required int capturedAtMs,
    required String payload,
  }) async {
    final db = await _open();
    await db.insert(_table, {
      'client_ping_id': clientPingId,
      'captured_at': capturedAtMs,
      'payload': payload,
      'attempts': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  /// The oldest waiting fixes, in capture order (the order they must be sent).
  static Future<List<TrackingOutboxRow>> oldest(int limit) async {
    final db = await _open();
    final rows = await db.query(
      _table,
      columns: ['id', 'client_ping_id', 'payload'],
      orderBy: 'captured_at ASC, id ASC',
      limit: limit,
    );
    return rows
        .map(
          (r) => TrackingOutboxRow(
            id: r['id']! as int,
            clientPingId: r['client_ping_id']! as String,
            payload: r['payload']! as String,
          ),
        )
        .toList();
  }

  static Future<int> count() async {
    final db = await _open();
    return Sqflite.firstIntValue(
          await db.rawQuery('SELECT COUNT(*) FROM $_table'),
        ) ??
        0;
  }

  /// Removes rows the server has answered for.
  static Future<void> delete(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await _open();
    final marks = List.filled(ids.length, '?').join(',');
    await db.delete(_table, where: 'id IN ($marks)', whereArgs: ids);
  }

  /// Notes a failed attempt (for diagnostics) without removing the rows.
  static Future<void> markAttempt(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await _open();
    final marks = List.filled(ids.length, '?').join(',');
    await db.rawUpdate(
      'UPDATE $_table SET attempts = attempts + 1 WHERE id IN ($marks)',
      ids,
    );
  }

  /// Applies the retention rules. Returns how many rows were removed.
  static Future<int> prune() async {
    final db = await _open();
    final cutoff = DateTime.now().subtract(maxAge).millisecondsSinceEpoch;
    var removed = await db.delete(
      _table,
      where: 'captured_at < ?',
      whereArgs: [cutoff],
    );
    final total = await count();
    if (total > maxRows) {
      removed += await db.rawDelete(
        'DELETE FROM $_table WHERE id IN '
        '(SELECT id FROM $_table ORDER BY captured_at ASC, id ASC LIMIT ?)',
        [total - maxRows],
      );
    }
    return removed;
  }
}
