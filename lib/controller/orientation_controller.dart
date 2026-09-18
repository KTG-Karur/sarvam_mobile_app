import 'package:flutter/services.dart';
import 'package:get/get.dart';

class OrientationController extends GetxController {
  final isLandscape = false.obs;
  final isAutoRotate = true.obs;
  final currentOrientation = DeviceOrientation.portraitUp.obs;

  @override
  void onInit() {
    super.onInit();
    enableAutoRotate();
  }

  /// Toggle manually between Portrait and Landscape
  void toggleOrientation() {
    if (isLandscape.value) {
      setPortrait();
    } else {
      setLandscape();
    }
  }

  /// Lock screen to Portrait Up
  void setPortrait() {
    isAutoRotate.value = false;
    isLandscape.value = false;
    currentOrientation.value = DeviceOrientation.portraitUp;
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);
    Get.snackbar(
      'Screen Orientation',
      'Switched to Portrait mode',
      duration: const Duration(seconds: 2),
      snackPosition: SnackPosition.BOTTOM,
    );
  }

  /// Lock screen to Landscape Left
  void setLandscape() {
    isAutoRotate.value = false;
    isLandscape.value = true;
    currentOrientation.value = DeviceOrientation.landscapeLeft;
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
    Get.snackbar(
      'Screen Orientation',
      'Switched to Landscape mode',
      duration: const Duration(seconds: 2),
      snackPosition: SnackPosition.BOTTOM,
    );
  }

  /// Restore auto-rotation for all 4 orientations based on physical device sensors
  void enableAutoRotate() {
    isAutoRotate.value = true;
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  /// Update orientation state when layout builder detects rotation change
  void updateOrientationFromContext(bool landscape) {
    if (isLandscape.value != landscape) {
      isLandscape.value = landscape;
    }
  }
}
