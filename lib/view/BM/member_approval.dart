import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/member_approval_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/BM/member_approval/client_approval_detail.dart';
import 'package:sarvam/view/BM/member_approval/co_applicant_row.dart';
import 'package:sarvam/view/shared/highmark_report_sheet.dart';

class MemberApproval extends StatefulWidget {
  const MemberApproval({super.key});

  @override
  State<MemberApproval> createState() => _MemberApprovalState();
}

class _MemberApprovalState extends State<MemberApproval> {
  // Premium Theme Palette
  static const Color _primaryGreen = Color(0xFF087B39);
  static const Color _darkGreen = Color(0xFF044826);
  static const Color _bgGradientStart = Color(0xFFF2FBF6);
  static const Color _bgGradientEnd = Color(0xFFE4F5EB);
  static const Color _borderColor = Color(0xFFCBEADA);
  static const Color _cardBg = Colors.white;

  final MemberApprovalController controller =
      Get.isRegistered<MemberApprovalController>()
      ? Get.find<MemberApprovalController>()
      : Get.put(MemberApprovalController());
  final EnrollmentApiService _highmarkApi = EnrollmentApiService(ApiClient());

  final _searchController = TextEditingController();
  int _selectedTab = 0;

  @override
  void initState() {
    super.initState();
    controller.loadApprovalQueue();
    controller.loadCoApplicantQueue();
    _searchController.addListener(() {
      controller.searchQuery.value = _searchController.text.trim();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _f(Map data, String key, [String fallback = '—']) {
    final v = data[key];
    return v == null || v.toString().trim().isEmpty ? fallback : v.toString();
  }

  @override
  Widget build(BuildContext context) {
    final isCoApplicant = _selectedTab == 1;

    return Scaffold(
      backgroundColor: _bgGradientStart,
      body: SafeArea(
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [_bgGradientStart, _bgGradientEnd],
            ),
          ),
          child: Column(
            children: [
              _buildHeader(),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  child: isCoApplicant
                      ? _buildCoApplicantContent()
                      : _buildMemberContent(),
                ),
              ),
              _buildFooter(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      decoration: const BoxDecoration(
        color: Color(0xEAFFFFFF),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(24),
          bottomRight: Radius.circular(24),
        ),
        boxShadow: [
          BoxShadow(
            color: Color(0x0F043A20),
            blurRadius: 16,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [_primaryGreen, Color(0xFF0E9B49)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x4D087B39),
                      blurRadius: 10,
                      offset: Offset(0, 4),
                    ),
                  ],
                ),
                child: const Icon(
                  Icons.verified_user_rounded,
                  color: Colors.white,
                  size: 22,
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Member Approval',
                      style: GoogleFonts.poppins(
                        color: _darkGreen,
                        fontWeight: FontWeight.w700,
                        fontSize: 21,
                        letterSpacing: -0.3,
                      ),
                    ),
                    Text(
                      'Branch Manager Approval Workbench',
                      style: GoogleFonts.poppins(
                        color: const Color(0xFF437A5A),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              _buildRefreshButton(),
            ],
          ),
          const SizedBox(height: 18),
          _buildSegmentedTab(),
        ],
      ),
    );
  }

  Widget _buildRefreshButton() {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          if (_selectedTab == 0) {
            controller.loadApprovalQueue();
          } else {
            controller.loadCoApplicantQueue();
          }
        },
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: const Color(0xFFEFF8F3),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: _borderColor, width: 1.2),
          ),
          child: const Icon(
            Icons.refresh_rounded,
            color: _primaryGreen,
            size: 20,
          ),
        ),
      ),
    );
  }

  Widget _buildSegmentedTab() {
    return Container(
      height: 50,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: const Color(0xFFE2F3E9),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(child: _buildTabItem('Member Approval', 0)),
          Expanded(child: _buildTabItem('Co-Applicant Approval', 1)),
        ],
      ),
    );
  }

  Widget _buildTabItem(String label, int index) {
    final active = _selectedTab == index;

    return Obx(() {
      final count = index == 0
          ? controller.approvalQueue.length
          : controller.coApplicantQueue.length;

      return GestureDetector(
        onTap: () => setState(() => _selectedTab = index),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeInOut,
          decoration: BoxDecoration(
            color: active ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(12),
            boxShadow: active
                ? const [
                    BoxShadow(
                      color: Color(0x14043A20),
                      blurRadius: 10,
                      offset: Offset(0, 2),
                    ),
                  ]
                : [],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  style: GoogleFonts.poppins(
                    color: active ? _darkGreen : const Color(0xFF4A7C5D),
                    fontSize: 12.5,
                    fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: active ? _primaryGreen : const Color(0xFFBFE3CE),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$count',
                  style: GoogleFonts.poppins(
                    color: active ? Colors.white : _darkGreen,
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    });
  }

  Widget _buildMemberContent() {
    return RefreshIndicator(
      color: _primaryGreen,
      onRefresh: controller.loadApprovalQueue,
      child: SingleChildScrollView(
        key: const ValueKey('member_content'),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Obx(() {
              final count = controller.approvalQueue.length;
              return LayoutBuilder(
                builder: (context, box) => box.maxWidth < 600
                    ? Column(
                        children: [
                          _buildStatCard(
                            'Total Pending',
                            Icons.groups_outlined,
                            count,
                            const [Color(0xFF087B39), Color(0xFF0E9C49)],
                          ),
                          const SizedBox(height: 12),
                          _buildStatCard(
                            'Members in View',
                            Icons.person_search_outlined,
                            count,
                            const [Color(0xFF05532B), Color(0xFF0C8242)],
                          ),
                        ],
                      )
                    : Row(
                        children: [
                          Expanded(
                            child: _buildStatCard(
                              'Total Pending',
                              Icons.groups_outlined,
                              count,
                              const [Color(0xFF087B39), Color(0xFF0E9C49)],
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: _buildStatCard(
                              'Members in View',
                              Icons.person_search_outlined,
                              count,
                              const [Color(0xFF05532B), Color(0xFF0C8242)],
                            ),
                          ),
                        ],
                      ),
              );
            }),
            const SizedBox(height: 20),
            _buildSearchField(),
            const SizedBox(height: 20),
            Obx(() {
              if (controller.isLoadingQueue.value) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 60),
                  child: Center(
                    child: CircularProgressIndicator(color: _primaryGreen),
                  ),
                );
              }
              final items = controller.approvalQueue
                  .whereType<Map>()
                  .map((c) => Map<String, dynamic>.from(c))
                  .toList();
              if (items.isEmpty) {
                return _buildEmptyState(
                  message: 'No Pending Members',
                  description:
                      'There are no members pending approval at this time.',
                );
              }
              return Column(children: items.map(_buildMemberTile).toList());
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildCoApplicantContent() {
    return RefreshIndicator(
      color: _primaryGreen,
      onRefresh: controller.loadCoApplicantQueue,
      child: SingleChildScrollView(
        key: const ValueKey('co_applicant_content'),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 16),
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Obx(() {
              final count = controller.coApplicantQueue.length;
              return _buildStatCard(
                'Co-Applicants Pending',
                Icons.people_alt_outlined,
                count,
                const [Color(0xFF065C2D), Color(0xFF0E8A46)],
              );
            }),
            const SizedBox(height: 20),
            Obx(() {
              if (controller.isLoadingCoApplicants.value) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 60),
                  child: Center(
                    child: CircularProgressIndicator(color: _primaryGreen),
                  ),
                );
              }
              final items = controller.coApplicantQueue
                  .whereType<Map>()
                  .map((c) => Map<String, dynamic>.from(c))
                  .toList();
              if (items.isEmpty) {
                return _buildEmptyState(
                  message: 'No Co-Applicants Pending',
                  description:
                      'There are no co-applicants awaiting your review.',
                );
              }
              return Column(
                children: items
                    .map(
                      (co) => CoApplicantRow(
                        controller: controller,
                        coApplicant: co,
                      ),
                    )
                    .toList(),
              );
            }),
          ],
        ),
      ),
    );
  }

  Widget _buildStatCard(
    String label,
    IconData icon,
    int value,
    List<Color> gradientColors,
  ) {
    return Container(
      height: 86,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradientColors,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(18),
        boxShadow: const [
          BoxShadow(
            color: Color(0x47065C2D),
            blurRadius: 14,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Stack(
        children: [
          Positioned(
            right: -20,
            top: -20,
            child: Container(
              width: 95,
              height: 95,
              decoration: const BoxDecoration(
                color: Color(0x1AFFFFFF),
                shape: BoxShape.circle,
              ),
            ),
          ),
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: const Color(0x2EFFFFFF),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Icon(icon, color: Colors.white, size: 24),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: GoogleFonts.poppins(
                        color: const Color(0xE6FFFFFF),
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '$value',
                      style: GoogleFonts.poppins(
                        color: Colors.white,
                        fontSize: 26,
                        fontWeight: FontWeight.w700,
                        height: 1.1,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSearchField() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _borderColor, width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A043A20),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: TextField(
        controller: _searchController,
        style: GoogleFonts.poppins(color: _darkGreen, fontSize: 13.5),
        onSubmitted: (_) => controller.loadApprovalQueue(),
        decoration: InputDecoration(
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 14),
          prefixIcon: const Icon(
            Icons.search_rounded,
            color: _primaryGreen,
            size: 22,
          ),
          suffixIcon: ValueListenableBuilder<TextEditingValue>(
            valueListenable: _searchController,
            builder: (context, value, child) {
              if (value.text.isEmpty) return const SizedBox.shrink();
              return IconButton(
                icon: const Icon(
                  Icons.cancel_rounded,
                  color: Color(0xFF94A3B8),
                  size: 18,
                ),
                onPressed: () {
                  _searchController.clear();
                  controller.searchQuery.value = '';
                },
              );
            },
          ),
          hintText: 'Search by member name or ID...',
          hintStyle: GoogleFonts.poppins(
            color: const Color(0xFF7A9E88),
            fontSize: 13,
          ),
        ),
      ),
    );
  }

  Widget _buildMemberTile(Map<String, dynamic> client) {
    final rawStatus = _f(client, 'approvalStatus').replaceAll('_', ' ');
    final name = _f(client, 'name', '?');
    final initial = name.isNotEmpty ? name[0].toUpperCase() : '?';
    final clientId = _f(client, 'clientId');
    final mobile = _f(client, 'mobileNumber');
    final centerName = client['centerName']?.toString();
    final kycCount = client['kycDocCount'];

    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        decoration: BoxDecoration(
          color: _cardBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFFE2F1E8), width: 1.5),
          boxShadow: const [
            BoxShadow(
              color: Color(0x0D043A20),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        colors: [_primaryGreen, Color(0xFF109B4E)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Color(0x40087B39),
                          blurRadius: 8,
                          offset: Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        initial,
                        style: GoogleFonts.poppins(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                name,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.poppins(
                                  color: _darkGreen,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            _buildStatusPill(rawStatus),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            const Icon(
                              Icons.badge_outlined,
                              size: 13,
                              color: Color(0xFF5A8E70),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                clientId,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF337A55),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            const Icon(
                              Icons.phone_outlined,
                              size: 13,
                              color: Color(0xFF5A8E70),
                            ),
                            const SizedBox(width: 4),
                            Flexible(
                              child: Text(
                                mobile,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.poppins(
                                  color: const Color(0xFF337A55),
                                  fontSize: 12,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (centerName != null || kycCount != null) ...[
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            runSpacing: 4,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              if (centerName != null)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 2.5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFEAF6F0),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(
                                        Icons.location_on_outlined,
                                        size: 11,
                                        color: _primaryGreen,
                                      ),
                                      const SizedBox(width: 3),
                                      Flexible(
                                        child: Text(
                                          centerName,
                                          overflow: TextOverflow.ellipsis,
                                          style: GoogleFonts.poppins(
                                            color: _darkGreen,
                                            fontSize: 10.5,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              if (kycCount != null)
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 8,
                                    vertical: 2.5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFFFF7ED),
                                    borderRadius: BorderRadius.circular(6),
                                    border: Border.all(
                                      color: const Color(0xFFFFEDD5),
                                    ),
                                  ),
                                  child: Text(
                                    '$kycCount Docs',
                                    style: GoogleFonts.poppins(
                                      color: const Color(0xFFC2410C),
                                      fontSize: 10.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Divider(height: 1, color: Color(0xFFEAF5EE)),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        final dbId = client['id']?.toString() ?? '';
                        if (dbId.isEmpty) return;
                        showHighmarkReport(
                          context,
                          api: _highmarkApi,
                          clientDbId: dbId,
                          clientName: name,
                        );
                      },
                      icon: const Icon(
                        Icons.shield_outlined,
                        size: 15,
                        color: Color(0xFF7C3AED),
                      ),
                      label: Text(
                        'Highmark',
                        style: GoogleFonts.poppins(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF7C3AED),
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(
                          color: Color(0xFFDDD6FE),
                          width: 1.4,
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  // Review Details is the only way in — KYC documents must
                  // be verified one by one on that screen; there's no
                  // shortcut here to bulk-verify-and-submit a client
                  // without opening each image first.
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () async {
                        final cid = client['clientId']?.toString();
                        if (cid == null) return;
                        final result = await Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => ClientApprovalDetail(clientId: cid),
                          ),
                        );
                        if (result == true) controller.loadApprovalQueue();
                      },
                      icon: const Icon(
                        Icons.rate_review_outlined,
                        size: 15,
                        color: _primaryGreen,
                      ),
                      label: Text(
                        'Review Details',
                        style: GoogleFonts.poppins(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w600,
                          color: _primaryGreen,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: _borderColor, width: 1.4),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        padding: const EdgeInsets.symmetric(vertical: 8),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStatusPill(String status) {
    Color bg = const Color(0xFFECFDF5);
    Color fg = const Color(0xFF047857);
    Color border = const Color(0xFFA7F3D0);

    final upper = status.toUpperCase();
    if (upper.contains('PENDING')) {
      bg = const Color(0xFFFFFBEB);
      fg = const Color(0xFFB45309);
      border = const Color(0xFFFDE68A);
    } else if (upper.contains('REJECT')) {
      bg = const Color(0xFFFEF2F2);
      fg = const Color(0xFFB91C1C);
      border = const Color(0xFFFECACA);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        border: Border.all(color: border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        status.toUpperCase(),
        style: GoogleFonts.poppins(
          color: fg,
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  Widget _buildEmptyState({
    required String message,
    required String description,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 20),
      width: double.infinity,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _borderColor, width: 1.5),
        boxShadow: const [
          BoxShadow(
            color: Color(0x0A043A20),
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 70,
            height: 70,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFFE8F5EF), Color(0xFFD2EBDC)],
              ),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.check_circle_outline_rounded,
              color: _primaryGreen,
              size: 38,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            message,
            style: GoogleFonts.poppins(
              fontWeight: FontWeight.w700,
              color: _darkGreen,
              fontSize: 17,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            description,
            textAlign: TextAlign.center,
            style: GoogleFonts.poppins(
              color: const Color(0xFF5A8E70),
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 20),
      decoration: BoxDecoration(
        color: const Color(0xEAFFFFFF),
        border: const Border(top: BorderSide(color: _borderColor)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.shield_outlined, color: _primaryGreen, size: 15),
          const SizedBox(width: 6),
          Text(
            'Sarvam Charitable Trust Management System',
            style: GoogleFonts.poppins(
              color: const Color(0xFF4A7C5D),
              fontSize: 11.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
