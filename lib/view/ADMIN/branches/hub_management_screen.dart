import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:sarvam/controller/admin/admin_hub_controller.dart';

class HubManagementScreen extends StatefulWidget {
  const HubManagementScreen({super.key});

  @override
  State<HubManagementScreen> createState() => _HubManagementScreenState();
}

class _HubManagementScreenState extends State<HubManagementScreen>
    with SingleTickerProviderStateMixin {
  static const _green = Color(0xFF0D6842);
  static const _greenLight = Color(0xFF1A8A5A);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  late TabController _tabController;
  late AdminHubController _controller;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);

    _controller = Get.isRegistered<AdminHubController>()
        ? Get.find<AdminHubController>()
        : Get.put(AdminHubController());

    _loadData();

    _tabController.addListener(() {
      if (!_tabController.indexIsChanging) {
        _loadDataForTab(_tabController.index);
      }
    });
  }

  void _loadData() {
    _controller.loadRegions();
    _controller.loadDivisions();
    _controller.loadAreas();
    _controller.loadBranches();
    _controller.loadGroupAssignmentSettings();
  }

  void _loadDataForTab(int index) {
    switch (index) {
      case 0:
        _controller.loadRegions();
        break;
      case 1:
        _controller.loadDivisions();
        break;
      case 2:
        _controller.loadAreas();
        break;
      case 3:
        _controller.loadBranches();
        break;
      case 4:
        _controller.loadGroupAssignmentSettings();
        break;
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: _buildAppBar(),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildRegionTab(),
          _buildDivisionTab(),
          _buildAreaTab(),
          _buildBranchTab(),
          _buildSettingsTab(),
        ],
      ),
    );
  }

  // ==================== APP BAR ====================
  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: _darkText,
      elevation: 0,
      title: Row(
        children: [
          Container(
            padding: EdgeInsets.all(8.w),
            decoration: BoxDecoration(
              gradient: const LinearGradient(colors: [_green, _greenLight]),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(Icons.hub_rounded, color: Colors.white, size: 18.sp),
          ),
          SizedBox(width: 10.w),
          Text(
            'Hub Management',
            style: GoogleFonts.inter(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: _darkText,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          onPressed: _loadData,
          icon: Icon(Icons.refresh_rounded, color: _green, size: 22.sp),
          tooltip: 'Refresh',
        ),
      ],
      bottom: TabBar(
        controller: _tabController,
        labelColor: _green,
        unselectedLabelColor: _muted,
        indicatorColor: _green,
        indicatorWeight: 3.h,
        labelStyle: GoogleFonts.inter(
          fontSize: 13.sp,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelStyle: GoogleFonts.inter(
          fontSize: 13.sp,
          fontWeight: FontWeight.w500,
        ),
        tabs: const [
          Tab(text: 'Region'),
          Tab(text: 'Division'),
          Tab(text: 'Area'),
          Tab(text: 'Branch'),
          Tab(text: 'Settings'),
        ],
      ),
    );
  }

  // ==================== REGION TAB ====================
  Widget _buildRegionTab() {
    return Scaffold(
      backgroundColor: _lightBg,
      floatingActionButton: _buildFAB('Add Region', _showAddRegionDialog),
      body: RefreshIndicator(
        onRefresh: () async => _controller.loadRegions(),
        color: _green,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.regions.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(color: _green),
            );
          }
          if (_controller.regions.isEmpty) {
            return _buildEmptyState(
              'No Regions Found',
              'Tap + Add Region to create a new top-level region.',
            );
          }
          return ListView.separated(
            padding: EdgeInsets.all(16.w),
            itemCount: _controller.regions.length,
            separatorBuilder: (_, __) => SizedBox(height: 12.h),
            itemBuilder: (_, index) {
              final reg = _controller.regions[index];
              return _buildAnimatedItem(
                index: index,
                child: _buildRegionCard(reg),
              );
            },
          );
        }),
      ),
    );
  }

  Widget _buildRegionCard(RegionModel reg) {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: _green.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10.r),
            ),
            child: Icon(Icons.map_rounded, color: _green, size: 22.sp),
          ),
          SizedBox(width: 14.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        reg.name,
                        style: GoogleFonts.inter(
                          fontSize: 15.sp,
                          fontWeight: FontWeight.w700,
                          color: _darkText,
                        ),
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    SizedBox(width: 8.w),
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 6.w,
                        vertical: 2.h,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(4.r),
                      ),
                      child: Text(
                        reg.code,
                        style: GoogleFonts.inter(
                          fontSize: 11.sp,
                          fontWeight: FontWeight.w600,
                          color: _muted,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 4.h),
                Text(
                  'Divisions: ${reg.divisionsCount}',
                  style: GoogleFonts.inter(fontSize: 12.sp, color: _muted),
                ),
              ],
            ),
          ),
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildStatusBadge(reg.isActive),
              SizedBox(width: 4.w),
              IconButton(
                onPressed: () => _showEditRegionDialog(reg),
                icon: Icon(Icons.edit_rounded, size: 18.sp, color: _green),
                constraints: const BoxConstraints(),
                padding: EdgeInsets.all(4.w),
                tooltip: 'Edit Region',
              ),
            ],
          ),
        ],
      ),
    );
  }

  // ==================== DIVISION TAB ====================
  Widget _buildDivisionTab() {
    return Scaffold(
      backgroundColor: _lightBg,
      floatingActionButton: _buildFAB('Add Division', _showAddDivisionDialog),
      body: RefreshIndicator(
        onRefresh: () async => _controller.loadDivisions(),
        color: _green,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.divisions.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(color: _green),
            );
          }
          if (_controller.divisions.isEmpty) {
            return _buildEmptyState(
              'No Divisions Found',
              'Tap + Add Division to map under a region.',
            );
          }
          return ListView.separated(
            padding: EdgeInsets.all(16.w),
            itemCount: _controller.divisions.length,
            separatorBuilder: (_, __) => SizedBox(height: 12.h),
            itemBuilder: (_, index) {
              final div = _controller.divisions[index];
              return _buildAnimatedItem(
                index: index,
                child: Container(
                  padding: EdgeInsets.all(16.w),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12.r),
                    border: Border.all(color: Colors.grey.shade200),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.02),
                        blurRadius: 6,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          color: Colors.teal.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                        child: Icon(
                          Icons.account_tree_rounded,
                          color: Colors.teal,
                          size: 22.sp,
                        ),
                      ),
                      SizedBox(width: 14.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    div.name,
                                    style: GoogleFonts.inter(
                                      fontSize: 15.sp,
                                      fontWeight: FontWeight.w700,
                                      color: _darkText,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                SizedBox(width: 8.w),
                                Container(
                                  padding: EdgeInsets.symmetric(
                                    horizontal: 6.w,
                                    vertical: 2.h,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.grey.shade100,
                                    borderRadius: BorderRadius.circular(4.r),
                                  ),
                                  child: Text(
                                    div.code,
                                    style: GoogleFonts.inter(
                                      fontSize: 11.sp,
                                      fontWeight: FontWeight.w600,
                                      color: _muted,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 4.h),
                            Text(
                              'Region: ${div.regionName} | Areas: ${div.areasCount}',
                              style: GoogleFonts.inter(
                                fontSize: 12.sp,
                                color: _muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _buildStatusBadge(div.isActive),
                          SizedBox(width: 4.w),
                          IconButton(
                            onPressed: () => _showEditDivisionDialog(div),
                            icon: Icon(
                              Icons.edit_rounded,
                              size: 18.sp,
                              color: _green,
                            ),
                            constraints: const BoxConstraints(),
                            padding: EdgeInsets.all(4.w),
                            tooltip: 'Edit Division',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        }),
      ),
    );
  }

  // ==================== AREA TAB ====================
  Widget _buildAreaTab() {
    return Scaffold(
      backgroundColor: _lightBg,
      floatingActionButton: _buildFAB('Add Area', _showAddAreaDialog),
      body: RefreshIndicator(
        onRefresh: () async => _controller.loadAreas(),
        color: _green,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.areas.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(color: _green),
            );
          }
          if (_controller.areas.isEmpty) {
            return _buildEmptyState(
              'No Areas Found',
              'Tap + Add Area to map under a division.',
            );
          }
          return ListView.separated(
            padding: EdgeInsets.all(16.w),
            itemCount: _controller.areas.length,
            separatorBuilder: (_, __) => SizedBox(height: 12.h),
            itemBuilder: (_, index) {
              final area = _controller.areas[index];
              return _buildAnimatedItem(
                index: index,
                child: Container(
                  padding: EdgeInsets.all(16.w),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12.r),
                    border: Border.all(color: Colors.grey.shade200),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.02),
                        blurRadius: 6,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          color: Colors.indigo.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                        child: Icon(
                          Icons.folder_copy_rounded,
                          color: Colors.indigo,
                          size: 22.sp,
                        ),
                      ),
                      SizedBox(width: 14.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    area.name,
                                    style: GoogleFonts.inter(
                                      fontSize: 15.sp,
                                      fontWeight: FontWeight.w700,
                                      color: _darkText,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                SizedBox(width: 8.w),
                                Container(
                                  padding: EdgeInsets.symmetric(
                                    horizontal: 6.w,
                                    vertical: 2.h,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.grey.shade100,
                                    borderRadius: BorderRadius.circular(4.r),
                                  ),
                                  child: Text(
                                    area.code,
                                    style: GoogleFonts.inter(
                                      fontSize: 11.sp,
                                      fontWeight: FontWeight.w600,
                                      color: _muted,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 4.h),
                            Text(
                              'Division: ${area.divisionName} | Branches: ${area.branchesCount}',
                              style: GoogleFonts.inter(
                                fontSize: 12.sp,
                                color: _muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _buildStatusBadge(area.isActive),
                          SizedBox(width: 4.w),
                          IconButton(
                            onPressed: () => _showEditAreaDialog(area),
                            icon: Icon(
                              Icons.edit_rounded,
                              size: 18.sp,
                              color: _green,
                            ),
                            constraints: const BoxConstraints(),
                            padding: EdgeInsets.all(4.w),
                            tooltip: 'Edit Area',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        }),
      ),
    );
  }

  // ==================== BRANCH TAB ====================
  Widget _buildBranchTab() {
    return Scaffold(
      backgroundColor: _lightBg,
      floatingActionButton: _buildFAB('Create Branch', _showAddBranchDialog),
      body: RefreshIndicator(
        onRefresh: () async => _controller.loadBranches(),
        color: _green,
        child: Obx(() {
          if (_controller.isLoading.value && _controller.branches.isEmpty) {
            return const Center(
              child: CircularProgressIndicator(color: _green),
            );
          }
          if (_controller.branches.isEmpty) {
            return _buildEmptyState(
              'No Branches Found',
              'Tap + Create Branch to add a new operational branch.',
            );
          }
          return ListView.separated(
            padding: EdgeInsets.all(16.w),
            itemCount: _controller.branches.length,
            separatorBuilder: (_, __) => SizedBox(height: 12.h),
            itemBuilder: (_, index) {
              final br = _controller.branches[index];
              return _buildAnimatedItem(
                index: index,
                child: Container(
                  padding: EdgeInsets.all(16.w),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12.r),
                    border: Border.all(color: Colors.grey.shade200),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(0.02),
                        blurRadius: 6,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          color: _green.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                        child: Icon(
                          br.isHeadOffice
                              ? Icons.domain_rounded
                              : Icons.storefront_rounded,
                          color: _green,
                          size: 22.sp,
                        ),
                      ),
                      SizedBox(width: 14.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    br.name,
                                    style: GoogleFonts.inter(
                                      fontSize: 15.sp,
                                      fontWeight: FontWeight.w700,
                                      color: _darkText,
                                    ),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                                SizedBox(width: 6.w),
                                Container(
                                  padding: EdgeInsets.symmetric(
                                    horizontal: 6.w,
                                    vertical: 2.h,
                                  ),
                                  decoration: BoxDecoration(
                                    color: Colors.grey.shade100,
                                    borderRadius: BorderRadius.circular(4.r),
                                  ),
                                  child: Text(
                                    br.code,
                                    style: GoogleFonts.inter(
                                      fontSize: 11.sp,
                                      fontWeight: FontWeight.w600,
                                      color: _muted,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            SizedBox(height: 4.h),
                            if (br.areaName.isNotEmpty)
                              Text(
                                'Area: ${br.areaName}',
                                style: GoogleFonts.inter(
                                  fontSize: 12.sp,
                                  color: _muted,
                                ),
                              ),
                            if (br.address.isNotEmpty)
                              Text(
                                br.address,
                                style: GoogleFonts.inter(
                                  fontSize: 11.sp,
                                  color: Colors.grey.shade500,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                          ],
                        ),
                      ),
                      SizedBox(width: 8.w),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _buildStatusBadge(br.isActive),
                              SizedBox(width: 4.w),
                              IconButton(
                                onPressed: () => _showEditBranchDialog(br),
                                icon: Icon(
                                  Icons.edit_rounded,
                                  size: 18.sp,
                                  color: _green,
                                ),
                                constraints: const BoxConstraints(),
                                padding: EdgeInsets.all(4.w),
                                tooltip: 'Edit Branch',
                              ),
                              SizedBox(width: 2.w),
                              IconButton(
                                onPressed: () => _confirmDeleteBranch(br),
                                icon: Icon(
                                  Icons.delete_outline_rounded,
                                  size: 18.sp,
                                  color: Colors.red.shade400,
                                ),
                                constraints: const BoxConstraints(),
                                padding: EdgeInsets.all(4.w),
                                tooltip: 'Delete Branch',
                              ),
                            ],
                          ),
                          if (br.isHeadOffice) ...[
                            SizedBox(height: 4.h),
                            Container(
                              padding: EdgeInsets.symmetric(
                                horizontal: 6.w,
                                vertical: 2.h,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.amber.shade50,
                                borderRadius: BorderRadius.circular(4.r),
                                border: Border.all(
                                  color: Colors.amber.shade300,
                                ),
                              ),
                              child: Text(
                                'Head Office',
                                style: GoogleFonts.inter(
                                  fontSize: 10.sp,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.amber.shade900,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        }),
      ),
    );
  }

  // ==================== SETTINGS TAB ====================
  Widget _buildSettingsTab() {
    final TextEditingController maxMembersCtrl = TextEditingController(
      text: '${_controller.maxMembersPerGroup.value}',
    );

    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildAnimatedItem(
            index: 0,
            child: Container(
              padding: EdgeInsets.all(16.w),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16.r),
                border: Border.all(color: _green.withOpacity(0.2)),
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
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.all(10.w),
                        decoration: BoxDecoration(
                          color: const Color(0xFFE6F5EC),
                          borderRadius: BorderRadius.circular(12.r),
                        ),
                        child: Icon(
                          Icons.group_work_rounded,
                          color: _green,
                          size: 24.sp,
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Group Capacity Settings',
                              style: GoogleFonts.inter(
                                fontSize: 16.sp,
                                fontWeight: FontWeight.w700,
                                color: _darkText,
                              ),
                            ),
                            SizedBox(height: 2.h),
                            Text(
                              'Used to determine group capacity across group creation (Centers → Groups) and client group assignment (Client Operations → Group Assignment). Full groups are hidden from assignment dropdowns.',
                              style: GoogleFonts.inter(
                                fontSize: 11.sp,
                                color: _muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 16.h),
                  Divider(color: Colors.grey.shade200, height: 1),
                  SizedBox(height: 16.h),
                  Text(
                    'Maximum Members Per Group',
                    style: GoogleFonts.inter(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 8.h),
                  Obx(() {
                    maxMembersCtrl.text =
                        '${_controller.maxMembersPerGroup.value}';
                    return TextField(
                      controller: maxMembersCtrl,
                      keyboardType: TextInputType.number,
                      decoration: InputDecoration(
                        hintText: 'e.g. 5',
                        suffixIcon: const Icon(
                          Icons.people_alt_rounded,
                          color: _green,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10.r),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10.r),
                          borderSide: const BorderSide(color: _green, width: 2),
                        ),
                      ),
                    );
                  }),
                  SizedBox(height: 8.h),
                  Text(
                    'Between 1 and 100. Counts ACTIVE clients only — clients marked inactive no longer occupy a capacity slot. New groups are created manually from Centers → Groups; this setting only affects how full an existing group can get.',
                    style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                  ),
                  SizedBox(height: 20.h),
                  Obx(
                    () => SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: _controller.isSaving.value
                            ? null
                            : () async {
                                final val = int.tryParse(
                                  maxMembersCtrl.text.trim(),
                                );
                                if (val == null || val < 1 || val > 100) {
                                  Get.snackbar(
                                    'Invalid Value',
                                    'Maximum members per group must be a whole number between 1 and 100.',
                                    backgroundColor: Colors.red,
                                    colorText: Colors.white,
                                  );
                                  return;
                                }
                                await _controller.saveGroupAssignmentSettings(
                                  val,
                                );
                              },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: _green,
                          padding: EdgeInsets.symmetric(vertical: 12.h),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10.r),
                          ),
                        ),
                        icon: _controller.isSaving.value
                            ? SizedBox(
                                width: 18.w,
                                height: 18.w,
                                child: const CircularProgressIndicator(
                                  color: Colors.white,
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(
                                Icons.save_rounded,
                                color: Colors.white,
                              ),
                        label: Text(
                          _controller.isSaving.value
                              ? 'Saving Settings…'
                              : 'Save Settings',
                          style: GoogleFonts.inter(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      ),
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

  // ==================== HELPER WIDGETS ====================

  Widget _buildFAB(String label, VoidCallback onPressed) {
    return FloatingActionButton.extended(
      onPressed: onPressed,
      backgroundColor: _green,
      icon: const Icon(Icons.add, color: Colors.white),
      label: Text(
        label,
        style: GoogleFonts.inter(
          color: Colors.white,
          fontWeight: FontWeight.w600,
          fontSize: 13.sp,
        ),
      ),
    );
  }

  Widget _buildAnimatedItem({required int index, required Widget child}) {
    return TweenAnimationBuilder(
      duration: Duration(milliseconds: 400 + (index * 80)),
      curve: Curves.easeOutCubic,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) => Opacity(
        opacity: value,
        child: Transform.translate(
          offset: Offset(30 * (1 - value), 0),
          child: child,
        ),
      ),
      child: child,
    );
  }

  Widget _buildStatusBadge(bool isActive) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
      decoration: BoxDecoration(
        color: isActive ? const Color(0xFFECFDF5) : Colors.red.shade50,
        borderRadius: BorderRadius.circular(20.r),
        border: Border.all(
          color: isActive ? const Color(0xFFA7F3D0) : Colors.red.shade300,
        ),
      ),
      child: Text(
        isActive ? 'Active' : 'Inactive',
        style: GoogleFonts.inter(
          fontSize: 11.sp,
          fontWeight: FontWeight.w600,
          color: isActive ? const Color(0xFF047857) : Colors.red.shade700,
        ),
      ),
    );
  }

  Widget _buildEmptyState(String title, String desc) {
    return Center(
      child: Padding(
        padding: EdgeInsets.all(32.w),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.inventory_2_outlined,
              size: 56.sp,
              color: Colors.grey.shade400,
            ),
            SizedBox(height: 16.h),
            Text(
              title,
              style: GoogleFonts.inter(
                fontSize: 16.sp,
                fontWeight: FontWeight.w700,
                color: _darkText,
              ),
            ),
            SizedBox(height: 6.h),
            Text(
              desc,
              textAlign: TextAlign.center,
              style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
            ),
          ],
        ),
      ),
    );
  }

  // ==================== DIALOGS ====================

  void _showAddRegionDialog() {
    final nameCtrl = TextEditingController();
    final codeCtrl = TextEditingController();

    Get.dialog(
      _buildModernDialog(
        icon: Icons.map_rounded,
        title: 'Add New Region',
        subtitle: 'Create a top-level geographic region',
        children: [
          _buildDialogField(
            controller: nameCtrl,
            label: 'Region Name',
            hint: 'e.g. Central Tamil Nadu',
            icon: Icons.map_outlined,
          ),
          SizedBox(height: 14.h),
          _buildDialogField(
            controller: codeCtrl,
            label: 'Region Code',
            hint: 'e.g. CTN',
            icon: Icons.qr_code_rounded,
          ),
        ],
        onConfirm: () async {
          if (nameCtrl.text.trim().isEmpty || codeCtrl.text.trim().isEmpty) {
            Get.snackbar(
              'Error',
              'Region Name and Code are required',
              backgroundColor: Colors.red,
              colorText: Colors.white,
            );
            return;
          }
          final ok = await _controller.createRegion(
            nameCtrl.text.trim(),
            codeCtrl.text.trim(),
          );
          if (ok && (Get.isDialogOpen ?? false)) Get.back();
        },
      ),
    );
  }

  void _showAddDivisionDialog() {
    final nameCtrl = TextEditingController();
    final codeCtrl = TextEditingController();
    String? selectedRegionId;

    if (_controller.regions.isEmpty) {
      _controller.loadRegions();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.account_tree_rounded,
            title: 'Add New Division',
            subtitle: 'Map an administrative division under a region',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Division Name',
                hint: 'e.g. Trichy Division',
                icon: Icons.account_tree_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Division Code',
                hint: 'e.g. DIV-01',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Select Parent Region',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String>(
                  value: selectedRegionId,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'Choose Region',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.map_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: _controller.regions.map((r) {
                    return DropdownMenuItem<String>(
                      value: r.id,
                      child: Text('${r.name} (${r.code})'),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => selectedRegionId = val),
                ),
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty ||
                  codeCtrl.text.trim().isEmpty ||
                  selectedRegionId == null) {
                Get.snackbar(
                  'Error',
                  'Please fill all fields including parent region',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final ok = await _controller.createDivision(
                nameCtrl.text.trim(),
                codeCtrl.text.trim(),
                selectedRegionId!,
              );
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  void _showAddAreaDialog() {
    final nameCtrl = TextEditingController();
    final codeCtrl = TextEditingController();
    String? selectedDivisionId;

    if (_controller.divisions.isEmpty) {
      _controller.loadDivisions();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.folder_copy_rounded,
            title: 'Add New Area',
            subtitle: 'Map an operational area under a division',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Area Name',
                hint: 'e.g. Srirangam Area',
                icon: Icons.folder_open_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Area Code',
                hint: 'e.g. AREA-01',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Select Parent Division',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String>(
                  value: selectedDivisionId,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'Choose Division',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.account_tree_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: _controller.divisions.map((d) {
                    return DropdownMenuItem<String>(
                      value: d.id,
                      child: Text('${d.name} (${d.code})'),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => selectedDivisionId = val),
                ),
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty ||
                  codeCtrl.text.trim().isEmpty ||
                  selectedDivisionId == null) {
                Get.snackbar(
                  'Error',
                  'Please fill all fields including parent division',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final ok = await _controller.createArea(
                nameCtrl.text.trim(),
                codeCtrl.text.trim(),
                selectedDivisionId!,
              );
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  void _showAddBranchDialog() {
    final autoCode = _controller.generateNextBranchCode();
    final nameCtrl = TextEditingController();
    final codeCtrl = TextEditingController(text: autoCode);
    final addressCtrl = TextEditingController();
    String? selectedAreaId;

    if (_controller.areas.isEmpty) {
      _controller.loadAreas();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.storefront_rounded,
            title: 'Create New Branch',
            subtitle: 'Register a new operational branch unit',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Branch Name *',
                hint: 'Enter branch name',
                icon: Icons.storefront_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Branch ID *',
                hint: 'Auto-generated branch code',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Area (optional)',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String?>(
                  value: selectedAreaId,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'None / Unassigned',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.folder_open_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: [
                    DropdownMenuItem<String?>(
                      value: null,
                      child: Text(
                        'None / Unassigned',
                        style: GoogleFonts.inter(color: Colors.grey.shade600),
                      ),
                    ),
                    ..._controller.areas.map((a) {
                      return DropdownMenuItem<String?>(
                        value: a.id,
                        child: Text('${a.name} (${a.code})'),
                      );
                    }),
                  ],
                  onChanged: (val) => setState(() => selectedAreaId = val),
                ),
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: addressCtrl,
                label: 'Address (optional)',
                hint: 'Enter branch address (optional)',
                icon: Icons.location_on_outlined,
                maxLines: 2,
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty) {
                Get.snackbar(
                  'Error',
                  'Branch Name is required',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final payload = <String, dynamic>{
                'name': nameCtrl.text.trim(),
                if (codeCtrl.text.trim().isNotEmpty)
                  'code': codeCtrl.text.trim().toUpperCase(),
                if (addressCtrl.text.trim().isNotEmpty)
                  'address': addressCtrl.text.trim(),
                if (selectedAreaId != null && selectedAreaId!.isNotEmpty)
                  'areaId': selectedAreaId,
              };
              final ok = await _controller.createBranch(payload);
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  void _showEditRegionDialog(RegionModel reg) {
    final nameCtrl = TextEditingController(text: reg.name);
    final codeCtrl = TextEditingController(text: reg.code);

    Get.dialog(
      _buildModernDialog(
        icon: Icons.edit_rounded,
        title: 'Edit Region',
        subtitle: 'Update region details for ${reg.name}',
        confirmLabel: 'Update',
        children: [
          _buildDialogField(
            controller: nameCtrl,
            label: 'Region Name',
            hint: 'e.g. Central Tamil Nadu',
            icon: Icons.map_outlined,
          ),
          SizedBox(height: 14.h),
          _buildDialogField(
            controller: codeCtrl,
            label: 'Region Code',
            hint: 'e.g. CTN',
            icon: Icons.qr_code_rounded,
          ),
        ],
        onConfirm: () async {
          if (nameCtrl.text.trim().isEmpty || codeCtrl.text.trim().isEmpty) {
            Get.snackbar(
              'Error',
              'Region Name and Code are required',
              backgroundColor: Colors.red,
              colorText: Colors.white,
            );
            return;
          }
          final ok = await _controller.updateRegion(
            reg.id,
            nameCtrl.text.trim(),
            codeCtrl.text.trim(),
          );
          if (ok && (Get.isDialogOpen ?? false)) Get.back();
        },
      ),
    );
  }

  void _showEditDivisionDialog(DivisionModel div) {
    final nameCtrl = TextEditingController(text: div.name);
    final codeCtrl = TextEditingController(text: div.code);
    String? selectedRegionId = div.regionId.isNotEmpty ? div.regionId : null;

    if (_controller.regions.isEmpty) {
      _controller.loadRegions();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.edit_rounded,
            title: 'Edit Division',
            subtitle: 'Update division details for ${div.name}',
            confirmLabel: 'Update',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Division Name',
                hint: 'e.g. Trichy Division',
                icon: Icons.account_tree_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Division Code',
                hint: 'e.g. DIV-01',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Select Parent Region',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String>(
                  value:
                      _controller.regions.any((r) => r.id == selectedRegionId)
                      ? selectedRegionId
                      : null,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'Choose Region',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.map_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: _controller.regions.map((r) {
                    return DropdownMenuItem<String>(
                      value: r.id,
                      child: Text('${r.name} (${r.code})'),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => selectedRegionId = val),
                ),
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty ||
                  codeCtrl.text.trim().isEmpty ||
                  selectedRegionId == null) {
                Get.snackbar(
                  'Error',
                  'Please fill all fields including parent region',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final ok = await _controller.updateDivision(
                div.id,
                nameCtrl.text.trim(),
                codeCtrl.text.trim(),
                selectedRegionId!,
              );
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  void _showEditAreaDialog(AreaModel area) {
    final nameCtrl = TextEditingController(text: area.name);
    final codeCtrl = TextEditingController(text: area.code);
    String? selectedDivisionId = area.divisionId.isNotEmpty
        ? area.divisionId
        : null;

    if (_controller.divisions.isEmpty) {
      _controller.loadDivisions();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.edit_rounded,
            title: 'Edit Area',
            subtitle: 'Update area details for ${area.name}',
            confirmLabel: 'Update',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Area Name',
                hint: 'e.g. Srirangam Area',
                icon: Icons.folder_open_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Area Code',
                hint: 'e.g. AREA-01',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Select Parent Division',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String>(
                  value:
                      _controller.divisions.any(
                        (d) => d.id == selectedDivisionId,
                      )
                      ? selectedDivisionId
                      : null,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'Choose Division',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.account_tree_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: _controller.divisions.map((d) {
                    return DropdownMenuItem<String>(
                      value: d.id,
                      child: Text('${d.name} (${d.code})'),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => selectedDivisionId = val),
                ),
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty ||
                  codeCtrl.text.trim().isEmpty ||
                  selectedDivisionId == null) {
                Get.snackbar(
                  'Error',
                  'Please fill all fields including parent division',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final ok = await _controller.updateArea(
                area.id,
                nameCtrl.text.trim(),
                codeCtrl.text.trim(),
                selectedDivisionId!,
              );
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  void _showEditBranchDialog(BranchModel br) {
    final nameCtrl = TextEditingController(text: br.name);
    final codeCtrl = TextEditingController(text: br.code);
    final addressCtrl = TextEditingController(text: br.address);
    String? selectedAreaId = br.areaId != null && br.areaId!.isNotEmpty
        ? br.areaId
        : null;

    if (_controller.areas.isEmpty) {
      _controller.loadAreas();
    }

    Get.dialog(
      StatefulBuilder(
        builder: (context, setState) {
          return _buildModernDialog(
            icon: Icons.edit_rounded,
            title: 'Edit Branch',
            subtitle: 'Update branch details for ${br.name}',
            confirmLabel: 'Update',
            children: [
              _buildDialogField(
                controller: nameCtrl,
                label: 'Branch Name',
                hint: 'e.g. Srirangam Main Branch',
                icon: Icons.storefront_outlined,
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: codeCtrl,
                label: 'Branch Code',
                hint: 'e.g. BR005',
                icon: Icons.qr_code_rounded,
              ),
              SizedBox(height: 14.h),
              Text(
                'Select Operating Area',
                style: GoogleFonts.inter(
                  fontSize: 12.sp,
                  fontWeight: FontWeight.w600,
                  color: _darkText,
                ),
              ),
              SizedBox(height: 6.h),
              Obx(
                () => DropdownButtonFormField<String>(
                  value: _controller.areas.any((a) => a.id == selectedAreaId)
                      ? selectedAreaId
                      : null,
                  style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
                  decoration: InputDecoration(
                    hintText: 'Choose Area',
                    hintStyle: GoogleFonts.inter(
                      fontSize: 12.sp,
                      color: Colors.grey.shade400,
                    ),
                    prefixIcon: Icon(
                      Icons.folder_open_outlined,
                      size: 18.sp,
                      color: _green,
                    ),
                    filled: true,
                    fillColor: _lightBg,
                    contentPadding: EdgeInsets.symmetric(
                      horizontal: 12.w,
                      vertical: 10.h,
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: BorderSide(color: Colors.grey.shade200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10.r),
                      borderSide: const BorderSide(color: _green, width: 1.5),
                    ),
                  ),
                  items: _controller.areas.map((a) {
                    return DropdownMenuItem<String>(
                      value: a.id,
                      child: Text('${a.name} (${a.code})'),
                    );
                  }).toList(),
                  onChanged: (val) => setState(() => selectedAreaId = val),
                ),
              ),
              SizedBox(height: 14.h),
              _buildDialogField(
                controller: addressCtrl,
                label: 'Branch Address',
                hint: 'Street, city & pincode address',
                icon: Icons.location_on_outlined,
                maxLines: 2,
              ),
            ],
            onConfirm: () async {
              if (nameCtrl.text.trim().isEmpty ||
                  codeCtrl.text.trim().isEmpty) {
                Get.snackbar(
                  'Error',
                  'Branch Name and Code are required',
                  backgroundColor: Colors.red,
                  colorText: Colors.white,
                );
                return;
              }
              final ok = await _controller.updateBranch(br.id, {
                'name': nameCtrl.text.trim(),
                'code': codeCtrl.text.trim().toUpperCase(),
                'address': addressCtrl.text.trim(),
                if (selectedAreaId != null) 'areaId': selectedAreaId,
              });
              if (ok && (Get.isDialogOpen ?? false)) Get.back();
            },
          );
        },
      ),
    );
  }

  Widget _buildModernDialog({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Widget> children,
    required VoidCallback onConfirm,
    String confirmLabel = 'Create',
  }) {
    return TweenAnimationBuilder(
      duration: const Duration(milliseconds: 350),
      curve: Curves.easeOutBack,
      tween: Tween<double>(begin: 0.0, end: 1.0),
      builder: (context, value, child) => Transform.scale(
        scale: value,
        child: Opacity(opacity: value.clamp(0.0, 1.0), child: child),
      ),
      child: Dialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(20.r),
        ),
        elevation: 10,
        backgroundColor: Colors.white,
        child: Container(
          width: 340.w,
          constraints: BoxConstraints(maxHeight: 580.h),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Header
              Container(
                padding: EdgeInsets.fromLTRB(16.w, 16.h, 12.w, 14.h),
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [_green, _greenLight],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.vertical(
                    top: Radius.circular(20.r),
                  ),
                ),
                child: Row(
                  children: [
                    Container(
                      padding: EdgeInsets.all(8.w),
                      decoration: BoxDecoration(
                        color: Colors.white.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(10.r),
                      ),
                      child: Icon(icon, color: Colors.white, size: 20.sp),
                    ),
                    SizedBox(width: 12.w),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: GoogleFonts.inter(
                              fontSize: 15.sp,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          SizedBox(height: 2.h),
                          Text(
                            subtitle,
                            style: GoogleFonts.inter(
                              fontSize: 11.sp,
                              color: Colors.white.withOpacity(0.85),
                            ),
                          ),
                        ],
                      ),
                    ),
                    GestureDetector(
                      onTap: () => Get.back(),
                      child: Container(
                        padding: EdgeInsets.all(4.w),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.15),
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.close_rounded,
                          color: Colors.white,
                          size: 16.sp,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Content Body
              Flexible(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(18.w, 18.h, 18.w, 12.h),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: children,
                  ),
                ),
              ),

              // Actions Footer
              Padding(
                padding: EdgeInsets.fromLTRB(18.w, 0, 18.w, 18.h),
                child: Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Get.back(),
                        style: OutlinedButton.styleFrom(
                          padding: EdgeInsets.symmetric(vertical: 12.h),
                          side: BorderSide(color: Colors.grey.shade300),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10.r),
                          ),
                        ),
                        child: Text(
                          'Cancel',
                          style: GoogleFonts.inter(
                            fontSize: 13.sp,
                            fontWeight: FontWeight.w600,
                            color: _muted,
                          ),
                        ),
                      ),
                    ),
                    SizedBox(width: 10.w),
                    Expanded(
                      flex: 2,
                      child: Obx(
                        () => ElevatedButton(
                          onPressed: _controller.isSaving.value
                              ? null
                              : onConfirm,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _green,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                          ),
                          child: _controller.isSaving.value
                              ? SizedBox(
                                  width: 18.w,
                                  height: 18.w,
                                  child: const CircularProgressIndicator(
                                    color: Colors.white,
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(
                                  confirmLabel,
                                  style: GoogleFonts.inter(
                                    fontSize: 13.sp,
                                    fontWeight: FontWeight.w700,
                                    color: Colors.white,
                                  ),
                                ),
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
    );
  }

  Widget _buildDialogField({
    required TextEditingController controller,
    required String label,
    required String hint,
    required IconData icon,
    int maxLines = 1,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.inter(
            fontSize: 12.sp,
            fontWeight: FontWeight.w600,
            color: _darkText,
          ),
        ),
        SizedBox(height: 6.h),
        TextField(
          controller: controller,
          maxLines: maxLines,
          style: GoogleFonts.inter(fontSize: 13.sp, color: _darkText),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: GoogleFonts.inter(
              fontSize: 12.sp,
              color: Colors.grey.shade400,
            ),
            prefixIcon: Icon(icon, size: 18.sp, color: _green),
            filled: true,
            fillColor: _lightBg,
            contentPadding: EdgeInsets.symmetric(
              horizontal: 12.w,
              vertical: 10.h,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: BorderSide(color: Colors.grey.shade200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: _green, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }

  // ==================== DELETE CONFIRMATION DIALOGS ====================

  void _confirmDeleteBranch(BranchModel br) {
    Get.dialog(
      _buildModernDeleteDialog(
        title: 'Delete Branch',
        subtitle: 'Are you sure you want to delete ${br.name} (${br.code})?',
        onConfirm: () async {
          if (Get.isDialogOpen ?? false) Get.back();
          await _controller.deleteBranch(br.id);
        },
      ),
    );
  }

  Widget _buildModernDeleteDialog({
    required String title,
    required String subtitle,
    required VoidCallback onConfirm,
  }) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20.r)),
      clipBehavior: Clip.antiAlias,
      child: Container(
        width: 380.w,
        color: Colors.white,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 16.h),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Color(0xFFDC2626), Color(0xFFEF4444)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Row(
                children: [
                  Container(
                    padding: EdgeInsets.all(8.w),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.2),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.delete_forever_rounded,
                      color: Colors.white,
                      size: 22.sp,
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: GoogleFonts.inter(
                            fontSize: 16.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                        Text(
                          'Confirm Deletion',
                          style: GoogleFonts.inter(
                            fontSize: 12.sp,
                            color: Colors.white.withOpacity(0.85),
                          ),
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    onTap: () => Get.back(),
                    child: Icon(
                      Icons.close_rounded,
                      color: Colors.white,
                      size: 20.sp,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: EdgeInsets.all(20.w),
              child: Column(
                children: [
                  Text(
                    subtitle,
                    textAlign: TextAlign.center,
                    style: GoogleFonts.inter(
                      fontSize: 14.sp,
                      fontWeight: FontWeight.w500,
                      color: _darkText,
                    ),
                  ),
                  SizedBox(height: 20.h),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => Get.back(),
                          style: OutlinedButton.styleFrom(
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            side: BorderSide(color: Colors.grey.shade300),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                          ),
                          child: Text(
                            'Cancel',
                            style: GoogleFonts.inter(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w600,
                              color: _darkText,
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Expanded(
                        child: ElevatedButton(
                          onPressed: onConfirm,
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.red.shade600,
                            padding: EdgeInsets.symmetric(vertical: 12.h),
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10.r),
                            ),
                          ),
                          child: Text(
                            'Delete',
                            style: GoogleFonts.inter(
                              fontSize: 13.sp,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
