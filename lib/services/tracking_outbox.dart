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

/// Local SQLite queue for live-tracking fixes.
///
/// Rules:
///  * a fix is written here BEFORE any network call;
///  * a row is deleted only after the server has answered for it;
///  * only the background-service isolate writes;
///  * rows are keyed by user_id so a multi-user device never mixes employees.
class TrackingOutbox {
  TrackingOutbox._();

  static const _table = 'tracking_outbox';

  /// Rows older than this are dropped (server rejects fixes older than 7 days).
  static const Duration maxAge = Duration(days: 7);

  /// Hard cap per user; when exceeded the oldest rows go first.
  static const int maxRows = 20000;

  static Database? _db;

  static Future<Database> _open() async {
    final existing = _db;
    if (existing != null) return existing;
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      '$dir/tracking_outbox.db',
      version: 2,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_table (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            client_ping_id  TEXT    NOT NULL UNIQUE,
            captured_at     INTEGER NOT NULL,
            payload         TEXT    NOT NULL,
            attempts        INTEGER NOT NULL DEFAULT 0,
            created_at      INTEGER NOT NULL,
            user_id         TEXT    NOT NULL DEFAULT ''
          )
        ''');
        await db.execute(
          'CREATE INDEX tracking_outbox_order ON $_table (user_id, captured_at, id)',
        );
      },
      onUpgrade: (db, oldVersion, newVersion) async {
        if (oldVersion < 2) {
          // Add user_id column; existing rows get an empty string so they
          // remain visible to whoever is signed in (safe one-time migration).
          await db.execute(
            "ALTER TABLE $_table ADD COLUMN user_id TEXT NOT NULL DEFAULT ''",
          );
          // Re-create index to include the new column.
          await db.execute('DROP INDEX IF EXISTS tracking_outbox_order');
          await db.execute(
            'CREATE INDEX tracking_outbox_order ON $_table (user_id, captured_at, id)',
          );
        }
      },
    );
    _db = db;
    return db;
  }

  /// Stores a fix for [userId]. A fix with an id already queued is ignored.
  static Future<void> add({
    required String clientPingId,
    required int capturedAtMs,
    required String payload,
    required String userId,
  }) async {
    final db = await _open();
    await db.insert(_table, {
      'client_ping_id': clientPingId,
      'captured_at': capturedAtMs,
      'payload': payload,
      'attempts': 0,
      'created_at': DateTime.now().millisecondsSinceEpoch,
      'user_id': userId,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  /// The oldest waiting fixes for [userId], in capture order.
  static Future<List<TrackingOutboxRow>> oldest(int limit, {String userId = ''}) async {
    final db = await _open();
    final rows = await db.query(
      _table,
      columns: ['id', 'client_ping_id', 'payload'],
      where: 'user_id = ?',
      whereArgs: [userId],
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

  static Future<int> count({String userId = ''}) async {
    final db = await _open();
    return Sqflite.firstIntValue(
          await db.rawQuery(
            'SELECT COUNT(*) FROM $_table WHERE user_id = ?',
            [userId],
          ),
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

  /// Notes a failed attempt without removing the rows.
  static Future<void> markAttempt(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await _open();
    final marks = List.filled(ids.length, '?').join(',');
    await db.rawUpdate(
      'UPDATE $_table SET attempts = attempts + 1 WHERE id IN ($marks)',
      ids,
    );
  }

  /// Deletes rows that have been attempted more than [maxAttempts] times.
  static Future<void> pruneExcessAttempts(
    List<int> ids, {
    required int maxAttempts,
  }) async {
    if (ids.isEmpty) return;
    final db = await _open();
    final marks = List.filled(ids.length, '?').join(',');
    await db.rawDelete(
      'DELETE FROM $_table WHERE id IN ($marks) AND attempts >= ?',
      [...ids, maxAttempts],
    );
  }

  /// Applies retention rules for [userId]. Returns how many rows were removed.
  static Future<int> prune({String userId = ''}) async {
    final db = await _open();
    final cutoff = DateTime.now().subtract(maxAge).millisecondsSinceEpoch;
    var removed = await db.delete(
      _table,
      where: 'user_id = ? AND captured_at < ?',
      whereArgs: [userId, cutoff],
    );
    final total = await count(userId: userId);
    if (total > maxRows) {
      removed += await db.rawDelete(
        'DELETE FROM $_table WHERE user_id = ? AND id IN '
        '(SELECT id FROM $_table WHERE user_id = ? ORDER BY captured_at ASC, id ASC LIMIT ?)',
        [userId, userId, total - maxRows],
      );
    }
    return removed;
  }
}
