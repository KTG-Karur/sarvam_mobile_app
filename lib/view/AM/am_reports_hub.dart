import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/view/ADMIN/admin_home.dart';

class AmReportsHub extends StatelessWidget {
  const AmReportsHub({super.key});

  static const _green = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0.5,
        iconTheme: const IconThemeData(color: _darkText),
        title: Text(
          'Area Manager Reports',
          style: GoogleFonts.inter(
            color: _darkText,
            fontWeight: FontWeight.w700,
            fontSize: 17.sp,
          ),
        ),
      ),
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.all(16.w),
          children: [
            _buildCategorySection(
              context,
              title: 'COLLECTION & DEMAND REPORTS',
              items: [
                _ReportCardItem(
                  icon: Icons.analytics_rounded,
                  title: 'Demand Sheet / MCR / DCR',
                  subtitle: 'Daily & monthly collection demand breakdowns',
                  routeKey: 'demand_sheet',
                ),
                _ReportCardItem(
                  icon: Icons.account_balance_wallet_rounded,
                  title: 'DCB & Collection Summary',
                  subtitle: 'Demand, collection & balance comparison',
                  routeKey: 'dcb_summary',
                ),
              ],
            ),
            _buildCategorySection(
              context,
              title: 'PORTFOLIO & RISK REPORTS',
              items: [
                _ReportCardItem(
                  icon: Icons.location_city_rounded,
                  title: 'OS Branchwise & Centerwise',
                  subtitle: 'Principal & interest outstanding across branches',
                  routeKey: 'os_branchwise',
                ),
                _ReportCardItem(
                  icon: Icons.warning_amber_rounded,
                  title: 'PAR & Agewise Arrears',
                  subtitle: 'Portfolio at Risk & overdue aging analysis',
                  routeKey: 'par_report',
                ),
              ],
            ),
            _buildCategorySection(
              context,
              title: 'CLIENT & DISBURSEMENT REPORTS',
              items: [
                _ReportCardItem(
                  icon: Icons.person_search_rounded,
                  title: 'Application Form & Member Profile',
                  subtitle: 'Client enrollment & status records',
                  routeKey: 'member_profile',
                ),
                _ReportCardItem(
                  icon: Icons.trending_up_rounded,
                  title: 'Loan Disbursement & Closed Loans',
                  subtitle: 'Disbursement audit & closed loan history',
                  routeKey: 'loan_disbursement',
                ),
              ],
            ),
            _buildCategorySection(
              context,
              title: 'EMPLOYEE & OPERATIONAL REPORTS',
              items: [
                _ReportCardItem(
                  icon: Icons.people_outline_rounded,
                  title: 'Attendance & Incentive Reports',
                  subtitle: 'FDO attendance summary & incentive calculations',
                  routeKey: 'employee_attendance',
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCategorySection(
    BuildContext context, {
    required String title,
    required List<_ReportCardItem> items,
  }) {
    return Padding(
      padding: EdgeInsets.only(bottom: 18.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: GoogleFonts.inter(
              fontSize: 10.sp,
              fontWeight: FontWeight.w800,
              color: _green,
              letterSpacing: 1.1,
            ),
          ),
          SizedBox(height: 8.h),
          ...items.map((item) => _buildCard(context, item)),
        ],
      ),
    );
  }

  Widget _buildCard(BuildContext context, _ReportCardItem item) {
    return Padding(
      padding: EdgeInsets.only(bottom: 10.h),
      child: Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        child: InkWell(
          onTap: () {
            // Opens the standardized report reader view in admin_home
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => Scaffold(
                  appBar: AppBar(
                    title: Text(item.title, style: GoogleFonts.inter(fontWeight: FontWeight.w700, fontSize: 16.sp, color: _darkText)),
                    backgroundColor: Colors.white,
                    elevation: 0.5,
                    iconTheme: const IconThemeData(color: _darkText),
                  ),
                  body: const AdminHome(),
                ),
              ),
            );
          },
          borderRadius: BorderRadius.circular(14.r),
          child: Container(
            padding: EdgeInsets.all(14.w),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFE8F0EB)),
              borderRadius: BorderRadius.circular(14.r),
            ),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(10.w),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE4F5EB),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Icon(item.icon, color: _green, size: 22.sp),
                ),
                SizedBox(width: 14.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.title,
                        style: GoogleFonts.inter(
                          fontSize: 14.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        item.subtitle,
                        style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right_rounded, color: _green, size: 20.sp),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ReportCardItem {
  const _ReportCardItem({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.routeKey,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final String routeKey;
}
