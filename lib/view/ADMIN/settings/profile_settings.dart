import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/view/auth/login_screen.dart';

class ProfileSettings extends StatefulWidget {
  const ProfileSettings({super.key});

  @override
  State<ProfileSettings> createState() => _ProfileSettingsState();
}

class _ProfileSettingsState extends State<ProfileSettings> {
  String _userName = 'Admin User';
  String _roleName = 'ADMIN';
  String _email = 'admin@sarvam.com';
  String _phone = '+91 98765 43210';
  bool _notificationsEnabled = true;

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  @override
  void initState() {
    super.initState();
    _loadProfileInfo();
  }

  Future<void> _loadProfileInfo() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      final fname = prefs.getString('firstName') ?? '';
      final lname = prefs.getString('lastName') ?? '';
      if (fname.isNotEmpty || lname.isNotEmpty) {
        _userName = '$fname $lname'.trim();
      }
      _roleName = prefs.getString('role') ?? 'ADMIN';
      _email = prefs.getString('email') ?? 'admin@sarvam.com';
      _phone = prefs.getString('phone') ?? '+91 98765 43210';
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          'Profile & Settings',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(16.w),
          child: Column(
            children: [
              _buildProfileHeader(),
              SizedBox(height: 20.h),
              _buildSettingsSection(),
              SizedBox(height: 20.h),
              _buildLogoutButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildProfileHeader() {
    return Container(
      padding: EdgeInsets.all(20.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 54.w,
            height: 54.w,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [_primaryGreen, Color(0xFF1A8A5A)],
              ),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                _userName.isNotEmpty ? _userName[0].toUpperCase() : 'A',
                style: GoogleFonts.inter(
                  fontSize: 22.sp,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _userName,
                  style: GoogleFonts.inter(
                    fontSize: 16.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  'Role: $_roleName • $_email • $_phone',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingsSection() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          _buildSettingTile(
            icon: Icons.security_rounded,
            title: 'Change Password & MPIN',
            subtitle: 'Update secure login credentials',
            onTap: () {
              Get.snackbar(
                'Security Settings',
                'Reset link sent to your registered email.',
                snackPosition: SnackPosition.BOTTOM,
                backgroundColor: _primaryGreen,
                colorText: Colors.white,
              );
            },
          ),
          const Divider(height: 1),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            secondary: Container(
              padding: EdgeInsets.all(8.w),
              decoration: BoxDecoration(
                color: _primaryGreen.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10.r),
              ),
              child: Icon(Icons.notifications_active_rounded, color: _primaryGreen, size: 18.sp),
            ),
            title: Text(
              'Push Notifications',
              style: GoogleFonts.inter(fontSize: 14.sp, fontWeight: FontWeight.w600, color: _darkText),
            ),
            subtitle: Text(
              'Real-time alerts for approvals & collections',
              style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
            ),
            value: _notificationsEnabled,
            activeColor: _primaryGreen,
            onChanged: (val) => setState(() => _notificationsEnabled = val),
          ),
        ],
      ),
    );
  }

  Widget _buildSettingTile({required IconData icon, required String title, required String subtitle, required VoidCallback onTap}) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      onTap: onTap,
      leading: Container(
        padding: EdgeInsets.all(8.w),
        decoration: BoxDecoration(
          color: _primaryGreen.withOpacity(0.1),
          borderRadius: BorderRadius.circular(10.r),
        ),
        child: Icon(icon, color: _primaryGreen, size: 18.sp),
      ),
      title: Text(
        title,
        style: GoogleFonts.inter(fontSize: 14.sp, fontWeight: FontWeight.w600, color: _darkText),
      ),
      subtitle: Text(
        subtitle,
        style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
      ),
      trailing: const Icon(Icons.arrow_forward_ios_rounded, color: _muted, size: 14),
    );
  }

  Widget _buildLogoutButton() {
    return SizedBox(
      width: double.infinity,
      height: 48.h,
      child: OutlinedButton.icon(
        onPressed: () async {
          final prefs = await SharedPreferences.getInstance();
          await prefs.clear();
          Get.offAll(() => const LoginScreen());
        },
        icon: const Icon(Icons.logout_rounded, color: Color(0xFFDC2626)),
        label: Text(
          'Sign Out of Account',
          style: GoogleFonts.inter(
            fontSize: 14.sp,
            fontWeight: FontWeight.w700,
            color: const Color(0xFFDC2626),
          ),
        ),
        style: OutlinedButton.styleFrom(
          side: const BorderSide(color: Color(0xFFFCA5A5)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14.r)),
        ),
      ),
    );
  }
}
