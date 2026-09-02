import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
import 'package:sarvam/services/face_biometric_service.dart';
import 'package:sarvam/view/FDO/home/home.dart';
import 'package:sarvam/view/BM/BM_home.dart';
import 'package:sarvam/view/AM/AM_home.dart';
import 'package:sarvam/view/ADMIN/admin_home.dart';

/// Calendar-day key ('YYYY-MM-DD') used to gate face verification to once
/// per day: an FDO who punched in already shouldn't have to face-verify
/// again just for reopening the app later the same day.
String todayDateKey() {
  final now = DateTime.now();
  final month = now.month.toString().padLeft(2, '0');
  final day = now.day.toString().padLeft(2, '0');
  return '${now.year}-$month-$day';
}

/// True if [FaceVerificationScreen] already recorded a successful punch-in
/// for today via `lastPunchInDate` in prefs and user has not punched out yet.
bool hasPunchedInToday(SharedPreferences prefs) {
  final today = todayDateKey();
  final lastPunchIn = prefs.getString('lastPunchInDate');
  final lastPunchOut = prefs.getString('lastPunchOutDate');
  return lastPunchIn == today && lastPunchOut != today;
}

/// True if user recorded a successful punch-out for today.
bool hasPunchedOutToday(SharedPreferences prefs) {
  final lastPunchOut = prefs.getString('lastPunchOutDate');
  if (lastPunchOut == null || lastPunchOut.isEmpty) return false;
  return lastPunchOut == todayDateKey() || lastPunchOut.startsWith(todayDateKey());
}

/// Makes the local punch-state cache mirror the authoritative server status —
/// both directions. Without the "clear when the server denies" half, a stale
/// `lastPunchOutDate` from earlier testing makes the app wrongly report
/// "already punched out" right after a fresh punch-in.
///
/// No-op when [info] is null (offline): the local cache is kept as-is.
Future<void> reconcilePunchPrefs(
  SharedPreferences prefs,
  ServerAttendanceInfo? info,
) async {
  if (info == null) return;
  final today = todayDateKey();
  final serverIn = info.present || info.punchedIn;
  final serverOut = info.punchedOut;

  if (!serverIn && !serverOut) {
    // Server has no attendance for today — drop every local trace.
    await prefs.remove('lastPunchInDate');
    await prefs.remove('lastPunchInTime');
    await prefs.remove('lastPunchOutDate');
    await prefs.remove('lastPunchOutTime');
    await prefs.remove('lastPunchStatus');
    return;
  }

  if (serverIn) {
    await prefs.setString('lastPunchInDate', today);
  }
  if (serverOut) {
    await prefs.setString('lastPunchOutDate', today);
  } else {
    // Punched in but not out — clear any stale punch-out mark.
    await prefs.remove('lastPunchOutDate');
    await prefs.remove('lastPunchOutTime');
  }
  if (info.status != null) {
    await prefs.setString('lastPunchStatus', info.status!);
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
