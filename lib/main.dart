import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/view/auth/splash_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();

  // Lock mobile app strictly to Portrait Up mode (disable screen rotation)
  SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
  ]);

  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ScreenUtilInit(
      designSize: const Size(390, 844),
      minTextAdapt: true,
      splitScreenMode: true,
      builder: (context, child) {
        return GetMaterialApp(
          title: 'Sarvam',
          debugShowCheckedModeBanner: false,
          theme: ThemeData(
            colorScheme: ColorScheme.fromSeed(
              seedColor: const Color(0xFF0D6842),
            ),
            useMaterial3: true,
            textTheme: GoogleFonts.poppinsTextTheme(),
          ),
          builder: (context, widget) => widget!,
          home: const SplashScreen(),
        );
      },
    );
  }
}
