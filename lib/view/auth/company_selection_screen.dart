import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/view/auth/login_screen.dart';

class CompanySelectionScreen extends StatelessWidget {
  const CompanySelectionScreen({super.key});

  static const _companies = {
    // 'Sarvam': 'https://ktg.nidhimfi.com',
    'Sarvam': 'https://sarvam.nidhimfi.com',
    'GCPL': 'https://gcpl.nidhimfi.com',
  };

  Future<void> _selectCompany(String name, String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('selected_company', name);
    await prefs.setString('selected_company_url', url);
    Api.setBaseUrl(url);
    Get.off(() => const LoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 24.w),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Select Company',
                style: TextStyle(
                  fontSize: 24.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF0B2A1A),
                ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: 40.h),
              ..._companies.entries.map((e) => Padding(
                padding: EdgeInsets.only(bottom: 16.h),
                child: ElevatedButton(
                  onPressed: () => _selectCompany(e.key, e.value),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0D6842),
                    foregroundColor: Colors.white,
                    padding: EdgeInsets.symmetric(vertical: 16.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12.r),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    e.key,
                    style: TextStyle(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              )),
            ],
          ),
        ),
      ),
    );
  }
}
