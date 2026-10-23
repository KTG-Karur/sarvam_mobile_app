import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:get/get.dart';

Future<void> makePhoneCall(String phoneNumber) async {
  if (phoneNumber.isEmpty || phoneNumber == '-') return;
  
  // Clean phone number (keep only digits and +)
  final cleanNumber = phoneNumber.replaceAll(RegExp(r'[^\d+]'), '');
  
  final Uri launchUri = Uri(
    scheme: 'tel',
    path: cleanNumber,
  );
  try {
    if (await canLaunchUrl(launchUri)) {
      await launchUrl(launchUri);
    } else {
      Get.snackbar(
        'Error',
        'Could not open dialer for $phoneNumber',
        snackPosition: SnackPosition.BOTTOM,
      );
    }
  } catch (e) {
    Get.snackbar(
      'Error',
      'Failed to launch phone dialer',
      snackPosition: SnackPosition.BOTTOM,
    );
  }
}

class CallButton extends StatelessWidget {
  final String phoneNumber;
  final Color color;
  final double? size;
  final EdgeInsets? padding;

  const CallButton({
    super.key,
    required this.phoneNumber,
    this.color = const Color(0xFF008A3D),
    this.size,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    if (phoneNumber.isEmpty || phoneNumber == '-') return const SizedBox.shrink();
    return InkWell(
      onTap: () => makePhoneCall(phoneNumber),
      borderRadius: BorderRadius.circular(100),
      child: Container(
        padding: padding ?? EdgeInsets.all(6.w),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(
          Icons.call,
          size: size ?? 18.sp,
          color: color,
        ),
      ),
    );
  }
}
