import 'package:flutter/widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/roles.dart';
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
/// for today via `lastPunchInDate` in prefs.
bool hasPunchedInToday(SharedPreferences prefs) {
  return prefs.getString('lastPunchInDate') == todayDateKey();
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
