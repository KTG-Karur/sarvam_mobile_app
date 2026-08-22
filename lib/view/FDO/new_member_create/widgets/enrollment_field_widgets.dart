import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:intl/intl.dart';

/// Shared visual language for the Member Enrollment wizard — extracted from
/// the original static mockup so every tab renders fields identically.
const enrollmentGreen = Color(0xFF00843D);
const enrollmentDarkText = Color(0xFF073E23);
const enrollmentBorderColor = Color(0xFFB9E1C7);
const enrollmentFieldFill = Color(0xFFF9FFFB);
const enrollmentHintColor = Color(0xFF71A488);
const enrollmentLabelColor = Color(0xFF075E2E);
const enrollmentHelperColor = Color(0xFF4E8A68);

InputDecoration enrollmentDecoration(
  String hint, {
  IconData? icon,
  Widget? suffixIcon,
}) => InputDecoration(
  hintText: hint,
  hintStyle: TextStyle(fontSize: 12.sp, color: enrollmentHintColor),
  prefixIcon: icon == null
      ? null
      : Icon(icon, color: enrollmentGreen, size: 19.sp),
  suffixIcon: suffixIcon,
  filled: true,
  fillColor: enrollmentFieldFill,
  contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 13.h),
  border: _enrollmentBorder,
  enabledBorder: _enrollmentBorder,
  disabledBorder: _enrollmentBorder,
  focusedBorder: _enrollmentBorder.copyWith(
    borderSide: BorderSide(color: enrollmentGreen, width: 1.5),
  ),
);

OutlineInputBorder get _enrollmentBorder => OutlineInputBorder(
  borderRadius: BorderRadius.circular(8.r),
  borderSide: BorderSide(color: enrollmentBorderColor),
);

Widget enrollmentLabel(String label, {bool required = false, String? helper}) =>
    Text.rich(
      TextSpan(
        children: [
          TextSpan(text: label),
          if (helper != null)
            TextSpan(
              text: '  $helper',
              style: TextStyle(fontSize: 10.sp, color: enrollmentHelperColor),
            )
          else if (!required)
            TextSpan(
              text: '  (Optional)',
              style: TextStyle(fontSize: 10.sp, color: enrollmentHelperColor),
            ),
          if (required)
            const TextSpan(
              text: ' *',
              style: TextStyle(color: Color(0xFFE11D48)),
            ),
        ],
      ),
      style: TextStyle(
        fontSize: 12.sp,
        fontWeight: FontWeight.w600,
        color: enrollmentLabelColor,
      ),
    );

/// A card-shell wrapper (title/icon header + padded body) matching the
/// original mockup's per-tab card styling.
class EnrollmentSectionShell extends StatelessWidget {
  const EnrollmentSectionShell({
    super.key,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.children,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Container(
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: const Color(0xFFBFE5CC)),
      borderRadius: BorderRadius.circular(12.r),
      boxShadow: const [
        BoxShadow(
          color: Color(0x11085430),
          blurRadius: 12,
          offset: Offset(0, 4),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: EdgeInsets.all(16.w),
          decoration: BoxDecoration(
            color: const Color(0xFFF0FAF4),
            borderRadius: BorderRadius.vertical(top: Radius.circular(12.r)),
            border: const Border(bottom: BorderSide(color: Color(0xFFBFE5CC))),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, size: 18.sp, color: enrollmentGreen),
                  SizedBox(width: 8.w),
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF064524),
                    ),
                  ),
                ],
              ),
              SizedBox(height: 5.h),
              Text(
                subtitle,
                style: TextStyle(
                  fontSize: 10.5.sp,
                  color: const Color(0xFF3D7658),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: EdgeInsets.all(16.w),
          child: Column(children: children),
        ),
      ],
    ),
  );
}

/// A labeled text field bound directly to a [TextEditingController].
class EnrollmentTextField extends StatelessWidget {
  const EnrollmentTextField({
    super.key,
    required this.label,
    required this.hint,
    required this.controller,
    this.required = false,
    this.helper,
    this.icon,
    this.keyboardType,
    this.maxLength,
    this.readOnly = false,
    this.obscureText = false,
    this.focusNode,
    this.onChanged,
    this.enableCopyPaste = true,
    this.inputFormatters,
    this.errorText,
    this.suffixIcon,
  });

  final String label;
  final String hint;
  final TextEditingController controller;
  final bool required;
  final String? helper;
  final IconData? icon;
  final TextInputType? keyboardType;
  final int? maxLength;
  final bool readOnly;
  final bool obscureText;
  final FocusNode? focusNode;
  final ValueChanged<String>? onChanged;
  final bool enableCopyPaste;
  final List<TextInputFormatter>? inputFormatters;
  final String? errorText;
  final Widget? suffixIcon;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        enrollmentLabel(label, required: required, helper: helper),
        SizedBox(height: 6.h),
        TextFormField(
          controller: controller,
          focusNode: focusNode,
          keyboardType: keyboardType,
          maxLength: maxLength,
          inputFormatters: inputFormatters,
          readOnly: readOnly,
          obscureText: obscureText,
          onChanged: onChanged,
          enableInteractiveSelection: enableCopyPaste,
          contextMenuBuilder: enableCopyPaste
              ? null
              : (context, state) => const SizedBox.shrink(),
          style: TextStyle(fontSize: 13.sp, color: enrollmentDarkText),
          decoration: enrollmentDecoration(
            hint,
            icon: icon,
            suffixIcon: suffixIcon,
          ).copyWith(counterText: '', errorText: errorText),
        ),
      ],
    ),
  );
}

/// A read-only date-picker field (`dd-MM-yyyy` display format).
class EnrollmentDateField extends StatelessWidget {
  const EnrollmentDateField({
    super.key,
    required this.label,
    required this.controller,
    this.required = false,
    this.firstDate,
    this.lastDate,
  });

  final String label;
  final TextEditingController controller;
  final bool required;
  final DateTime? firstDate;
  final DateTime? lastDate;

  Future<void> _pick(BuildContext context) async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime(1995),
      firstDate: firstDate ?? DateTime(1920),
      lastDate: lastDate ?? DateTime.now(),
    );
    if (date != null) {
      controller.text = DateFormat('dd-MM-yyyy').format(date);
    }
  }

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        enrollmentLabel(label, required: required),
        SizedBox(height: 6.h),
        TextFormField(
          controller: controller,
          readOnly: true,
          onTap: () => _pick(context),
          style: TextStyle(fontSize: 13.sp, color: enrollmentDarkText),
          decoration:
              enrollmentDecoration(
                'dd-mm-yyyy',
                icon: Icons.calendar_month_outlined,
              ).copyWith(
                suffixIcon: Icon(
                  Icons.calendar_today_outlined,
                  size: 18.sp,
                  color: const Color(0xFF145D35),
                ),
              ),
        ),
      ],
    ),
  );
}

/// A labeled dropdown bound to a simple `List<String>` of options.
class EnrollmentSelectField extends StatelessWidget {
  const EnrollmentSelectField({
    super.key,
    required this.label,
    required this.value,
    required this.options,
    required this.onChanged,
    this.required = false,
    this.helper,
    this.enabled = true,
    this.labelBuilder,
  });

  final String label;
  final String? value;
  final List<String> options;
  final ValueChanged<String?> onChanged;
  final bool required;
  final String? helper;
  final bool enabled;
  final String Function(String)? labelBuilder;

  @override
  Widget build(BuildContext context) => Padding(
    padding: EdgeInsets.only(bottom: 13.h),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        enrollmentLabel(label, required: required, helper: helper),
        SizedBox(height: 6.h),
        DropdownButtonFormField<String>(
          key: ValueKey('${label}_${value}_${options.length}'),
          initialValue: options.contains(value) ? value : null,
          hint: Text(
            '-- SELECT --',
            style: TextStyle(fontSize: 12.sp, color: enrollmentHintColor),
          ),
          isExpanded: true,
          decoration: enrollmentDecoration(''),
          // Defensive de-dup: DropdownButtonFormField requires every item's
          // `value` to be unique, but option lists here can (legitimately)
          // contain repeats — e.g. two different-ID centers sharing a name.
          items: {for (final o in options) o: o}.keys
              .map(
                (o) => DropdownMenuItem(
                  value: o,
                  child: Text(
                    labelBuilder != null ? labelBuilder!(o) : o,
                    style: TextStyle(fontSize: 13.sp),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              )
              .toList(),
          onChanged: enabled ? onChanged : null,
        ),
      ],
    ),
  );
}

/// The `id` strings for an API-fetched lookup list (`[{id, name, ...}]`) —
/// use these, never display names, as an [EnrollmentSelectField]'s
/// `value`/`options`, since names aren't guaranteed unique (e.g. two
/// different centers can share a name) but ids always are.
List<String> enrollmentIdOptions(List<dynamic> items) => items
    .whereType<Map>()
    .map((e) => e['id']?.toString())
    .whereType<String>()
    .toList();

/// Builds a `labelBuilder` that maps an id (from [enrollmentIdOptions]) back
/// to its display name for the given lookup list.
String Function(String) enrollmentIdLabelBuilder(List<dynamic> items) {
  return (id) {
    Map? match;
    for (final e in items) {
      if (e is Map && e['id']?.toString() == id) {
        match = e;
        break;
      }
    }
    if (match == null) return id;
    return (match['name'] ?? match['productName'] ?? id).toString();
  };
}
