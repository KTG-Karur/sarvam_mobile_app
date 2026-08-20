import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/view/BM/centre_approval.dart';
import 'package:sarvam/view/BM/group_assignment/group_assignment.dart';
import 'package:sarvam/view/BM/member_approval.dart';
import 'package:sarvam/view/BM/loan_index_approval/loan_index_approval.dart';
import 'package:sarvam/view/BM/member_individual/member_individual.dart';
import 'package:sarvam/view/BM/final_disbursement/final_disbursement.dart';
import 'package:sarvam/view/FDO/loan_disbursement/center_list.dart';
import 'package:sarvam/view/FDO/new_member_create/new_member_create.dart';
import 'package:sarvam/view/FDO/renewal_loan/renewal_loan.dart';

// Same raw-role / human-readable-role tokens used by role_home_router.dart's
// resolveHomeScreen() — kept in sync manually since that list is private to
// its own file.
const List<String> _branchManagerRoleTokens = [
  'BM',
  'BRANCH MANAGER',
  'BRANCH_MANAGER',
];
// area manager tokens intentionally omitted here — centre approval is BM-only

class MyFile extends StatefulWidget {
  const MyFile({super.key});

  @override
  State<MyFile> createState() => _MyFileState();
}

class _MyFileState extends State<MyFile> {
  bool _isBranchManager = false;
  bool _isAreaManager = false;

  @override
  void initState() {
    super.initState();
    _loadRole();
  }

  Future<void> _loadRole() async {
    final prefs = await SharedPreferences.getInstance();
    final role = (prefs.getString('role') ?? '').trim().toUpperCase();
    final rbacRoleName = (prefs.getString('rbacRoleName') ?? '')
        .trim()
        .toUpperCase();
    final isBranchManager =
        _branchManagerRoleTokens.contains(role) ||
        _branchManagerRoleTokens.contains(rbacRoleName);
    // Detect area manager tokens (allow 'AM' or 'AREA') so Area Managers
    // can see Member Approval.
    final isAreaManager =
        role.contains('AM') ||
        rbacRoleName.contains('AM') ||
        role.contains('AREA') ||
        rbacRoleName.contains('AREA');
    // Managers include branch or area managers for menu purposes.
    if (mounted) {
      setState(() {
        _isBranchManager = isBranchManager;
        _isAreaManager = isAreaManager;
      });
    }
  }

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
          'My File',
          style: TextStyle(
            fontSize: 19.sp,
            fontWeight: FontWeight.w800,
            color: const Color(0xFF10472A),
          ),
        ),
      ),
      body: Padding(
        padding: EdgeInsets.all(16.w),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(height: 10.h),
            if (_isBranchManager) ...[
              // Branch managers see centre approval and BM-only workflows
              _menuItem(
                context,
                'Centre Approval',
                'Review and approve pending centres',
                'assets/images/new_file.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 8.h),
              _menuItem(
                context,
                'Center & Group Assignment',
                'Assign or reassign clients to centers and groups',
                'assets/images/new_centre.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 8.h),
              _menuItem(
                context,
                'Member Approval',
                'Review member enrollments and co-applicant approvals',
                'assets/images/new_member_create.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 8.h),

              _menuItem(
                context,
                'Loan Index Approval',
                'Review member enrollments and co-applicant approvals',
                'assets/images/loan_index_approval.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 8.h),

              _menuItem(
                context,
                'Member Individual',
                'Cash flow, appraisal & house visit before AM approval',
                'assets/images/member_individual.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 8.h),

              _menuItem(
                context,
                'Final Disbursement',
                'Disburse AM-approved loans with attendance entry',
                'assets/images/final_disbursement.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
            ] else if (_isAreaManager) ...[
              // Area managers should be able to access member approvals
              _menuItem(
                context,
                'Member Approval',
                'Review member enrollments and co-applicant approvals',
                'assets/images/new_member_create.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
            ] else ...[
              _menuItem(
                context,
                'New Centre',
                'Create a center and begin a new loan file',
                'assets/images/new_centre.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 12.h),
              _menuItem(
                context,
                'Member Enrollment',
                'Enroll a new member into a center',
                'assets/images/new_member_create.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
              SizedBox(height: 12.h),
              _menuItem(
                context,
                'Renewal Loan',
                'Start a renewal loan application',
                'assets/images/renewal_loan.png',
                const Color(0xFF008A3D),
                const Color(0xFFE5F6EC),
              ),
            ],
          ],
        ),
      ),
    ),
  );

  Widget _menuItem(
    BuildContext context,
    String title,
    String subtitle,
    String imagePath,
    Color color,
    Color background,
  ) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(16.r),
    child: InkWell(
      onTap: () {
        if (title == 'Centre Approval') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const CentreApproval()));
          return;
        }
        if (title == 'Center & Group Assignment') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const GroupAssignment()));
          return;
        }
        if (title == 'Member Approval') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const MemberApproval()));
          return;
        }
        if (title == 'Loan Index Approval') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const LoanIndexApproval()));
          return;
        }
        if (title == 'Member Individual') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const MemberIndividual()));
          return;
        }
        if (title == 'Final Disbursement') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const FinalDisbursement()));
          return;
        }
        if (title == 'New Centre') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const CenterList()));
          return;
        }
        if (title == 'Member Enrollment') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const NewMemberCreate()));
          return;
        }
        if (title == 'Renewal Loan') {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const RenewalLoan()));
          return;
        }
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$title selected')));
      },
      borderRadius: BorderRadius.circular(16.r),
      child: Container(
        width: double.infinity,
        padding: EdgeInsets.all(16.w),
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFE1EAE4)),
          borderRadius: BorderRadius.circular(16.r),
        ),
        child: Row(
          children: [
            Container(
              width: 64.w,
              height: 64.w,
              padding: EdgeInsets.all(14.w),
              decoration: BoxDecoration(
                color: background,
                borderRadius: BorderRadius.circular(18.r),
              ),
              child: Image.asset(imagePath, fit: BoxFit.contain),
            ),
            SizedBox(width: 14.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 16.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF172033),
                    ),
                  ),
                  SizedBox(height: 6.h),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 11.sp,
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
