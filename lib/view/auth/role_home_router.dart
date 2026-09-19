import 'dart:convert';

import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/services/tracking_service.dart';
import 'package:sarvam/view/FDO/home/home.dart';
import 'package:sarvam/view/BM/BM_home.dart';
import 'package:sarvam/view/AM/AM_home.dart';
import 'package:sarvam/view/ADMIN/admin_home.dart';

/// Calendar-day key ('YYYY-MM-DD') used to gate face verification to once
/// per day: an FDO who punched in already shouldn't have to face-verify
/// again just for reopening the app later the same day.
///
/// Uses local device time — the same clock every other attendance check in
/// the app already relies on. Lexicographic string compare on this format is
/// also a valid date compare, which the day-rollover logic below depends on.
String todayDateKey() {
  final now = DateTime.now();
  final month = now.month.toString().padLeft(2, '0');
  final day = now.day.toString().padLeft(2, '0');
  return '${now.year}-$month-$day';
}

// ─── Local attendance-day state ────────────────────────────────────────────
//
// Working keys in SharedPreferences, all scoped to *today* once
// [reconcilePunchPrefs] has run:
//   lastPunchInDate / lastPunchInTime
//   lastPunchOutDate / lastPunchOutTime
//   lastPunchStatus   (NOT_STARTED | IN_PROGRESS | COMPLETED, mirror of server)
// Finished days are moved out of the working keys into a per-employee history
// list (`attendanceHistory_<employeeId>`); the working keys are then cleared so
// the new day starts clean.

const String kPunchInDateKey = 'lastPunchInDate';
const String kPunchInTimeKey = 'lastPunchInTime';
const String kPunchOutDateKey = 'lastPunchOutDate';
const String kPunchOutTimeKey = 'lastPunchOutTime';
const String kPunchStatusKey = 'lastPunchStatus';

/// True if [FaceVerificationScreen] already recorded a successful punch-in
/// for today via `lastPunchInDate` in prefs and user has not punched out yet.
bool hasPunchedInToday(SharedPreferences prefs) {
  final today = todayDateKey();
  final lastPunchIn = prefs.getString(kPunchInDateKey);
  final lastPunchOut = prefs.getString(kPunchOutDateKey);
  return lastPunchIn == today && lastPunchOut != today;
}

/// True if user recorded a successful punch-out for today.
bool hasPunchedOutToday(SharedPreferences prefs) {
  final lastPunchOut = prefs.getString(kPunchOutDateKey);
  if (lastPunchOut == null || lastPunchOut.isEmpty) return false;
  return lastPunchOut == todayDateKey() ||
      lastPunchOut.startsWith(todayDateKey());
}

/// Canonical status of the *current* calendar day, derived from the reconciled
/// punch flags. Matches the product spec vocabulary.
enum AttendanceDayStatus { notStarted, inProgress, completed, incomplete, holiday }

AttendanceDayStatus resolveAttendanceDayStatus({
  required bool isWorkingDay,
  required bool punchedInToday,
  required bool punchedOutToday,
  String? serverStatus,
}) {
  if (!isWorkingDay || serverStatus == 'HOLIDAY') {
    return AttendanceDayStatus.holiday;
  }
  if (punchedOutToday) return AttendanceDayStatus.completed;
  if (punchedInToday) return AttendanceDayStatus.inProgress;
  return AttendanceDayStatus.notStarted;
}

/// Label shown on the home dashboards: Not Started / In Progress / Completed /
/// Punch-Out Missing / Holiday.
String attendanceStatusLabel(
  AttendanceDayStatus status, {
  String? serverStatus,
}) {
  switch (status) {
    case AttendanceDayStatus.holiday:
      return 'Holiday / Off';
    case AttendanceDayStatus.notStarted:
      return 'Not Started';
    case AttendanceDayStatus.inProgress:
      return 'In Progress';
    case AttendanceDayStatus.incomplete:
      return 'Punch-Out Missing';
    case AttendanceDayStatus.completed:
      if (serverStatus == 'HALF_DAY') return 'Completed · Half Day';
      if (serverStatus == 'FULL_DAY') return 'Completed · Full Day';
      return 'Completed';
  }
}

/// 12-hour clock string ('h:mm AM/PM') used for the stored punch times shown
/// on the home dashboards and in local history.
String formatPunchTime(DateTime dt) {
  final hour = dt.hour % 12 == 0 ? 12 : dt.hour % 12;
  final minute = dt.minute.toString().padLeft(2, '0');
  final period = dt.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $period';
}

/// Writes a successful punch (in or out) into the local working keys, and — for
/// a punch-out — closes today out in local history straight away. This is the
/// single place every verified-punch path (face match or device fingerprint)
/// funnels through so the local cache never drifts between them. Returns the
/// stored time string.
Future<String> recordLocalPunch(
  SharedPreferences prefs, {
  required bool isPunchOut,
}) async {
  final today = todayDateKey();
  final nowTimeStr = formatPunchTime(DateTime.now());

  if (isPunchOut) {
    await prefs.setString(kPunchOutDateKey, today);
    await prefs.setString(kPunchOutTimeKey, nowTimeStr);
    await prefs.setString(kPunchStatusKey, 'COMPLETED');
    // First write wins, so a later rollover can't create a second record.
    await archiveAttendanceDay(
      prefs,
      date: today,
      punchInTime: prefs.getString(kPunchInTimeKey),
      punchOutTime: nowTimeStr,
      status: 'COMPLETED',
    );
  } else {
    await prefs.setString(kPunchInDateKey, today);
    await prefs.setString(kPunchInTimeKey, nowTimeStr);
    await prefs.setString(kPunchStatusKey, 'IN_PROGRESS');
    // A fresh punch-in owns the day — drop any stale punch-out mark.
    await prefs.remove(kPunchOutDateKey);
    await prefs.remove(kPunchOutTimeKey);
  }

  // Start from the confirmed punch action as well as later reconciliation.
  // Without this, tracking only starts after a future home/login refresh and
  // the first GPS breadcrumbs (and their debug prints) can be missed.
  if (isPunchOut) {
    await TrackingService.stop();
  } else {
    await TrackingService.start();
  }
  return nowTimeStr;
}

// ─── Local attendance history ─────────────────────────────────────────────

String _attendanceHistoryKey(SharedPreferences prefs) {
  final emp = prefs.getString('employeeId');
  return 'attendanceHistory_${(emp == null || emp.isEmpty) ? 'unknown' : emp}';
}

/// One finished local attendance day. `punchOutTime` is null when the user
/// never punched out — a fake time is never synthesised.
class AttendanceHistoryEntry {
  final String date; // YYYY-MM-DD
  final String? punchInTime;
  final String? punchOutTime;
  final String status; // COMPLETED | PUNCH_OUT_MISSING

  const AttendanceHistoryEntry({
    required this.date,
    required this.punchInTime,
    required this.punchOutTime,
    required this.status,
  });

  bool get isIncomplete => status == 'PUNCH_OUT_MISSING';

  Map<String, dynamic> toJson() => {
        'date': date,
        'punchInTime': punchInTime,
        'punchOutTime': punchOutTime,
        'status': status,
      };

  factory AttendanceHistoryEntry.fromJson(Map<String, dynamic> j) =>
      AttendanceHistoryEntry(
        date: j['date']?.toString() ?? '',
        punchInTime: j['punchInTime']?.toString(),
        punchOutTime: j['punchOutTime']?.toString(),
        status: j['status']?.toString() ?? 'PUNCH_OUT_MISSING',
      );
}

/// Reads the local attendance history, newest day first.
Future<List<AttendanceHistoryEntry>> readAttendanceHistory(
  SharedPreferences prefs,
) async {
  final raw = prefs.getString(_attendanceHistoryKey(prefs));
  if (raw == null || raw.isEmpty) return const [];
  try {
    final list = jsonDecode(raw) as List;
    final entries = list
        .whereType<Map>()
        .map((e) => AttendanceHistoryEntry.fromJson(e.cast<String, dynamic>()))
        .where((e) => e.date.isNotEmpty)
        .toList();
    entries.sort((a, b) => b.date.compareTo(a.date));
    return entries;
  } catch (_) {
    return const [];
  }
}

Future<void> _writeAttendanceHistory(
  SharedPreferences prefs,
  List<AttendanceHistoryEntry> entries,
) async {
  final seen = <String>{};
  final deduped = <AttendanceHistoryEntry>[];
  for (final e in entries) {
    if (e.date.isEmpty || !seen.add(e.date)) continue;
    deduped.add(e);
  }
  deduped.sort((a, b) => b.date.compareTo(a.date));
  final capped = deduped.take(60).toList();
  await prefs.setString(
    _attendanceHistoryKey(prefs),
    jsonEncode(capped.map((e) => e.toJson()).toList()),
  );
}

/// Records one finished day in local history. The first write for a date wins
/// — a later call for the same date is ignored, so a genuine
/// `PUNCH_OUT_MISSING` archive can never be overwritten by a no-op and no
/// duplicate record is ever created for the same employee + date.
Future<void> archiveAttendanceDay(
  SharedPreferences prefs, {
  required String date,
  required String? punchInTime,
  required String? punchOutTime,
  required String status,
}) async {
  if (date.isEmpty) return;
  final history = await readAttendanceHistory(prefs);
  if (history.any((e) => e.date == date)) return;
  await _writeAttendanceHistory(prefs, [
    ...history,
    AttendanceHistoryEntry(
      date: date,
      punchInTime: punchInTime,
      punchOutTime: punchOutTime,
      status: status,
    ),
  ]);
}

/// Closes out a stale punch when the app is opened on a later calendar day.
/// Offline-safe and idempotent:
///
/// * previous day punched in **and** out  → archived `COMPLETED`
/// * previous day punched in, never out   → archived `PUNCH_OUT_MISSING`
///   (the punch-in time is kept; no fake punch-out time is generated)
///
/// The working keys are then cleared so the new day starts at `Not Started`
/// with the Punch-In action available. The previous day's stored punch-in /
/// punch-out data is never mutated.
Future<void> rolloverAttendanceForNewDay(SharedPreferences prefs) async {
  final today = todayDateKey();
  final inDate = prefs.getString(kPunchInDateKey);
  final outDate = prefs.getString(kPunchOutDateKey);

  // Stale punch-out mark with no punch-in (older test data / partial state).
  if ((inDate == null || inDate.isEmpty) &&
      outDate != null &&
      outDate.isNotEmpty &&
      outDate != today) {
    await prefs.remove(kPunchOutDateKey);
    await prefs.remove(kPunchOutTimeKey);
    await prefs.remove(kPunchStatusKey);
    return;
  }

  if (inDate == null || inDate.isEmpty) return;
  // Same day, or a (clock-skew) future stamp — leave it alone.
  if (inDate.compareTo(today) >= 0) return;

  final completed = outDate == inDate;
  await archiveAttendanceDay(
    prefs,
    date: inDate,
    punchInTime: prefs.getString(kPunchInTimeKey),
    punchOutTime: completed ? prefs.getString(kPunchOutTimeKey) : null,
    status: completed ? 'COMPLETED' : 'PUNCH_OUT_MISSING',
  );

  await prefs.remove(kPunchInDateKey);
  await prefs.remove(kPunchInTimeKey);
  await prefs.remove(kPunchOutDateKey);
  await prefs.remove(kPunchOutTimeKey);
  await prefs.remove(kPunchStatusKey);
}

/// Makes the local punch-state cache mirror the authoritative server status —
/// both directions. Always rolls a stale previous day forward first (works
/// offline too), then, when [info] is present, reconciles today against it.
///
/// Without the "clear when the server denies" half, a stale `lastPunchOutDate`
/// from earlier testing makes the app wrongly report "already punched out"
/// right after a fresh punch-in.
Future<void> reconcilePunchPrefs(
  SharedPreferences prefs,
  ServerAttendanceInfo? info,
) async {
  await rolloverAttendanceForNewDay(prefs);

  if (info == null) return;
  final today = todayDateKey();
  final serverIn = info.present || info.punchedIn;
  final serverOut = info.punchedOut;

  if (!serverIn && !serverOut) {
    // Server has no attendance for today — drop every local trace.
    await prefs.remove(kPunchInDateKey);
    await prefs.remove(kPunchInTimeKey);
    await prefs.remove(kPunchOutDateKey);
    await prefs.remove(kPunchOutTimeKey);
    await prefs.remove(kPunchStatusKey);
    await TrackingService.stop();
    return;
  }

  if (serverIn) {
    await prefs.setString(kPunchInDateKey, today);
  }
  if (serverOut) {
    await prefs.setString(kPunchOutDateKey, today);
    // Keep local history current for a punch-out the server already knows
    // about (e.g. punched out on another device).
    await archiveAttendanceDay(
      prefs,
      date: today,
      punchInTime: prefs.getString(kPunchInTimeKey),
      punchOutTime: prefs.getString(kPunchOutTimeKey),
      status: 'COMPLETED',
    );
  } else {
    // Punched in but not out — clear any stale punch-out mark.
    await prefs.remove(kPunchOutDateKey);
    await prefs.remove(kPunchOutTimeKey);
  }

  // Live Tracking mirrors the server's punched-in/out truth: running only
  // for the window between a confirmed punch-in and punch-out, on every
  // login/home-load/punch-out reconciliation — not just a fresh punch.
  if (serverIn && !serverOut) {
    await TrackingService.start();
  } else {
    await TrackingService.stop();
  }

  if (info.status != null) {
    await prefs.setString(kPunchStatusKey, info.status!);
  } else {
    await prefs.setString(
      kPunchStatusKey,
      serverOut ? 'COMPLETED' : 'IN_PROGRESS',
    );
  }
}

/// Resolves which dashboard to land on after login/MPIN, based on the
/// logged-in user's role stored during [AuthController.login]. Role matching
/// is delegated to [RoleScope] so every screen agrees on the same tokens
/// (AM / AREA MANAGER / AREA_MANAGER, BM / BRANCH MANAGER / BRANCH_MANAGER).
Future<Widget> resolveHomeScreen() async {
  final prefs = await SharedPreferences.getInstance();
  final role = prefs.getString('role') ?? '';
  final rbacRoleName = prefs.getString('rbacRoleName') ?? '';

  final resolved = RoleScope.resolve(role, rbacRoleName);

  switch (resolved) {
    case AppRole.branchManager:
      return const BmHome();
    case AppRole.areaManager:
      return const AmHome();
    case AppRole.admin:
      return const AdminHome();
    case AppRole.fdo:
    case AppRole.unknown:
      return const Home();
  }
}
