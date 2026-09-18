import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/orientation_controller.dart';
import 'package:sarvam/widgets/floating_rotate_button.dart';

/// A wrapper widget that provides responsive screen layout support
/// across portrait and landscape orientations, preventing screen overflow,
/// and embedding a quick screen rotation toggle button.
class ResponsiveOrientationWrapper extends StatelessWidget {
  final Widget? child;
  final bool enableFloatingRotateButton;

  const ResponsiveOrientationWrapper({
    super.key,
    this.child,
    this.enableFloatingRotateButton = true,
  });

  @override
  Widget build(BuildContext context) {
    final controller = Get.isRegistered<OrientationController>()
        ? Get.find<OrientationController>()
        : Get.put(OrientationController());

    return OrientationBuilder(
      builder: (context, orientation) {
        final isLandscape = orientation == Orientation.landscape;
        controller.updateOrientationFromContext(isLandscape);

        return Stack(
          children: [
            // Responsive Child Wrapper
            Builder(
              builder: (context) {
                if (child == null) return const SizedBox.shrink();

                if (isLandscape) {
                  // Ensure content scrolling in landscape mode to prevent overflows
                  return SafeArea(
                    child: child!,
                  );
                }
                return child!;
              },
            ),

            // Floating Rotate Action Button overlay
            if (enableFloatingRotateButton)
              Positioned(
                bottom: isLandscape ? 10 : 20,
                right: 10,
                child: const SafeArea(
                  child: FloatingRotateButton(),
                ),
              ),
          ],
        );
      },
    );
  }
}
