import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/auth_controller.dart';
import 'package:sarvam/controller/dashboard_controller.dart';
import 'package:sarvam/services/hr_api_service.dart';

/// "My Profile" — account summary + settings entry points for the FDO.
/// Total Visits and Target Achieved have no backend data source yet (same
/// gap documented in `lib/view/FDO/performance/my_performance.dart`), so
/// they stay placeholder here too; Members/Collection reuse the real,
/// already-loaded `DashboardController` stats instead of re-fetching.
class MyProfile extends StatefulWidget {
  const MyProfile({super.key});

  @override
  State<MyProfile> createState() => _MyProfileState();
}

class _MyProfileState extends State<MyProfile> {
  static const _green = Color(0xFF00843D);
  static const _darkGreen = Color(0xFF0B4A2C);

  final DashboardController _dashboard = Get.isRegistered<DashboardController>()
      ? Get.find<DashboardController>()
      : Get.put(DashboardController());

  String _firstName = '';
  String _lastName = '';
  String _mobile = '';
  String _email = '';
  String _role = '';
  String _branchName = '';
  String _employeeId = '';
  String _dateOfJoining = '';

  static const _roleLabels = {
    'FDO': 'Field Development Officer',
    'BM': 'Branch Manager',
    'BRANCH_MANAGER': 'Branch Manager',
    'AM': 'Area Manager',
    'AREA_MANAGER': 'Area Manager',
    'ADMIN': 'Administrator',
  };

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _firstName = prefs.getString('firstName') ?? '';
      _lastName = prefs.getString('lastName') ?? '';
      _mobile = prefs.getString('mobileNumber') ?? '';
      _email = prefs.getString('email') ?? '';
      _role = (prefs.getString('role') ?? '').trim().toUpperCase();
      _branchName = prefs.getString('branchName') ?? '';
      _employeeId = prefs.getString('employeeId') ?? '';
    });

    try {
      final profile = await HrApiService.myEmployeeProfile();
      if (!mounted || profile.isEmpty) return;
      final branch = profile['branch'];
      setState(() {
        _firstName = _profileText(profile['firstName'], _firstName);
        _lastName = _profileText(profile['lastName'], _lastName);
        _mobile = _profileText(profile['mobileNumber'], _mobile);
        _email = _profileText(profile['email'], _email);
        _role = _profileText(profile['role'], _role).trim().toUpperCase();
        _employeeId = _profileText(profile['employeeId'], _employeeId);
        _branchName = branch is Map
            ? _profileText(branch['name'], _branchName)
            : _branchName;
        _dateOfJoining = _formatDate(profile['dateOfJoining']);
      });
    } catch (_) {
      // Preserve cached login data if this optional refresh is unavailable.
    }
  }

  String _profileText(dynamic value, String fallback) {
    final text = value?.toString().trim() ?? '';
    return text.isEmpty || text == 'null' ? fallback : text;
  }

  String _formatDate(dynamic value) {
    final raw = value?.toString().trim() ?? '';
    if (raw.isEmpty || raw == 'null') return '';
    final date = DateTime.tryParse(raw);
    if (date == null) return raw;
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${date.day.toString().padLeft(2, '0')} ${months[date.month - 1]} ${date.year}';
  }

  String get _fullName {
    final name = '$_firstName $_lastName'.trim();
    return name.isEmpty ? 'Employee' : name;
  }

  String get _roleLabel => _roleLabels[_role] ?? (_role.isEmpty ? '—' : _role);

  void _comingSoon(String feature) => Get.snackbar(
    feature,
    'This will be available in an upcoming update.',
    snackPosition: SnackPosition.BOTTOM,
    backgroundColor: const Color(0xFF334155),
    colorText: Colors.white,
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF2FAF5),
    body: Column(
      children: [
        _header(context),
        Expanded(
          child: SingleChildScrollView(
            clipBehavior: Clip.none,
            padding: EdgeInsets.fromLTRB(16.w, 0, 16.w, 32.h),
            child: Transform.translate(
              offset: Offset(0, -24.h),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _profileCard(),
                  SizedBox(height: 14.h),
                  _statsStrip(),
                  SizedBox(height: 14.h),
                  _menuCard(context),
                  SizedBox(height: 16.h),
                  _logoutButton(context),
                ],
              ),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _header(BuildContext context) => Container(
    width: double.infinity,
    padding: EdgeInsets.fromLTRB(16.w, 54.h, 16.w, 48.h),
    decoration: const BoxDecoration(
      gradient: LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: [_green, _darkGreen],
      ),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GestureDetector(
          onTap: () => Navigator.maybePop(context),
          child: Padding(
            padding: EdgeInsets.only(top: 2.h),
            child: Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18.sp),
          ),
        ),
        SizedBox(width: 14.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'My Profile',
                style: TextStyle(fontSize: 21.sp, fontWeight: FontWeight.w800, color: Colors.white),
              ),
              SizedBox(height: 3.h),
              Text(
                'Manage your account and preferences',
                style: TextStyle(fontSize: 12.sp, color: Colors.white.withValues(alpha: 0.85)),
              ),
            ],
          ),
        ),
      ],
    ),
  );

  Widget _profileCard() => Container(
    width: double.infinity,
    padding: EdgeInsets.all(16.w),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16.r),
      boxShadow: [
        BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 14, offset: const Offset(0, 4)),
      ],
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Stack(
          children: [
            Container(
              width: 78.w,
              height: 78.w,
              decoration: BoxDecoration(
                color: const Color(0xFFE1F5E7),
                shape: BoxShape.circle,
                border: Border.all(color: const Color(0xFFD6EFDF), width: 3),
              ),
              child: Icon(Icons.person_rounded, size: 42.sp, color: _green),
            ),
            Positioned(
              right: 0,
              bottom: 0,
              child: GestureDetector(
                onTap: () => _comingSoon('Profile Photo'),
                child: Container(
                  width: 26.w,
                  height: 26.w,
                  decoration: const BoxDecoration(
                    color: _green,
                    shape: BoxShape.circle,
                    border: Border.fromBorderSide(BorderSide(color: Colors.white, width: 2)),
                  ),
                  child: Icon(Icons.camera_alt_rounded, size: 13.sp, color: Colors.white),
                ),
              ),
            ),
          ],
        ),
        SizedBox(width: 14.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _fullName,
                style: TextStyle(fontSize: 18.sp, fontWeight: FontWeight.w800, color: const Color(0xFF0B2A1A)),
              ),
              SizedBox(height: 2.h),
              Text(
                _roleLabel,
                style: TextStyle(fontSize: 12.5.sp, color: const Color(0xFF64748B), fontWeight: FontWeight.w600),
              ),
              SizedBox(height: 8.h),
              Row(
                children: [
                  _chip(
                    icon: Icons.groups_2_rounded,
                    label: _role.isEmpty ? '—' : _role,
                    bg: const Color(0xFFE1F5E7),
                    fg: _darkGreen,
                  ),
                  SizedBox(width: 8.w),
                  _chip(
                    icon: Icons.circle,
                    iconSize: 8,
                    label: 'Active',
                    bg: const Color(0xFFE1F5E7),
                    fg: _green,
                  ),
                ],
              ),
              SizedBox(height: 10.h),
              if (_mobile.isNotEmpty) _contactRow(Icons.phone_rounded, _mobile),
              if (_email.isNotEmpty) ...[
                SizedBox(height: 6.h),
                _contactRow(Icons.mail_rounded, _email),
              ],
              if (_branchName.isNotEmpty) ...[
                SizedBox(height: 6.h),
                _contactRow(Icons.location_on_rounded, _branchName),
              ],
            ],
          ),
        ),
      ],
    ),
  );

  Widget _chip({
    required IconData icon,
    required String label,
    required Color bg,
    required Color fg,
    double? iconSize,
  }) => Container(
    padding: EdgeInsets.symmetric(horizontal: 9.w, vertical: 5.h),
    decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20.r)),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: iconSize ?? 12.sp, color: fg),
        SizedBox(width: 4.w),
        Text(label, style: TextStyle(fontSize: 10.5.sp, fontWeight: FontWeight.w800, color: fg)),
      ],
    ),
  );

  Widget _contactRow(IconData icon, String text) => Row(
    children: [
      Icon(icon, size: 13.sp, color: _green),
      SizedBox(width: 6.w),
      Expanded(
        child: Text(
          text,
          style: TextStyle(fontSize: 12.sp, color: const Color(0xFF334155), fontWeight: FontWeight.w600),
          overflow: TextOverflow.ellipsis,
        ),
      ),
    ],
  );

  Widget _statsStrip() => Obx(() {
    final stats = _dashboard.stats;
    final members = stats['totalMembers'] ?? stats['activeMembers'];
    final collection = _dashboard.weeklyCollectionTotal;
    return Container(
      padding: EdgeInsets.symmetric(vertical: 16.h, horizontal: 8.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        boxShadow: [
          BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 3)),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _statCell(
              icon: Icons.location_on_rounded,
              iconColor: _green,
              iconBg: const Color(0xFFE1F5E7),
              value: '—',
              label: 'Total Visits',
            ),
          ),
          _divider(),
          Expanded(
            child: _statCell(
              icon: Icons.people_alt_rounded,
              iconColor: const Color(0xFF2563EB),
              iconBg: const Color(0xFFDCEBFF),
              value: members != null ? '$members' : '—',
              label: 'Members',
            ),
          ),
          _divider(),
          Expanded(
            child: _statCell(
              icon: Icons.account_balance_wallet_rounded,
              iconColor: const Color(0xFFB45309),
              iconBg: const Color(0xFFFCEBC9),
              value: collection > 0 ? '₹ ${collection.toStringAsFixed(0)}' : '₹ 0',
              label: 'Collection',
            ),
          ),
          _divider(),
          Expanded(
            child: _statCell(
              icon: Icons.bar_chart_rounded,
              iconColor: const Color(0xFF7C3AED),
              iconBg: const Color(0xFFE7DDFB),
              value: '—',
              label: 'Target Achieved',
            ),
          ),
        ],
      ),
    );
  });

  Widget _divider() => Container(width: 1, height: 46.h, color: const Color(0xFFF1F5F9));

  Widget _statCell({
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
    required String value,
    required String label,
  }) => Column(
    children: [
      Container(
        width: 34.w,
        height: 34.w,
        decoration: BoxDecoration(color: iconBg, shape: BoxShape.circle),
        child: Icon(icon, size: 16.sp, color: iconColor),
      ),
      SizedBox(height: 7.h),
      Text(
        value,
        style: TextStyle(fontSize: 14.5.sp, fontWeight: FontWeight.w800, color: const Color(0xFF0B2A1A)),
        textAlign: TextAlign.center,
      ),
      SizedBox(height: 2.h),
      Text(
        label,
        style: TextStyle(fontSize: 9.5.sp, color: const Color(0xFF64748B), fontWeight: FontWeight.w600),
        textAlign: TextAlign.center,
      ),
    ],
  );

  Widget _menuCard(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(16.r),
      boxShadow: [
        BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 3)),
      ],
    ),
    child: Column(
      children: [
        _menuTile(
          icon: Icons.person_outline_rounded,
          title: 'Personal Information',
          subtitle: 'View and update your personal details',
          onTap: () => _showInfoSheet(
            context,
            title: 'Personal Information',
            rows: {
              'Name': _fullName,
              'Mobile Number': _mobile.isEmpty ? '—' : _mobile,
              'Email': _email.isEmpty ? '—' : _email,
            },
          ),
        ),
        _menuDivider(),
        _menuTile(
          icon: Icons.work_outline_rounded,
          title: 'Work Information',
          subtitle: 'Role, branch, department',
          onTap: () => _showInfoSheet(
            context,
            title: 'Work Information',
            rows: {
              'Employee ID': _employeeId.isEmpty ? '—' : _employeeId,
              'Role': _roleLabel,
              'Branch': _branchName.isEmpty ? '—' : _branchName,
              'Date of Joining': _dateOfJoining.isEmpty ? '—' : _dateOfJoining,
            },
          ),
        ),
      ],
    ),
  );

  Widget _menuDivider() => Divider(height: 1, indent: 60.w, color: const Color(0xFFF1F5F9));

  Widget _menuTile({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) => InkWell(
    onTap: onTap,
    child: Padding(
      padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 13.h),
      child: Row(
        children: [
          Container(
            width: 38.w,
            height: 38.w,
            decoration: BoxDecoration(color: const Color(0xFFE1F5E7), borderRadius: BorderRadius.circular(10.r)),
            child: Icon(icon, size: 18.sp, color: _green),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 13.5.sp, fontWeight: FontWeight.w700, color: const Color(0xFF0B2A1A)),
                ),
                SizedBox(height: 2.h),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 11.sp, color: const Color(0xFF64748B)),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right_rounded, size: 20.sp, color: const Color(0xFF94A3B8)),
        ],
      ),
    ),
  );

  void _showInfoSheet(BuildContext context, {required String title, required Map<String, String> rows}) {
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18.r))),
      builder: (_) => Padding(
        padding: EdgeInsets.fromLTRB(20.w, 18.h, 20.w, 28.h),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.w800, color: const Color(0xFF0B2A1A)),
            ),
            SizedBox(height: 14.h),
            ...rows.entries.map(
              (e) => Padding(
                padding: EdgeInsets.only(bottom: 12.h),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SizedBox(
                      width: 120.w,
                      child: Text(
                        e.key,
                        style: TextStyle(fontSize: 12.sp, color: const Color(0xFF64748B), fontWeight: FontWeight.w600),
                      ),
                    ),
                    Expanded(
                      child: Text(
                        e.value,
                        style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700, color: const Color(0xFF0B2A1A)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _logoutButton(BuildContext context) => SizedBox(
    width: double.infinity,
    height: 50.h,
    child: OutlinedButton.icon(
      onPressed: () {
        final authController = Get.isRegistered<AuthController>()
            ? Get.find<AuthController>()
            : Get.put(AuthController());
        authController.confirmLogout(context);
      },
      icon: Icon(Icons.logout_rounded, size: 17.sp, color: const Color(0xFFDC2626)),
      label: Text(
        'Logout',
        style: TextStyle(fontSize: 13.5.sp, fontWeight: FontWeight.w800, color: const Color(0xFFDC2626)),
      ),
      style: OutlinedButton.styleFrom(
        backgroundColor: const Color(0xFFFEECEC),
        side: const BorderSide(color: Color(0xFFFAD1D1)),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
      ),
    ),
  );
}
