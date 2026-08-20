import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/view/AM/disbursement_approval/disbursement_approval.dart';
import 'package:sarvam/view/FDO/client_loan_tracker/client_loan_tracker.dart';
import 'package:sarvam/view/FDO/loan_disbursement/my_file.dart';

class LoanDisbursement extends StatelessWidget {
  const LoanDisbursement({
    super.key,
    this.isBranchManager = false,
    this.isAreaManager = false,
  });

  final bool isBranchManager;

  final bool isAreaManager;

  @override
  Widget build(BuildContext context) => Theme(
    data: Theme.of(context).copyWith(
      textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
    ),
    child: Scaffold(
      backgroundColor: const Color(0xFFF7FBF8),
      appBar: AppBar(
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: Colors.white,
        leading: IconButton(
          onPressed: () => Navigator.maybePop(context),
          icon: const Icon(Icons.arrow_back, color: Color(0xFF0D6842)),
        ),
        title: Text(
          'Loan Disbursement',
          style: TextStyle(
            fontSize: 19.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF10472A),
          ),
        ),
      ),
      body: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.all(16.w),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Choose a disbursement process',
                style: TextStyle(
                  fontSize: 15.sp,
                  fontWeight: FontWeight.w800,
                  color: const Color(0xFF172033),
                ),
              ),
              SizedBox(height: 4.h),
              Text(
                'Create and manage loan disbursement files.',
                style: TextStyle(
                  fontSize: 11.sp,
                  color: const Color(0xFF64748B),
                ),
              ),
              SizedBox(height: 22.h),
              _actionCard(
                context,
                title: 'Business types',
                subtitle: 'Create a new individual loan disbursement file',
                imagePath: 'assets/images/new_file.png',
                background: const Color(0xFFE5F6EC),
                onTap: () => Navigator.of(
                  context,
                ).push(MaterialPageRoute(builder: (_) => const MyFile())),
              ),
              SizedBox(height: 13.h),
              _actionCard(
                context,
                title: 'Business File',
                subtitle: 'Track client loan approval status',
                imagePath: 'assets/images/business_file.png',
                background: const Color(0xFFFFF3D6),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const ClientLoanTracker()),
                ),
              ),
              if (isAreaManager) ...[
                SizedBox(height: 13.h),
                _actionCard(
                  context,
                  title: 'Disbursement Approval',
                  subtitle: 'Approve indexed loans for the BM to disburse',
                  icon: Icons.verified_rounded,
                  background: const Color(0xFFE5F6EC),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const DisbursementApproval(),
                    ),
                  ),
                ),
              ],
              SizedBox(height: 13.h),

              const Spacer(),
              Container(
                width: double.infinity,
                padding: EdgeInsets.all(14.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFEAF6EF),
                  borderRadius: BorderRadius.circular(12.r),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline,
                      color: const Color(0xFF008A3D),
                      size: 20.sp,
                    ),
                    SizedBox(width: 9.w),
                    Expanded(
                      child: Text(
                        'Complete member verification before loan disbursement.',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF35694B),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _actionCard(
    BuildContext context, {
    required String title,
    required String subtitle,
    String? imagePath,
    IconData? icon,
    required Color background,
    VoidCallback? onTap,
  }) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(14.r),
    child: InkWell(
      onTap:
          onTap ??
          () => ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text('$title selected'))),
      borderRadius: BorderRadius.circular(14.r),
      child: Container(
        padding: EdgeInsets.all(15.w),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE1EAE4)),
          borderRadius: BorderRadius.circular(14.r),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(6.w),
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(12.r),
              ),
              child: imagePath != null
                  ? Image.asset(
                      imagePath,
                      width: 60.w,
                      height: 60.w,
                      fit: BoxFit.contain,
                    )
                  : Icon(icon, size: 40.sp, color: const Color(0xFF0D6842)),
            ),
            SizedBox(width: 13.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 18.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF172033),
                    ),
                  ),
                  SizedBox(height: 3.h),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              color: const Color(0xFF94A3B8),
              size: 25.sp,
            ),
          ],
        ),
      ),
    ),
  );
}
