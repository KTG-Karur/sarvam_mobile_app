import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

class MafShort extends StatefulWidget {
  final String clientName;
  final String aadhaarNo;
  final String mobileNo;

  const MafShort({
    super.key,
    this.clientName = 'MARIMUTHU B',
    this.aadhaarNo = '987654321012',
    this.mobileNo = '9876543210',
  });

  @override
  State<MafShort> createState() => _MafShortState();
}

class _MafShortState extends State<MafShort> {
  static const _primaryGreen = Color(0xFF00843D);
  static const _darkGreen = Color(0xFF075E2E);
  static const _headerGreen = Color(0xFF10472A);
  static const _bgLight = Color(0xFFF8FAFC);
  static const _bannerBg = Color(0xFFF0FDF4);
  static const _goldColor = Color(0xFFD97706);

  late TextEditingController _nameController;
  late TextEditingController _aadhaarController;
  late TextEditingController _mobileController;

  bool _hasConsent = false;
  bool _isRunningCheck = false;
  bool _creditCheckCompleted = false;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.clientName);
    _aadhaarController = TextEditingController(text: widget.aadhaarNo);
    _mobileController = TextEditingController(text: widget.mobileNo);
  }

  @override
  void dispose() {
    _nameController.dispose();
    _aadhaarController.dispose();
    _mobileController.dispose();
    super.dispose();
  }

  void _runCreditCheck() async {
    if (_nameController.text.trim().isEmpty ||
        _aadhaarController.text.trim().isEmpty ||
        _mobileController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Please enter Name, Aadhaar, and Mobile Number.'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
        ),
      );
      return;
    }

    if (!_hasConsent) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text(
            'Please check the explicit consent box before running credit check.',
          ),
          backgroundColor: Colors.amber.shade900,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
        ),
      );
      return;
    }

    setState(() => _isRunningCheck = true);
    await Future.delayed(const Duration(seconds: 2));

    if (mounted) {
      setState(() {
        _isRunningCheck = false;
        _creditCheckCompleted = true;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 8.w),
              Expanded(
                child: Text(
                  'Credit Check Completed for ${_nameController.text}! Score: 742 (Eligible)',
                ),
              ),
            ],
          ),
          backgroundColor: _primaryGreen,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: _bgLight,
        appBar: AppBar(
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(
              Icons.arrow_back_ios_new_rounded,
              color: _darkGreen,
              size: 20,
            ),
          ),
          title: Text(
            'MAF Short Application',
            style: TextStyle(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _headerGreen,
            ),
          ),
          actions: [
            TextButton.icon(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('MAF Short Application Draft Saved!'),
                  ),
                );
              },
              icon: Icon(
                Icons.save_as_outlined,
                color: _goldColor,
                size: 18.sp,
              ),
              label: Text(
                'Save Draft',
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.w600,
                  color: _goldColor,
                ),
              ),
            ),
            SizedBox(width: 8.w),
          ],
        ),
        body: Column(
          children: [
            // Main Content Area
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(16.w),
                child: Column(
                  children: [
                    _buildCreditCheckCard(),
                  ],
                ),
              ),
            ),

            // Bottom Navigation Bar
            _buildBottomNavigationBar(),
          ],
        ),
      ),
    );
  }

  // Credit Check Card with Editable Input Fields for Name, Aadhaar & Mobile
  Widget _buildCreditCheckCard() {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: const Color(0xFFDCFCE7)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top Header Banner inside Card
          Container(
            padding: EdgeInsets.all(16.w),
            decoration: BoxDecoration(
              color: _bannerBg,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(12.r),
                topRight: Radius.circular(12.r),
              ),
              border: const Border(
                bottom: BorderSide(color: Color(0xFFDCFCE7)),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      Icons.verified_outlined,
                      color: _primaryGreen,
                      size: 20.sp,
                    ),
                    SizedBox(width: 8.w),
                    Text(
                      'Credit Check',
                      style: TextStyle(
                        fontSize: 16.sp,
                        fontWeight: FontWeight.w700,
                        color: _headerGreen,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 6.h),
                Text(
                  'Optional CRIF bureau check for this client — reuses a recent report for the same Aadhaar automatically. Not required to save the enrollment.',
                  style: TextStyle(
                    fontSize: 12.sp,
                    color: const Color(0xFF475569),
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),

          // Details Body with Editable Form Fields (Name, Aadhaar, Mobile)
          Padding(
            padding: EdgeInsets.all(18.w),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Editable Text Form Fields Row / Column
                _buildInputField(
                  label: 'Name *',
                  controller: _nameController,
                  hint: 'Enter Client Full Name',
                  icon: Icons.person_outline_rounded,
                  keyboardType: TextInputType.name,
                ),
                SizedBox(height: 14.h),

                Row(
                  children: [
                    Expanded(
                      child: _buildInputField(
                        label: 'Aadhaar *',
                        controller: _aadhaarController,
                        hint: 'Enter 12-digit Aadhaar',
                        icon: Icons.badge_outlined,
                        keyboardType: TextInputType.number,
                        maxLength: 12,
                      ),
                    ),
                    SizedBox(width: 12.w),
                    Expanded(
                      child: _buildInputField(
                        label: 'Mobile *',
                        controller: _mobileController,
                        hint: 'Enter 10-digit Mobile',
                        icon: Icons.phone_outlined,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 16.h),

                // Consent Checkbox Row
                InkWell(
                  onTap: () => setState(() => _hasConsent = !_hasConsent),
                  borderRadius: BorderRadius.circular(6.r),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(
                        width: 20.w,
                        height: 20.w,
                        child: Checkbox(
                          value: _hasConsent,
                          onChanged: (val) =>
                              setState(() => _hasConsent = val ?? false),
                          activeColor: _primaryGreen,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(4.r),
                          ),
                        ),
                      ),
                      SizedBox(width: 10.w),
                      Expanded(
                        child: Text(
                          'The client has given explicit consent for a Highmark check to be run on their behalf.',
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            fontWeight: FontWeight.w500,
                            color: const Color(0xFF1E293B),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 20.h),

                // Run Credit Check Button
                ElevatedButton.icon(
                  onPressed: _isRunningCheck ? null : _runCreditCheck,
                  icon: _isRunningCheck
                      ? SizedBox(
                          width: 16.w,
                          height: 16.w,
                          child: const CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : Icon(
                          _creditCheckCompleted
                              ? Icons.check_circle_rounded
                              : Icons.verified_outlined,
                          size: 18.sp,
                        ),
                  label: Text(
                    _isRunningCheck
                        ? 'Running Credit Check...'
                        : (_creditCheckCompleted
                              ? 'Credit Check Passed'
                              : 'Run Credit Check'),
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _creditCheckCompleted
                        ? _darkGreen
                        : const Color(0xFF86EFAC),
                    foregroundColor: _creditCheckCompleted
                        ? Colors.white
                        : const Color(0xFF064E3B),
                    padding: EdgeInsets.symmetric(
                      horizontal: 18.w,
                      vertical: 12.h,
                    ),
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                  ),
                ),

                // Bureau Report Results Box (If completed)
                if (_creditCheckCompleted) ...[
                  SizedBox(height: 16.h),
                  Container(
                    padding: EdgeInsets.all(12.w),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF0FDF4),
                      borderRadius: BorderRadius.circular(8.r),
                      border: Border.all(color: const Color(0xFFBBF7D0)),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.stars_rounded,
                          color: _primaryGreen,
                          size: 24.sp,
                        ),
                        SizedBox(width: 10.w),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'CRIF Bureau Score: 742 / 900',
                                style: TextStyle(
                                  fontSize: 13.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkGreen,
                                ),
                              ),
                              Text(
                                'Status: LOW RISK • 0 Overdue Accounts for ${_nameController.text}',
                                style: TextStyle(
                                  fontSize: 11.sp,
                                  color: const Color(0xFF166534),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Input Field Helper Widget
  Widget _buildInputField({
    required String label,
    required TextEditingController controller,
    required String hint,
    required IconData icon,
    TextInputType keyboardType = TextInputType.text,
    int? maxLength,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF475569),
          ),
        ),
        SizedBox(height: 5.h),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          maxLength: maxLength,
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF0F172A),
          ),
          decoration: InputDecoration(
            counterText: '',
            hintText: hint,
            hintStyle: TextStyle(
              fontSize: 12.sp,
              color: const Color(0xFF94A3B8),
            ),
            contentPadding: EdgeInsets.symmetric(
              horizontal: 12.w,
              vertical: 10.h,
            ),
            filled: true,
            fillColor: Colors.white,
            prefixIcon: Icon(icon, color: _primaryGreen, size: 18.sp),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8.r),
              borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8.r),
              borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8.r),
              borderSide: const BorderSide(color: _primaryGreen, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }

  // Bottom Navigation Bar
  Widget _buildBottomNavigationBar() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
      decoration: BoxDecoration(
        color: const Color(0xFFF0FDF4),
        border: const Border(top: BorderSide(color: Color(0xFFDCFCE7))),
      ),
      child: Row(
        children: [
          // Previous Button
          OutlinedButton.icon(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(Icons.chevron_left_rounded, size: 16),
            label: Text(
              'Back',
              style: TextStyle(
                fontSize: 12.sp,
                fontWeight: FontWeight.w700,
                color: _darkGreen,
              ),
            ),
            style: OutlinedButton.styleFrom(
              side: const BorderSide(color: Color(0xFF86EFAC)),
              padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8.r),
              ),
            ),
          ),

          SizedBox(width: 8.w),

          // Action Buttons wrapped cleanly in Flexible SingleChildScrollView
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              reverse: true,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Cancel Button
                  OutlinedButton(
                    onPressed: () => Navigator.maybePop(context),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFCBD5E1)),
                      padding: EdgeInsets.symmetric(
                        horizontal: 10.w,
                        vertical: 8.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                    child: Text(
                      'Cancel',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF475569),
                      ),
                    ),
                  ),
                  SizedBox(width: 6.w),

                  // Save Draft Button
                  OutlinedButton.icon(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('MAF Short Application Draft Saved!'),
                        ),
                      );
                    },
                    icon: Icon(
                      Icons.save_as_outlined,
                      color: _goldColor,
                      size: 15.sp,
                    ),
                    label: Text(
                      'Save Draft',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.w700,
                        color: _goldColor,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFFFDE68A)),
                      backgroundColor: const Color(0xFFFEF3C7),
                      padding: EdgeInsets.symmetric(
                        horizontal: 10.w,
                        vertical: 8.h,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                  ),
                  SizedBox(width: 6.w),

                  // Submit Button
                  ElevatedButton(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('MAF Short Application Submitted!'),
                        ),
                      );
                      Navigator.maybePop(context);
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _primaryGreen,
                      padding: EdgeInsets.symmetric(
                        horizontal: 12.w,
                        vertical: 8.h,
                      ),
                      elevation: 1,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8.r),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'Submit',
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        SizedBox(width: 2.w),
                        const Icon(
                          Icons.chevron_right_rounded,
                          color: Colors.white,
                          size: 16,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
