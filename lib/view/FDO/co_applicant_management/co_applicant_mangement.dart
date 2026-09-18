import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

class CoApplicantMangement extends StatefulWidget {
  const CoApplicantMangement({super.key});

  @override
  State<CoApplicantMangement> createState() => _CoApplicantMangementState();
}

class CoApplicantModel {
  final String id;
  final String clientName;
  final String clientId;
  String coName;
  String coRelation;
  String coPhone;
  String
  status; // 'Branch Manager', 'Area Manager', 'Quality Check', 'Admin Approval', 'Active'
  int step; // 1, 2, 3, 4, 5
  String remarks;

  CoApplicantModel({
    required this.id,
    required this.clientName,
    required this.clientId,
    required this.coName,
    required this.coRelation,
    required this.coPhone,
    required this.status,
    required this.step,
    this.remarks = "",
  });
}

class _CoApplicantMangementState extends State<CoApplicantMangement> {
  late List<CoApplicantModel> _allApplications;
  List<CoApplicantModel> _filteredApplications = [];
  String _searchQuery = "";
  String _selectedStatusFilter = 'All';

  // Search controller
  late TextEditingController _searchController;

  // New Application form inputs
  final List<Map<String, String>> _mockClientsList = [
    {'name': 'Julie M', 'id': 'DRF-3-5'},
    {'name': 'Rahini R', 'id': '3-6-1-1'},
    {'name': 'Preetha Marimuthu', 'id': '3-5-2-3'},
    {'name': 'Alaguranjitha S', 'id': '3-5-2-2'},
    {'name': 'Ragu Ram', 'id': '3-5-2-1'},
    {'name': 'Karpagam K', 'id': '3-5-2-6'},
    {'name': 'Gayathri R', 'id': '3-5-2-13'},
  ];

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController();
    _allApplications = _generateMockApplications();
    _applyFilter();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  List<CoApplicantModel> _generateMockApplications() {
    return [
      CoApplicantModel(
        id: 'APP-101',
        clientName: 'Julie M',
        clientId: 'DRF-3-5',
        coName: 'Muthu Kumar',
        coRelation: 'Spouse',
        coPhone: '9876543210',
        status: 'Branch Manager',
        step: 1,
        remarks: 'Documents uploaded, verifying signature.',
      ),
      CoApplicantModel(
        id: 'APP-102',
        clientName: 'Rahini R',
        clientId: '3-6-1-1',
        coName: 'Ravi Chandran',
        coRelation: 'Father',
        coPhone: '8754247896',
        status: 'Area Manager',
        step: 2,
        remarks: 'Branch manager approved on 12-07-2026.',
      ),
      CoApplicantModel(
        id: 'APP-103',
        clientName: 'Preetha Marimuthu',
        clientId: '3-5-2-3',
        coName: 'Marimuthu S',
        coRelation: 'Husband',
        coPhone: '8110968081',
        status: 'Quality Check',
        step: 3,
        remarks: 'Aadhar verified. Checking address proof consistency.',
      ),
      CoApplicantModel(
        id: 'APP-104',
        clientName: 'Alaguranjitha S',
        clientId: '3-5-2-2',
        coName: 'Suresh Kumar',
        coRelation: 'Husband',
        coPhone: '8428499293',
        status: 'Admin Approval',
        step: 4,
        remarks: 'Quality check completed. Awaiting final signoff.',
      ),
      CoApplicantModel(
        id: 'APP-105',
        clientName: 'Karpagam K',
        clientId: '3-5-2-6',
        coName: 'Kaliappan P',
        coRelation: 'Spouse',
        coPhone: '9123456780',
        status: 'Active',
        step: 5,
        remarks: 'Activated. Microfinance account linked.',
      ),
      CoApplicantModel(
        id: 'APP-106',
        clientName: 'Gayathri R',
        clientId: '3-5-2-13',
        coName: 'Rajendran M',
        coRelation: 'Father',
        coPhone: '9087654321',
        status: 'Branch Manager',
        step: 1,
        remarks: 'New entry, waiting for initial details validation.',
      ),
    ];
  }

  void _onSearchChanged(String query) {
    setState(() {
      _searchQuery = query;
      _applyFilter();
    });
  }

  void _applyFilter() {
    List<CoApplicantModel> results = List.from(_allApplications);

    // Apply Search
    if (_searchQuery.isNotEmpty) {
      results = results.where((app) {
        return app.coName.toLowerCase().contains(_searchQuery.toLowerCase()) ||
            app.clientName.toLowerCase().contains(_searchQuery.toLowerCase()) ||
            app.clientId.toLowerCase().contains(_searchQuery.toLowerCase()) ||
            app.id.toLowerCase().contains(_searchQuery.toLowerCase()) ||
            app.coPhone.contains(_searchQuery);
      }).toList();
    }

    // Apply Status Filter
    if (_selectedStatusFilter != 'All') {
      results = results
          .where((app) => app.status == _selectedStatusFilter)
          .toList();
    }

    _filteredApplications = results;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      body: SafeArea(
        child: Column(
          children: [
            // Header navigation
            _buildHeader(),

            // Search Input area
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
              child: _buildSearchCard(),
            ),

            // Horizontal Status Metrics bar
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 16.w),
              child: _buildStatusFilterRow(),
            ),

            SizedBox(height: 14.h),

            // Applications list
            Expanded(
              child: _filteredApplications.isEmpty
                  ? _buildEmptyState()
                  : ListView.builder(
                      padding: EdgeInsets.symmetric(horizontal: 16.w),
                      physics: const BouncingScrollPhysics(),
                      itemCount: _filteredApplications.length,
                      itemBuilder: (context, index) {
                        return _buildApplicationCard(
                          _filteredApplications[index],
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: const Color(0xFF0C5F34),
        onPressed: _showAddCoApplicantDialog,
        icon: const Icon(Icons.add, color: Colors.white),
        label: Text(
          'Add Co-Applicant',
          style: TextStyle(
            color: Colors.white,
            fontSize: 13.sp,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => Navigator.maybePop(context),
            child: Container(
              padding: EdgeInsets.all(6.r),
              decoration: BoxDecoration(
                color: const Color(0xFFF1F5F2),
                borderRadius: BorderRadius.circular(8.r),
              ),
              child: Icon(
                Icons.arrow_back,
                color: const Color(0xFF0C5F34),
                size: 20.sp,
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.all(8.r),
                  decoration: BoxDecoration(
                    color: const Color(0xFFE5F7EA),
                    borderRadius: BorderRadius.circular(10.r),
                  ),
                  child: Icon(
                    Icons.groups_outlined,
                    color: const Color(0xFF0C5F34),
                    size: 22.sp,
                  ),
                ),
                SizedBox(width: 10.w),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Co-Applicant Management',
                        style: TextStyle(
                          fontSize: 18.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF0C5F34),
                        ),
                      ),
                      Text(
                        'Add, review and activate co-applicants',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF4F765E),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchCard() {
    return Container(
      padding: EdgeInsets.all(12.r),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(color: const Color(0xFFD7E9DD)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Search Client',
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF4F765E),
            ),
          ),
          SizedBox(height: 6.h),
          TextField(
            controller: _searchController,
            onChanged: _onSearchChanged,
            style: TextStyle(fontSize: 14.sp),
            decoration: InputDecoration(
              hintText: 'Search by name, client ID or phone...',
              hintStyle: const TextStyle(color: Color(0xFF8FA88B)),
              filled: true,
              fillColor: const Color(0xFFF7FBF7),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF729A7D)),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12.w,
                vertical: 10.h,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12.r),
                borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusFilterRow() {
    final statusCounts = {
      'All': _allApplications.length,
      'Branch Manager': _allApplications
          .where((a) => a.status == 'Branch Manager')
          .length,
      'Area Manager': _allApplications
          .where((a) => a.status == 'Area Manager')
          .length,
      'Quality Check': _allApplications
          .where((a) => a.status == 'Quality Check')
          .length,
      'Admin Approval': _allApplications
          .where((a) => a.status == 'Admin Approval')
          .length,
      'Active': _allApplications.where((a) => a.status == 'Active').length,
    };

    final statusLabels = {
      'All': 'All',
      'Branch Manager': 'Branch',
      'Area Manager': 'Area',
      'Quality Check': 'QC',
      'Admin Approval': 'Admin',
      'Active': 'Active',
    };

    final statusColors = {
      'All': const Color(0xFF0C5F34),
      'Branch Manager': Colors.blue.shade700,
      'Area Manager': Colors.purple.shade700,
      'Quality Check': Colors.orange.shade800,
      'Admin Approval': Colors.teal.shade700,
      'Active': const Color(0xFF0D6842),
    };

    return SizedBox(
      height: 38.h,
      child: ListView(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        children: statusCounts.entries.map((entry) {
          final status = entry.key;
          final count = entry.value;
          final isSelected = _selectedStatusFilter == status;
          final color = statusColors[status] ?? const Color(0xFF0C5F34);

          return GestureDetector(
            onTap: () {
              setState(() {
                _selectedStatusFilter = status;
                _applyFilter();
              });
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              margin: EdgeInsets.only(right: 8.w),
              padding: EdgeInsets.symmetric(horizontal: 12.w),
              decoration: BoxDecoration(
                color: isSelected ? color : Colors.white,
                borderRadius: BorderRadius.circular(10.r),
                border: Border.all(
                  color: isSelected ? color : const Color(0xFFD7E9DD),
                  width: 1,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    statusLabels[status]!,
                    style: TextStyle(
                      fontSize: 12.sp,
                      fontWeight: isSelected
                          ? FontWeight.bold
                          : FontWeight.normal,
                      color: isSelected
                          ? Colors.white
                          : const Color(0xFF4F765E),
                    ),
                  ),
                  SizedBox(width: 6.w),
                  Container(
                    padding: EdgeInsets.symmetric(
                      horizontal: 6.w,
                      vertical: 2.h,
                    ),
                    decoration: BoxDecoration(
                      color: isSelected
                          ? Colors.white24
                          : const Color(0xFFE5F7EA),
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                    child: Text(
                      '$count',
                      style: TextStyle(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.bold,
                        color: isSelected ? Colors.white : color,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildApplicationCard(CoApplicantModel app) {
    Color badgeColor;
    Color badgeBg;

    switch (app.status) {
      case 'Branch Manager':
        badgeColor = Colors.blue.shade700;
        badgeBg = Colors.blue.shade50;
        break;
      case 'Area Manager':
        badgeColor = Colors.purple.shade700;
        badgeBg = Colors.purple.shade50;
        break;
      case 'Quality Check':
        badgeColor = Colors.orange.shade800;
        badgeBg = Colors.orange.shade50;
        break;
      case 'Admin Approval':
        badgeColor = Colors.teal.shade700;
        badgeBg = Colors.teal.shade50;
        break;
      default: // Active
        badgeColor = const Color(0xFF0D6842);
        badgeBg = const Color(0xFFE8F5E9);
    }

    return Container(
      margin: EdgeInsets.only(bottom: 12.h),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withAlpha(5),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(16.r),
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () => _showDetailsSheet(app),
            child: Padding(
              padding: EdgeInsets.all(14.r),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // App ID and status badge
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        app.id,
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF0C5F34),
                        ),
                      ),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 2.h,
                        ),
                        decoration: BoxDecoration(
                          color: badgeBg,
                          borderRadius: BorderRadius.circular(6.r),
                        ),
                        child: Text(
                          app.status,
                          style: TextStyle(
                            color: badgeColor,
                            fontSize: 9.sp,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 10.h),

                  // Client detail
                  Text(
                    'Client: ${app.clientName} (${app.clientId})',
                    style: TextStyle(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.bold,
                      color: const Color(0xFF0F172A),
                    ),
                  ),
                  SizedBox(height: 4.h),

                  // Co applicant detail
                  Text(
                    'Co-applicant: ${app.coName} (${app.coRelation})',
                    style: TextStyle(
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                  ),
                  Text(
                    'Phone: ${app.coPhone}',
                    style: TextStyle(
                      fontSize: 12.sp,
                      color: const Color(0xFF64748B),
                    ),
                  ),

                  SizedBox(height: 12.h),
                  const Divider(color: Color(0xFFF1F5F9), height: 1),
                  SizedBox(height: 10.h),

                  // Visual Stage Progress
                  _buildProgressBar(app.step),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildProgressBar(int step) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Approval Stage:',
              style: TextStyle(fontSize: 10.sp, color: const Color(0xFF64748B)),
            ),
            Text(
              '$step / 5 completed',
              style: TextStyle(
                fontSize: 10.sp,
                fontWeight: FontWeight.bold,
                color: const Color(0xFF0C5F34),
              ),
            ),
          ],
        ),
        SizedBox(height: 6.h),
        ClipRRect(
          borderRadius: BorderRadius.circular(4.r),
          child: LinearProgressIndicator(
            value: step / 5.0,
            backgroundColor: const Color(0xFFE5F7EA),
            color: const Color(0xFF0C5F34),
            minHeight: 5.h,
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.people_alt_outlined,
            size: 54.sp,
            color: const Color(0xFF8FA88B),
          ),
          SizedBox(height: 12.h),
          Text(
            'No applications found',
            style: TextStyle(
              fontSize: 15.sp,
              fontWeight: FontWeight.bold,
              color: const Color(0xFF0F172A),
            ),
          ),
          SizedBox(height: 4.h),
          Text(
            'Try adjusting your filters or search keywords.',
            style: TextStyle(fontSize: 11.sp, color: const Color(0xFF64748B)),
          ),
        ],
      ),
    );
  }

  void _showDetailsSheet(CoApplicantModel app) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return DraggableScrollableSheet(
              initialChildSize: 0.75,
              maxChildSize: 0.9,
              minChildSize: 0.5,
              expand: false,
              builder: (context, scrollController) {
                return SingleChildScrollView(
                  controller: scrollController,
                  padding: EdgeInsets.all(20.r),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Center(
                        child: Container(
                          width: 40.w,
                          height: 4.h,
                          decoration: BoxDecoration(
                            color: const Color(0xFFCBD5E1),
                            borderRadius: BorderRadius.circular(2.r),
                          ),
                        ),
                      ),
                      SizedBox(height: 18.h),

                      // Heading
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Application Details',
                            style: TextStyle(
                              fontSize: 18.sp,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF0F172A),
                            ),
                          ),
                          Text(
                            app.id,
                            style: TextStyle(
                              fontSize: 15.sp,
                              fontWeight: FontWeight.bold,
                              color: const Color(0xFF0C5F34),
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 20.h),

                      // Info block
                      Container(
                        padding: EdgeInsets.all(14.r),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(14.r),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'CLIENT DETAILS',
                              style: TextStyle(
                                fontSize: 10.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF729A7D),
                              ),
                            ),
                            SizedBox(height: 4.h),
                            Text(
                              'Name: ${app.clientName}',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13.sp,
                              ),
                            ),
                            Text(
                              'Client ID: ${app.clientId}',
                              style: TextStyle(
                                fontSize: 12.sp,
                                color: const Color(0xFF64748B),
                              ),
                            ),

                            SizedBox(height: 14.h),
                            const Divider(color: Color(0xFFE2E8F0), height: 1),
                            SizedBox(height: 12.h),

                            Text(
                              'CO-APPLICANT DETAILS',
                              style: TextStyle(
                                fontSize: 10.sp,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF729A7D),
                              ),
                            ),
                            SizedBox(height: 4.h),
                            Text(
                              'Name: ${app.coName}',
                              style: TextStyle(
                                fontWeight: FontWeight.bold,
                                fontSize: 13.sp,
                              ),
                            ),
                            Text(
                              'Relationship: ${app.coRelation}',
                              style: TextStyle(
                                fontSize: 12.sp,
                                color: const Color(0xFF64748B),
                              ),
                            ),
                            Text(
                              'Phone: ${app.coPhone}',
                              style: TextStyle(
                                fontSize: 12.sp,
                                color: const Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                      SizedBox(height: 22.h),

                      // Stages Timeline Stepper
                      Text(
                        'WORKFLOW PIPELINE',
                        style: TextStyle(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.bold,
                          color: const Color(0xFF4F765E),
                        ),
                      ),
                      SizedBox(height: 12.h),
                      _buildVerticalStepper(app),
                      SizedBox(height: 22.h),

                      // Workflow Control Action buttons
                      if (app.step < 5) ...[
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: Colors.red.shade700,
                                  side: BorderSide(color: Colors.red.shade300),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12.r),
                                  ),
                                  padding: EdgeInsets.symmetric(vertical: 12.h),
                                ),
                                child: Text(
                                  'Send Back',
                                  style: TextStyle(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                onPressed: () {
                                  Navigator.pop(context);
                                  _showRejectRemarksDialog(app);
                                },
                              ),
                            ),
                            SizedBox(width: 12.w),
                            Expanded(
                              child: ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: const Color(0xFF0C5F34),
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(12.r),
                                  ),
                                  padding: EdgeInsets.symmetric(vertical: 12.h),
                                ),
                                child: Text(
                                  'Approve Stage',
                                  style: TextStyle(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.bold,
                                    color: Colors.white,
                                  ),
                                ),
                                onPressed: () {
                                  Navigator.pop(context);
                                  _approveStage(app);
                                },
                              ),
                            ),
                          ],
                        ),
                      ] else ...[
                        ElevatedButton.icon(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: const Color(0xFFE5F7EA),
                            foregroundColor: const Color(0xFF0C5F34),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12.r),
                            ),
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                          ),
                          icon: const Icon(Icons.check_circle_outline),
                          label: Text(
                            'Active and Verified',
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          onPressed: () => Navigator.pop(context),
                        ),
                      ],
                      SizedBox(height: 20.h),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  Widget _buildVerticalStepper(CoApplicantModel app) {
    final stages = [
      'Branch Manager Review',
      'Area Manager Approval',
      'Quality Check',
      'Admin Approval',
      'Active & Linked',
    ];

    return Column(
      children: List.generate(5, (index) {
        final stageStep = index + 1;
        final isCompleted = app.step > stageStep;
        final isCurrent = app.step == stageStep;

        Color circleColor;
        Color textColor;
        IconData icon;

        if (isCompleted) {
          circleColor = const Color(0xFF0C5F34);
          textColor = const Color(0xFF0C5F34);
          icon = Icons.check;
        } else if (isCurrent) {
          circleColor = Colors.orange.shade800;
          textColor = Colors.orange.shade800;
          icon = Icons.pending_outlined;
        } else {
          circleColor = const Color(0xFFCBD5E1);
          textColor = const Color(0xFF64748B);
          icon = Icons.radio_button_unchecked;
        }

        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 22.r,
                  height: 22.r,
                  decoration: BoxDecoration(
                    color: isCompleted
                        ? circleColor
                        : (isCurrent ? Colors.white : const Color(0xFFF1F5F9)),
                    shape: BoxShape.circle,
                    border: Border.all(color: circleColor, width: 2.r),
                  ),
                  child: Center(
                    child: isCompleted
                        ? Icon(icon, color: Colors.white, size: 10.sp)
                        : (isCurrent
                              ? Icon(icon, color: circleColor, size: 10.sp)
                              : Icon(icon, color: circleColor, size: 10.sp)),
                  ),
                ),
                if (index < 4)
                  Container(
                    width: 2.w,
                    height: 26.h,
                    color: isCompleted
                        ? const Color(0xFF0C5F34)
                        : const Color(0xFFE2E8F0),
                  ),
              ],
            ),
            SizedBox(width: 12.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    stages[index],
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: isCurrent || isCompleted
                          ? FontWeight.bold
                          : FontWeight.normal,
                      color: textColor,
                    ),
                  ),
                  if (isCurrent && app.remarks.isNotEmpty) ...[
                    SizedBox(height: 2.h),
                    Text(
                      'Remarks: ${app.remarks}',
                      style: TextStyle(
                        fontSize: 11.sp,
                        color: Colors.orange.shade900,
                      ),
                    ),
                  ],
                  SizedBox(height: 8.h),
                ],
              ),
            ),
          ],
        );
      }),
    );
  }

  void _approveStage(CoApplicantModel app) {
    setState(() {
      if (app.step < 5) {
        app.step += 1;
        switch (app.step) {
          case 2:
            app.status = 'Area Manager';
            app.remarks = 'Initial review passed. Sent to Area Manager.';
            break;
          case 3:
            app.status = 'Quality Check';
            app.remarks = 'Area Manager approved. Quality Check in progress.';
            break;
          case 4:
            app.status = 'Admin Approval';
            app.remarks =
                'Passed Quality Check. Awaiting final Admin approval.';
            break;
          case 5:
            app.status = 'Active';
            app.remarks = 'Activated. Microfinance account linked.';
            break;
        }
        _applyFilter();
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Stage approved successfully! Current Stage: ${app.status}',
        ),
        backgroundColor: const Color(0xFF0C5F34),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    );
  }

  void _showRejectRemarksDialog(CoApplicantModel app) {
    final remarksCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16.r),
          ),
          title: const Text('Reject & Send Back'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Please specify the reason/remarks for sending the application back to the previous stage:',
                style: TextStyle(
                  fontSize: 12.sp,
                  color: const Color(0xFF64748B),
                ),
              ),
              SizedBox(height: 12.h),
              TextField(
                controller: remarksCtrl,
                maxLines: 3,
                style: TextStyle(fontSize: 14.sp),
                decoration: InputDecoration(
                  hintText:
                      'e.g. Document signatures mismatched or blurry copy',
                  hintStyle: const TextStyle(color: Color(0xFF8FA88B)),
                  filled: true,
                  fillColor: const Color(0xFFF7FBF7),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12.r),
                    borderSide: const BorderSide(color: Color(0xFFD7E9DD)),
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red.shade700,
              ),
              child: const Text(
                'Send Back',
                style: TextStyle(color: Colors.white),
              ),
              onPressed: () {
                if (remarksCtrl.text.trim().isEmpty) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Please enter remarks')),
                  );
                  return;
                }
                Navigator.pop(context);
                _rejectStage(app, remarksCtrl.text.trim());
              },
            ),
          ],
        );
      },
    );
  }

  void _rejectStage(CoApplicantModel app, String remarks) {
    setState(() {
      if (app.step > 1) {
        app.step -= 1;
        switch (app.step) {
          case 1:
            app.status = 'Branch Manager';
            break;
          case 2:
            app.status = 'Area Manager';
            break;
          case 3:
            app.status = 'Quality Check';
            break;
          case 4:
            app.status = 'Admin Approval';
            break;
        }
        app.remarks = 'Returned: $remarks';
        _applyFilter();
      }
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Application returned to ${app.status} with remarks.'),
        backgroundColor: Colors.red.shade700,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    );
  }

  void _showAddCoApplicantDialog() {
    Map<String, String>? selectedClient = _mockClientsList.first;
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    String relation = 'Spouse';

    showDialog(
      context: context,
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18.r),
              ),
              title: Text(
                'New Co-Applicant',
                style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.bold),
              ),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Client Selection Dropdown
                    Text(
                      'Associated Client',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF4F765E),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    DropdownButtonFormField<Map<String, String>>(
                      key: ValueKey(selectedClient),
                      isExpanded: true,
                      initialValue: selectedClient,
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: const Color(0xFFF7FBF7),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 10.h,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12.r),
                          borderSide: const BorderSide(
                            color: Color(0xFFD7E9DD),
                          ),
                        ),
                      ),
                      items: _mockClientsList.map((client) {
                        return DropdownMenuItem<Map<String, String>>(
                          value: client,
                          child: Text(
                            '${client['id']} - ${client['name']}',
                            style: TextStyle(fontSize: 14.sp),
                          ),
                        );
                      }).toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setDialogState(() {
                            selectedClient = val;
                          });
                        }
                      },
                    ),
                    SizedBox(height: 12.h),

                    // Co Applicant Name
                    Text(
                      'Co-applicant Name',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF4F765E),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    TextField(
                      controller: nameCtrl,
                      style: TextStyle(fontSize: 14.sp),
                      decoration: InputDecoration(
                        hintText: 'Enter name',
                        filled: true,
                        fillColor: const Color(0xFFF7FBF7),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 10.h,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12.r),
                          borderSide: const BorderSide(
                            color: Color(0xFFD7E9DD),
                          ),
                        ),
                      ),
                    ),
                    SizedBox(height: 12.h),

                    // Relationship
                    Text(
                      'Relationship',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF4F765E),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    DropdownButtonFormField<String>(
                      key: ValueKey(relation),
                      isExpanded: true,
                      initialValue: relation,
                      decoration: InputDecoration(
                        filled: true,
                        fillColor: const Color(0xFFF7FBF7),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 10.h,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12.r),
                          borderSide: const BorderSide(
                            color: Color(0xFFD7E9DD),
                          ),
                        ),
                      ),
                      items:
                          const [
                                'Spouse',
                                'Father',
                                'Mother',
                                'Brother',
                                'Sister',
                                'Son',
                                'Daughter',
                              ]
                              .map(
                                (item) => DropdownMenuItem(
                                  value: item,
                                  child: Text(item),
                                ),
                              )
                              .toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setDialogState(() {
                            relation = val;
                          });
                        }
                      },
                    ),
                    SizedBox(height: 12.h),

                    // Phone
                    Text(
                      'Phone Number',
                      style: TextStyle(
                        fontSize: 12.sp,
                        fontWeight: FontWeight.bold,
                        color: const Color(0xFF4F765E),
                      ),
                    ),
                    SizedBox(height: 6.h),
                    TextField(
                      controller: phoneCtrl,
                      keyboardType: TextInputType.phone,
                      style: TextStyle(fontSize: 14.sp),
                      decoration: InputDecoration(
                        hintText: 'Enter 10-digit phone',
                        filled: true,
                        fillColor: const Color(0xFFF7FBF7),
                        contentPadding: EdgeInsets.symmetric(
                          horizontal: 12.w,
                          vertical: 10.h,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12.r),
                          borderSide: const BorderSide(
                            color: Color(0xFFD7E9DD),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context),
                  child: const Text('Cancel'),
                ),
                ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0C5F34),
                  ),
                  child: const Text(
                    'Create',
                    style: TextStyle(color: Colors.white),
                  ),
                  onPressed: () {
                    if (nameCtrl.text.trim().isEmpty ||
                        phoneCtrl.text.trim().isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Please fill out all fields'),
                        ),
                      );
                      return;
                    }
                    Navigator.pop(context);

                    // Add new application record
                    setState(() {
                      final newApp = CoApplicantModel(
                        id: 'APP-${100 + _allApplications.length + 1}',
                        clientName: selectedClient!['name']!,
                        clientId: selectedClient!['id']!,
                        coName: nameCtrl.text.trim(),
                        coRelation: relation,
                        coPhone: phoneCtrl.text.trim(),
                        status: 'Branch Manager',
                        step: 1,
                        remarks: 'Draft added. Awaiting branch review.',
                      );
                      _allApplications.insert(0, newApp);
                      _applyFilter();
                    });

                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: const Text(
                          'New Co-applicant application initiated successfully!',
                        ),
                        backgroundColor: const Color(0xFF0C5F34),
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                      ),
                    );
                  },
                ),
              ],
            );
          },
        );
      },
    );
  }
}
