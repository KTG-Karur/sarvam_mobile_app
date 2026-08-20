import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/member_individual_controller.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/BM/member_individual/member_individual_detail.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

/// BM "Member Individual" roster — mirrors the Members tab of the web app's
/// `components/loan-module/MemberIndividualClient.tsx`: pick a center, see
/// indexed/non-disbursed loans with per-tab completion status, tap through
/// to fill Cash Flow / Loan Appraisal / House Hold Visit. GRT Sessions is
/// web-only for now.
class MemberIndividual extends StatefulWidget {
  const MemberIndividual({super.key});

  @override
  State<MemberIndividual> createState() => _MemberIndividualState();
}

class _MemberIndividualState extends State<MemberIndividual> {
  final MemberIndividualController controller =
      Get.isRegistered<MemberIndividualController>()
      ? Get.find<MemberIndividualController>()
      : Get.put(MemberIndividualController());

  String _field(Map data, String key, [String fallback = 'N/A']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  double _amount(Map data, String key) {
    final v = data[key];
    if (v is num) return v.toDouble();
    return double.tryParse('$v') ?? 0;
  }

  String _currency(double amount) => '₹${amount.toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    return Theme(
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
            icon: const Icon(Icons.arrow_back, color: _green),
          ),
          title: Text(
            'Member Individual',
            style: TextStyle(
              fontSize: 17.sp,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF10472A),
            ),
          ),
        ),
        body: SafeArea(
          top: false,
          child: Obx(() {
            if (controller.isLoadingCenters.value && controller.centers.isEmpty) {
              return const Center(child: CircularProgressIndicator(color: _green));
            }
            return RefreshIndicator(
              color: _green,
              onRefresh: controller.reloadRoster,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: EdgeInsets.all(16.w),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildCenterCard(),
                    SizedBox(height: 16.h),
                    if (controller.centerId.value != null) _buildRoster(),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  Widget _buildCenterCard() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Select Center',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 3.h),
          Text(
            'Post-indexation loans awaiting Member Individual data before AM approval.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
          SizedBox(height: 12.h),
          Obx(
            () => IdDropdown(
              label: 'Center',
              value: controller.centerId.value,
              items: controller.centers,
              labelBuilder: centerLabel,
              onChanged: controller.onCenterChanged,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoster() {
    return Obx(() {
      final roster = controller.roster;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Loans',
            style: TextStyle(
              fontSize: 14.sp,
              fontWeight: FontWeight.w800,
              color: _darkText,
            ),
          ),
          SizedBox(height: 10.h),
          if (controller.isLoadingRoster.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (roster.isEmpty)
            _emptyState('No indexed loans awaiting Member Individual for this center.')
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: roster.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, index) =>
                  _rosterCard(Map<String, dynamic>.from(roster[index])),
            ),
        ],
      );
    });
  }

  Widget _rosterCard(Map<String, dynamic> loan) {
    final cashFlowComplete = loan['cashFlowComplete'] == true;
    final appraisalComplete = loan['loanAppraisalComplete'] == true;
    final visitComplete = loan['houseHoldVisitComplete'] == true;
    final isComplete = loan['isComplete'] == true;

    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(12.r),
      child: InkWell(
        borderRadius: BorderRadius.circular(12.r),
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => MemberIndividualDetail(
                loanId: loan['loanId'].toString(),
              ),
            ),
          );
          controller.reloadRoster();
        },
        child: Container(
          padding: EdgeInsets.all(12.w),
          decoration: BoxDecoration(
            border: Border.all(
              color: isComplete
                  ? _green.withValues(alpha: 0.35)
                  : const Color(0xFFE1EAE4),
            ),
            borderRadius: BorderRadius.circular(12.r),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _field(loan, 'clientDisplayId'),
                          style: TextStyle(
                            fontSize: 12.5.sp,
                            fontWeight: FontWeight.w800,
                            color: _darkText,
                          ),
                        ),
                        Text(
                          _field(loan, 'clientName'),
                          style: TextStyle(fontSize: 10.5.sp, color: _muted),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    _currency(_amount(loan, 'amount')),
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w800,
                      color: _green,
                    ),
                  ),
                  SizedBox(width: 4.w),
                  Icon(Icons.chevron_right_rounded, color: _muted, size: 20.sp),
                ],
              ),
              SizedBox(height: 6.h),
              Text(
                'Loan ${_field(loan, 'loanNumber')} • ${_field(loan, 'productName')}',
                style: TextStyle(fontSize: 10.5.sp, color: _muted),
              ),
              SizedBox(height: 10.h),
              Row(
                children: [
                  _statusChip('Cash Flow', cashFlowComplete),
                  SizedBox(width: 6.w),
                  _statusChip('Appraisal', appraisalComplete),
                  SizedBox(width: 6.w),
                  _statusChip('Visit', visitComplete),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _statusChip(String label, bool complete) => Expanded(
    child: Container(
      padding: EdgeInsets.symmetric(vertical: 5.h),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: complete ? const Color(0xFFE6F5EC) : const Color(0xFFF1F5F9),
        borderRadius: BorderRadius.circular(8.r),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            complete ? Icons.check_circle_rounded : Icons.radio_button_unchecked,
            size: 11.sp,
            color: complete ? _green : _muted,
          ),
          SizedBox(width: 3.w),
          Flexible(
            child: Text(
              label,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 9.sp,
                fontWeight: FontWeight.w700,
                color: complete ? _green : _muted,
              ),
            ),
          ),
        ],
      ),
    ),
  );

  Widget _emptyState(String message) => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(vertical: 28.h),
    decoration: BoxDecoration(
      border: Border.all(color: const Color(0xFFE1EAE4)),
      borderRadius: BorderRadius.circular(12.r),
    ),
    child: Column(
      children: [
        Icon(Icons.folder_open_rounded, size: 34.sp, color: _muted),
        SizedBox(height: 8.h),
        Text(
          message,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 11.sp, color: _muted),
        ),
      ],
    ),
  );
}
