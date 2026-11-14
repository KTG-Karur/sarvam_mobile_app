import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/view/auth/login_screen.dart';
import 'package:sarvam/view/auth/mpin_login_screen.dart';
import 'package:sarvam/view/FDO/home/home.dart';
import 'package:sarvam/services/secure_session_service.dart';
import 'package:sarvam/services/app_permission_service.dart';

import 'package:sarvam/constant/api.dart';
import 'package:sarvam/constant/companies.dart';
import 'package:sarvam/services/app_version_service.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  // Logo of the company chosen last time; Sarvam until the saved choice is read.
  String _logo = Companies.logoFor(null);
  late final Animation<double> _logoScaleAnimation;
  late final Animation<double> _logoFadeAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1100),
    );
    _logoScaleAnimation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeOutBack,
    );
    _logoFadeAnimation = CurvedAnimation(
      parent: _controller,
      curve: const Interval(0, 0.55, curve: Curves.easeOut),
    );

    _controller.forward();
    _loadLogo();
    Future.delayed(const Duration(milliseconds: 1800), () async {
      if (!mounted) return;
      await AppPermissionService.requestStartupPermissions();
      if (!mounted) return;

      // ── Version gate — must pass before any navigation ──
      final bool canContinue = await AppVersionService.checkAndPrompt();
      if (!mounted || !canContinue) return;

      final prefs = await SharedPreferences.getInstance();

      final String? selectedUrl = prefs.getString('selected_company_url');
      if (selectedUrl != null && selectedUrl.isNotEmpty) {
        Api.setBaseUrl(selectedUrl);
        final String? token = await SecureSessionService.readAccessToken();
        final bool mpinSet = prefs.getBool('isMpinSet') ?? false;
        final bool directLogin = prefs.getBool('directLogin') ?? false;
        if (token != null && token.isNotEmpty && directLogin) {
          Get.off(() => const Home());
        } else if (token != null && token.isNotEmpty && mpinSet) {
          Get.off(() => const MpinLoginScreen());
        } else {
          Get.off(() => const LoginScreen());
        }
      } else {
        // No company chosen yet: sign in on the default one (the Login screen
        // has a Company dropdown).
        Api.setBaseUrl(Companies.defaultUrl);
        Get.off(() => const LoginScreen());
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _loadLogo() async {
    final prefs = await SharedPreferences.getInstance();
    final logo = Companies.logoForUrl(prefs.getString('selected_company_url'));
    if (mounted && logo != _logo) setState(() => _logo = logo);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        toolbarHeight: 0,
      ),
      backgroundColor: Colors.white,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            FadeTransition(
              opacity: _logoFadeAnimation,
              child: ScaleTransition(
                scale: _logoScaleAnimation,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(24.r),
                  child: Image.asset(
                    _logo,
                    width: 180.w,
                    height: 180.w,
                    fit: BoxFit.contain,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
