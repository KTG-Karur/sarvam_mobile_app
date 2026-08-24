import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/member_individual_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/grt_api_service.dart';
import 'package:sarvam/view/BM/group_assignment/widgets/id_dropdown.dart';
import 'package:sarvam/view/BM/member_individual/grt_session_conduct_screen.dart';
import 'package:sarvam/view/BM/member_individual/grt_session_create_dialog.dart';
import 'package:sarvam/view/BM/member_individual/member_individual_detail.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

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

  late final GrtApiService _grtApi = GrtApiService(
    Get.isRegistered<ApiClient>() ? Get.find<ApiClient>() : Get.put(ApiClient()),
  );

  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  int _activeTab = 0; // 0: Members Roster, 1: GRT Sessions
  List<dynamic> _grtSessions = [];
  bool _isLoadingGrtSessions = false;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

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
                    if (controller.centerId.value != null)
                      _activeTab == 0
                          ? _buildRoster()
                          : _buildGrtSessionsView(controller.centerId.value!, _selectedCenterName()),
                  ],
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  String _selectedCenterName() {
    final cId = controller.centerId.value;
    if (cId == null) return 'Center';
    final match = controller.centers.firstWhere(
      (c) => c is Map && c['id']?.toString() == cId,
      orElse: () => null,
    );
    if (match is Map) {
      final name = match['name'] ?? match['centerName'] ?? '';
      final code = match['code'] ?? match['centerCode'] ?? '';
      return code.toString().isNotEmpty ? '$name ($code)' : '$name';
    }
    return 'Center';
  }

  Widget _buildGrtSessionsView(String centerId, String centerName) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'GRT Sessions',
              style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w800, color: _darkText),
            ),
            ElevatedButton.icon(
              onPressed: () async {
                final sessionId = await showDialog<String>(
                  context: context,
                  builder: (_) => GrtSessionCreateDialog(centerId: centerId, centerName: centerName),
                );
                if (sessionId != null && sessionId.isNotEmpty) {
                  _fetchGrtSessions(centerId);
                  if (mounted) {
                    await Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => GrtSessionConductScreen(sessionId: sessionId, centerName: centerName),
                      ),
                    );
                    _fetchGrtSessions(centerId);
                  }
                }
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: _green,
                foregroundColor: Colors.white,
                padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r)),
              ),
              icon: Icon(Icons.add_rounded, size: 16.sp),
              label: Text('Create Session', style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700)),
            ),
          ],
        ),
        SizedBox(height: 10.h),
        if (_isLoadingGrtSessions)
          const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator(color: _green)))
        else if (_grtSessions.isEmpty)
          Container(
            width: double.infinity,
            padding: EdgeInsets.all(20.w),
            decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFE1EAE4)), borderRadius: BorderRadius.circular(12.r)),
            child: Column(
              children: [
                Icon(Icons.assignment_outlined, size: 36.sp, color: _muted),
                SizedBox(height: 8.h),
                Text('No GRT Sessions found for this center.', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w700, color: _darkText)),
                SizedBox(height: 4.h),
                Text('Tap "Create Session" above to conduct a Group Readiness Test for center members.', textAlign: TextAlign.center, style: TextStyle(fontSize: 11.sp, color: _muted)),
              ],
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _grtSessions.length,
            separatorBuilder: (_, __) => SizedBox(height: 10.h),
            itemBuilder: (_, index) {
              final session = _grtSessions[index];
              final sId = session['id']?.toString() ?? session['sessionId']?.toString() ?? '';
              final displayId = session['sessionId']?.toString() ?? session['id']?.toString() ?? '';
              final dateStr = session['sessionDate']?.toString() ?? '';
              final qTitle = session['questionnaireTitle']?.toString() ?? '';
              final mCount = session['memberCount'] ?? 0;
              final isDone = session['isComplete'] == true;

              return InkWell(
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => GrtSessionConductScreen(sessionId: sId, centerName: centerName),
                    ),
                  );
                  _fetchGrtSessions(centerId);
                },
                child: Container(
                  padding: EdgeInsets.all(12.w),
                  decoration: BoxDecoration(color: Colors.white, border: Border.all(color: const Color(0xFFE1EAE4)), borderRadius: BorderRadius.circular(12.r)),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 18.r,
                        backgroundColor: isDone ? const Color(0xFFDCFCE7) : const Color(0xFFFFF8E1),
                        child: Icon(isDone ? Icons.check_circle_rounded : Icons.pending_actions_rounded, size: 18.sp, color: isDone ? const Color(0xFF15803D) : const Color(0xFF9A6B00)),
                      ),
                      SizedBox(width: 10.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    'Session: $displayId',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(
                                      fontSize: 12.sp,
                                      fontWeight: FontWeight.w800,
                                      color: _darkText,
                                    ),
                                  ),
                                ),
                                SizedBox(width: 6.w),
                                Container(
                                  padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 2.h),
                                  decoration: BoxDecoration(
                                    color: isDone ? const Color(0xFFDCFCE7) : const Color(0xFFFFF8E1),
                                    borderRadius: BorderRadius.circular(4.r),
                                  ),
                                  child: Text(
                                    isDone ? 'COMPLETED' : 'IN PROGRESS',
                                    style: TextStyle(
                                      fontSize: 9.5.sp,
                                      fontWeight: FontWeight.w800,
                                      color: isDone ? const Color(0xFF15803D) : const Color(0xFF9A6B00),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 3.h),
                            Text(qTitle, style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _green)),
                            SizedBox(height: 2.h),
                            Text('Date: $dateStr · $mCount members', style: TextStyle(fontSize: 10.5.sp, color: _muted)),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right_rounded, size: 20.sp, color: _muted),
                    ],
                  ),
                ),
              );
            },
          ),
      ],
    );
  }

  Future<void> _fetchGrtSessions(String centerId) async {
    setState(() => _isLoadingGrtSessions = true);
    try {
      final list = await _grtApi.getGrtSessions(centerId);
      if (mounted) setState(() => _grtSessions = list);
    } catch (e) {
      debugPrint('Failed to load GRT sessions: $e');
    } finally {
      if (mounted) setState(() => _isLoadingGrtSessions = false);
    }
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
              onChanged: (val) {
                controller.onCenterChanged(val);
                if (val != null && _activeTab == 1) {
                  _fetchGrtSessions(val);
                }
              },
            ),
          ),
          if (controller.centerId.value != null) ...[
            SizedBox(height: 12.h),
            _buildTabToggle(),
          ],
        ],
      ),
    );
  }

  Widget _buildTabToggle() {
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFFE2E8F0),
        borderRadius: BorderRadius.circular(10.r),
      ),
      padding: EdgeInsets.all(3.w),
      child: Row(
        children: [
          Expanded(
            child: _tabButton(
              index: 0,
              label: 'Members Roster',
              icon: Icons.people_alt_rounded,
            ),
          ),
          Expanded(
            child: _tabButton(
              index: 1,
              label: 'GRT Sessions',
              icon: Icons.assignment_turned_in_rounded,
            ),
          ),
        ],
      ),
    );
  }

  Widget _tabButton({required int index, required String label, required IconData icon}) {
    final selected = _activeTab == index;
    return GestureDetector(
      onTap: () {
        setState(() => _activeTab = index);
        if (index == 1 && controller.centerId.value != null) {
          _fetchGrtSessions(controller.centerId.value!);
        }
      },
      child: Container(
        padding: EdgeInsets.symmetric(vertical: 8.h),
        decoration: BoxDecoration(
          color: selected ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(8.r),
          boxShadow: selected
              ? [BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 4, offset: const Offset(0, 2))]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 14.sp, color: selected ? _green : _muted),
            SizedBox(width: 6.w),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5.sp,
                fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                color: selected ? _green : _muted,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRoster() {
    return Obx(() {
      final roster = controller.roster;
      final filteredRoster = roster.where((loan) {
        if (_searchQuery.trim().isEmpty) return true;
        final q = _searchQuery.trim().toLowerCase();
        final name = (loan['clientName'] ?? '').toString().toLowerCase();
        final displayId = (loan['clientDisplayId'] ?? '').toString().toLowerCase();
        final loanNum = (loan['loanNumber'] ?? '').toString().toLowerCase();
        final prodName = (loan['productName'] ?? '').toString().toLowerCase();
        return name.contains(q) || displayId.contains(q) || loanNum.contains(q) || prodName.contains(q);
      }).toList();

      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Loans',
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              if (roster.isNotEmpty)
                Text(
                  'Showing ${filteredRoster.length} of ${roster.length}',
                  style: TextStyle(fontSize: 11.sp, color: _muted, fontWeight: FontWeight.w600),
                ),
            ],
          ),
          SizedBox(height: 10.h),
          if (roster.isNotEmpty) ...[
            TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _searchQuery = val),
              style: TextStyle(fontSize: 12.5.sp, color: _darkText),
              decoration: InputDecoration(
                hintText: 'Search client name, ID, or loan #...',
                hintStyle: TextStyle(fontSize: 12.sp, color: _muted),
                prefixIcon: Icon(Icons.search_rounded, color: _green, size: 18.sp),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.clear, size: 16.sp, color: _muted),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                isDense: true,
                filled: true,
                fillColor: Colors.white,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10.r),
                  borderSide: const BorderSide(color: Color(0xFFE1EAE4)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10.r),
                  borderSide: const BorderSide(color: Color(0xFFE1EAE4)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10.r),
                  borderSide: const BorderSide(color: _green, width: 1.5),
                ),
              ),
            ),
            SizedBox(height: 10.h),
          ],
          if (controller.isLoadingRoster.value)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator(color: _green)),
            )
          else if (roster.isEmpty)
            _emptyState('No indexed loans awaiting Member Individual for this center.')
          else if (filteredRoster.isEmpty)
            _emptyState('No loans matching "${_searchQuery.trim()}"')
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: filteredRoster.length,
              separatorBuilder: (_, __) => SizedBox(height: 8.h),
              itemBuilder: (_, index) =>
                  _rosterCard(Map<String, dynamic>.from(filteredRoster[index])),
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
