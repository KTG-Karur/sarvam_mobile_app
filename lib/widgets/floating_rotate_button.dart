import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/orientation_controller.dart';

class FloatingRotateButton extends StatelessWidget {
  final Alignment alignment;
  final bool showLabel;

  const FloatingRotateButton({
    super.key,
    this.alignment = Alignment.bottomRight,
    this.showLabel = false,
  });

  @override
  Widget build(BuildContext context) {
    final OrientationController controller = Get.isRegistered<OrientationController>()
        ? Get.find<OrientationController>()
        : Get.put(OrientationController());

    return Obx(() {
      final isLandscape = controller.isLandscape.value;
      return Container(
        margin: const EdgeInsets.all(12.0),
        child: Material(
          elevation: 6.0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(28.0),
          ),
          color: const Color(0xFF0D6842), // Sarvam primary color theme
          child: InkWell(
            borderRadius: BorderRadius.circular(28.0),
            onTap: () => controller.toggleOrientation(),
            onLongPress: () => controller.enableAutoRotate(),
            child: Padding(
              padding: EdgeInsets.symmetric(
                horizontal: showLabel ? 14.0 : 12.0,
                vertical: 12.0,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  AnimatedRotation(
                    turns: isLandscape ? 0.25 : 0.0,
                    duration: const Duration(milliseconds: 300),
                    child: const Icon(
                      Icons.screen_rotation_rounded,
                      color: Colors.white,
                      size: 22,
                    ),
                  ),
                  if (showLabel) ...[
                    const SizedBox(width: 8),
                    Text(
                      isLandscape ? 'Portrait' : 'Rotate',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    });
  }
}
