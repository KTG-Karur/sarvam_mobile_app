import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/view/ADMIN/users/user_list.dart';
import 'package:sarvam/view/ADMIN/roles/role_list.dart';
import 'package:sarvam/view/ADMIN/branches/branch_list.dart';
import 'package:sarvam/view/ADMIN/branches/hub_management_screen.dart';
import 'package:sarvam/view/ADMIN/branches/product_map_screen.dart';
import 'package:sarvam/view/ADMIN/branches/extend_branch_lock_screen.dart';
import 'package:sarvam/view/ADMIN/masters/funder_list.dart';
import 'package:sarvam/view/ADMIN/masters/gl_list.dart';
import 'package:sarvam/view/ADMIN/masters/loan_products_list.dart';
import 'package:sarvam/view/ADMIN/masters/loan_purposes_list.dart';
import 'package:sarvam/view/ADMIN/masters/economic_activities_list.dart';
import 'package:sarvam/view/ADMIN/masters/meeting_places_list.dart';
import 'package:sarvam/view/ADMIN/accounts/accounts_overview.dart';
import 'package:sarvam/view/ADMIN/transactions/transaction_management.dart';
import 'package:sarvam/view/ADMIN/eod/eod_execution.dart';
import 'package:sarvam/view/ADMIN/reports/admin_reports_overview.dart';
import 'package:sarvam/view/ADMIN/settings/profile_settings.dart';
import 'package:sarvam/view/BM/member_approval.dart';
import 'package:sarvam/view/BM/centre_approval.dart';
import 'package:sarvam/view/BM/final_disbursement/final_disbursement.dart';
import 'package:sarvam/view/FDO/client_search_locate/client_search_locate.dart';
import 'package:sarvam/view/BM/collection_batch_revert.dart';

class ModuleDirectoryScreen extends StatefulWidget {
  const ModuleDirectoryScreen({super.key});

  @override
  State<ModuleDirectoryScreen> createState() => _ModuleDirectoryScreenState();
}

class _ModuleDirectoryScreenState extends State<ModuleDirectoryScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _filterQuery = '';

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  final List<Map<String, dynamic>> _modules = [
    {
      'name': 'Dashboard',
      'icon': Icons.dashboard_rounded,
      'color': const Color(0xFF0D6842),
      'count': 'Live',
    },
    {
      'name': 'Hub',
      'icon': Icons.hub_rounded,
      'color': const Color(0xFF0D9488),
      'children': ['Hub Create', 'Product Map', 'Extend Branch Lock'],
    },
    {
      'name': 'Center Operations',
      'icon': Icons.pin_drop_rounded,
      'color': const Color(0xFF1E3A8A),
      'children': [
        'Create Center',
        'Center Approval',
        'Groups',
        'Transfer',
        'Locate Center',
      ],
    },
    {
      'name': 'Client',
      'icon': Icons.people_alt_rounded,
      'color': const Color(0xFF7C3AED),
      'children': [
        'Search & Locate',
        'Member Enrollment',
        'Credit Check',
        'Member Approval',
        'Member Update',
        'Co-Applicant Management',
        'Group Assign',
        'Transfer',
        'Inactive',
        'Re-active',
        'Member Validation',
        'Renewal Loan Application',
        'Client Loan Tracker',
      ],
    },
    {
      'name': 'Loan Module',
      'icon': Icons.credit_card_rounded,
      'color': const Color(0xFFB45309),
      'children': [
        'Loan Indexation',
        'Member Individual',
        'Disbursement',
        'Final Disbursement',
        'Change Funder',
        'Delete Disbursement',
      ],
    },
    {
      'name': 'Collections',
      'icon': Icons.receipt_rounded,
      'color': const Color(0xFF0D6842),
      'children': [
        'Collection Approval',
        'Demand Collection',
        'Arrear Collection',
      ],
    },
    {
      'name': 'Client / Late Collection',
      'icon': Icons.payments_rounded,
      'color': const Color(0xFFDC2626),
      'children': [
        'Single Collection',
        'Bulk Collection',
        'Foreclosure',
        'Loan Advance Refund',
        'Foreclosure Approval',
        'Loan Write-Off / Death Closure',
        'Member Collection Details',
        'Delete Demand Collection',
        'Delete Client Collection',
        'Delete Foreclosure',
      ],
    },
    {
      'name': 'Payroll & Attendance',
      'icon': Icons.schedule_rounded,
      'color': const Color(0xFF0284C7),
      'children': [
        'Leave Type',
        'Leave Balance',
        'Salary',
        'Salary Master',
        'Salary Pay',
        'Payroll',
        'Attendance',
      ],
    },
    {
      'name': 'Daily Monitoring',
      'icon': Icons.bar_chart_rounded,
      'color': const Color(0xFF0D9488),
      'children': [
        'New Zero Collection',
        'Collection Followup',
        'Advance Collection',
        'Inter Branch',
      ],
    },
    {
      'name': 'Masters',
      'icon': Icons.dataset_rounded,
      'color': const Color(0xFF7C3AED),
      'children': [
        'Role Management',
        'Member Approval Workflow',
        'Incentive Configuration',
        'Funder',
        'GL Master',
        'Loan Product Type',
        'Loan Product',
        'Loan Purpose Type',
        'Loan Purpose',
        'Leave Type',
        'Economic Activity Type',
        'Meeting Place',
        'Economic Activity',
        'Questionnaire',
        'Upload',
        'FDO Task Management',
        'Brand Theme',
        'Highmark Settings',
      ],
    },
    {
      'name': 'Gold Loan',
      'icon': Icons.monetization_on_rounded,
      'color': const Color(0xFFD97706),
      'children': ['Gold Return'],
    },
    {
      'name': 'Employees',
      'icon': Icons.badge_rounded,
      'color': const Color(0xFF1E3A8A),
      'children': ['User Management', 'Reset Password'],
    },
    {
      'name': 'Accounts',
      'icon': Icons.account_balance_wallet_rounded,
      'color': const Color(0xFF2563EB),
      'children': ['Accounts Group', 'Accounts Ledger', 'Self Accounts'],
    },
    {
      'name': 'Transactions',
      'icon': Icons.sync_alt_rounded,
      'color': const Color(0xFF059669),
      'children': [
        'Cash Receipt',
        'Cash Payment',
        'Bank Receipt',
        'Bank Payment',
        'Journal',
        'Contra',
        'Modification',
      ],
    },
    {
      'name': 'Reports',
      'icon': Icons.summarize_rounded,
      'color': const Color(0xFF4338CA),
      'children': [
        'Demand',
        'Client',
        'Collection',
        'Portfolio',
        'Account',
        'Employee',
        'Funders',
        'Others',
        'Gold',
      ],
    },
    {
      'name': 'MIS Reports',
      'icon': Icons.insights_rounded,
      'color': const Color(0xFF0D6842),
      'children': [
        'Company Profile',
        'All DCB',
        'Branch Demand',
        'Disbursement',
        'Loan OS Details',
        'Agewise Arrear',
        'Preclosure',
        'Performance',
        'Ledger Report',
      ],
    },
    {
      'name': 'EOD',
      'icon': Icons.event_repeat_rounded,
      'color': const Color(0xFFB45309),
      'children': ['EOD Process'],
    },
    {
      'name': 'Revert',
      'icon': Icons.undo_rounded,
      'color': const Color(0xFFDC2626),
      'children': [
        'Collection Revert',
        'Individual Member Collection Revert',
        'Pre-Closure Revert',
        'Allocation Revert',
        'EOD Revert',
        'Disbursement Revert',
        'Loan Closure Revert',
        'Death Revert',
        'Loan Advance Revert',
      ],
    },
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(
            Icons.arrow_back_ios_new_rounded,
            color: _darkText,
            size: 20,
          ),
          onPressed: () => Get.back(),
        ),
        title: Text(
          '18-Module Navigation Hub',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildSearchBar(),
            Expanded(
              child: ListView.separated(
                padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
                itemCount: _modules.length,
                separatorBuilder: (context, index) => SizedBox(height: 10.h),
                itemBuilder: (context, index) {
                  final mod = _modules[index];
                  final String name = mod['name'];
                  final IconData icon = mod['icon'];
                  final Color color = mod['color'];
                  final List<String> children = List<String>.from(
                    mod['children'] ?? [],
                  );

                  final q = _filterQuery.toLowerCase();
                  if (q.isNotEmpty) {
                    final nameMatches = name.toLowerCase().contains(q);
                    final matchingChildren = children
                        .where((c) => c.toLowerCase().contains(q))
                        .toList();
                    if (!nameMatches && matchingChildren.isEmpty) {
                      return const SizedBox.shrink();
                    }
                  }

                  return _buildModuleCard(name, icon, color, children);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchBar() {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      color: Colors.white,
      child: TextField(
        controller: _searchController,
        onChanged: (val) => setState(() => _filterQuery = val),
        decoration: InputDecoration(
          hintText: 'Search 18 modules & sub-items...',
          hintStyle: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
          prefixIcon: const Icon(Icons.search_rounded, color: _muted),
          filled: true,
          fillColor: _lightBg,
          contentPadding: EdgeInsets.symmetric(vertical: 10.h),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12.r),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  Widget _buildModuleCard(
    String name,
    IconData icon,
    Color color,
    List<String> children,
  ) {
    if (children.isEmpty) {
      return Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14.r),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: ListTile(
          leading: Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: color, size: 20.sp),
          ),
          title: Text(
            name,
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          trailing: const Icon(
            Icons.arrow_forward_ios_rounded,
            color: _muted,
            size: 14,
          ),
          onTap: () => _handleModuleTap(name, null),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          leading: Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              color: color.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(icon, color: color, size: 20.sp),
          ),
          title: Text(
            name,
            style: GoogleFonts.inter(
              fontSize: 14.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
          subtitle: Text(
            '${children.length} Features',
            style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
          ),
          children: children.map((sub) {
            return ListTile(
              contentPadding: EdgeInsets.only(left: 52.w, right: 16.w),
              title: Text(
                sub,
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  color: _darkText,
                  fontWeight: FontWeight.w500,
                ),
              ),
              trailing: Icon(
                Icons.chevron_right_rounded,
                color: color,
                size: 18,
              ),
              onTap: () => _handleModuleTap(name, sub),
            );
          }).toList(),
        ),
      ),
    );
  }

  void _handleModuleTap(String parent, String? subItem) {
    final sub = subItem ?? parent;

    switch (sub) {
      case 'User Management':
        Get.to(() => const UserList());
        break;
      case 'Role Management':
      case 'Role Manager':
        Get.to(() => const RoleList());
        break;
      case 'Branches & Hubs':
      case 'Hub Create':
        Get.to(() => const HubManagementScreen());
        break;
      case 'Product Map':
        Get.to(() => const ProductMapScreen());
        break;
      case 'Extend Branch Lock':
        Get.to(() => const ExtendBranchLockScreen());
        break;
      case 'Create Center':
      case 'Center Approval':
      case 'Groups':
      case 'Transfer':
      case 'Locate Center':
        Get.to(() => const CentreApproval());
        break;
      case 'Search & Locate':
      case 'Client Search':
        Get.to(() => const ClientSearchLocate());
        break;
      case 'Member Approval':
      case 'Member Validation':
      case 'Member Approval Workflow':
        Get.to(() => const MemberApproval());
        break;
      case 'Loan Indexation':
      case 'Loan Product':
      case 'Loan Product Type':
        Get.to(() => const LoanProductsList());
        break;
      case 'Disbursement':
      case 'Final Disbursement':
        Get.to(() => const FinalDisbursement());
        break;
      case 'Loan Purpose':
      case 'Loan Purpose Type':
        Get.to(() => const LoanPurposesList());
        break;
      case 'Economic Activity':
      case 'Economic Activity Type':
        Get.to(() => const EconomicActivitiesList());
        break;
      case 'Meeting Place':
        Get.to(() => const MeetingPlacesList());
        break;
      case 'Funder':
        Get.to(() => const FunderList());
        break;
      case 'GL Master':
      case 'Accounts Ledger':
      case 'Self Accounts':
      case 'Accounts Group':
        Get.to(() => const AccountsOverview());
        break;
      case 'Cash Receipt':
      case 'Cash Payment':
      case 'Bank Receipt':
      case 'Bank Payment':
      case 'Journal':
      case 'Contra':
      case 'Modification':
        Get.to(() => const TransactionManagement());
        break;
      case 'EOD Process':
      case 'EOD':
        Get.to(() => const EodExecution());
        break;
      case 'Collection Revert':
      case 'Individual Member Collection Revert':
      case 'Pre-Closure Revert':
      case 'Allocation Revert':
      case 'EOD Revert':
      case 'Disbursement Revert':
      case 'Loan Closure Revert':
      case 'Death Revert':
      case 'Loan Advance Revert':
        Get.to(() => const CollectionBatchRevert(collectionBatchId: ''));
        break;
      case 'Profile & Settings':
        Get.to(() => const ProfileSettings());
        break;
      default:
        Get.to(() => const AdminReportsOverview());
        break;
    }
  }
}
