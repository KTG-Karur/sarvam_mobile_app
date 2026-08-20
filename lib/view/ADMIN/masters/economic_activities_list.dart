import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:get/get.dart';
import 'package:sarvam/controller/admin/admin_master_controller.dart';

class EconomicActivitiesList extends StatefulWidget {
  const EconomicActivitiesList({super.key});

  @override
  State<EconomicActivitiesList> createState() => _EconomicActivitiesListState();
}

class _EconomicActivitiesListState extends State<EconomicActivitiesList> {
  final AdminMasterController _controller = Get.put(AdminMasterController());
  final TextEditingController _searchController = TextEditingController();
  String _filterQuery = '';

  static const _primaryGreen = Color(0xFF0D6842);
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _lightBg = Color(0xFFF8FAFC);

  @override
  void initState() {
    super.initState();
    _controller.loadEconomicActivities();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _lightBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: _darkText, size: 20),
          onPressed: () => Get.back(),
        ),
        title: Text(
          'Economic Activities Master',
          style: GoogleFonts.inter(
            fontSize: 18.sp,
            fontWeight: FontWeight.w700,
            color: _darkText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _primaryGreen),
            onPressed: () => _controller.loadEconomicActivities(),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            _buildSearchBar(),
            Expanded(
              child: Obx(() {
                if (_controller.isLoading.value) {
                  return const Center(
                    child: CircularProgressIndicator(color: _primaryGreen),
                  );
                }

                final filtered = _controller.economicActivities.where((activity) {
                  final query = _filterQuery.toLowerCase();
                  return activity.activityName.toLowerCase().contains(query) ||
                      activity.activityCode.toLowerCase().contains(query) ||
                      activity.activityType.toLowerCase().contains(query);
                }).toList();

                if (filtered.isEmpty) {
                  return _buildEmptyState();
                }

                return ListView.separated(
                  padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 12.h),
                  itemCount: filtered.length,
                  separatorBuilder: (context, index) => SizedBox(height: 10.h),
                  itemBuilder: (context, index) {
                    final activity = filtered[index];
                    return _buildActivityCard(activity);
                  },
                );
              }),
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
          hintText: 'Search economic activity...',
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

  Widget _buildActivityCard(AdminEconomicActivity activity) {
    return Container(
      padding: EdgeInsets.all(14.w),
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
      child: Row(
        children: [
          Container(
            padding: EdgeInsets.all(10.w),
            decoration: BoxDecoration(
              color: const Color(0xFFB45309).withOpacity(0.1),
              borderRadius: BorderRadius.circular(12.r),
            ),
            child: Icon(Icons.work_outline_rounded, color: const Color(0xFFB45309), size: 20.sp),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  activity.activityName.isNotEmpty ? activity.activityName : 'Trade & Services',
                  style: GoogleFonts.inter(
                    fontSize: 14.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                SizedBox(height: 2.h),
                Text(
                  'Code: ${activity.activityCode.isNotEmpty ? activity.activityCode : 'ACT'} • Type: ${activity.activityType}',
                  style: GoogleFonts.inter(
                    fontSize: 11.sp,
                    color: _muted,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
          Icon(
            activity.isActive ? Icons.check_circle_rounded : Icons.cancel_rounded,
            color: activity.isActive ? const Color(0xFF166534) : const Color(0xFF991B1B),
            size: 20.sp,
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.work_off_outlined, size: 48.sp, color: _muted.withOpacity(0.5)),
          SizedBox(height: 12.h),
          Text(
            'No Economic Activities Found',
            style: GoogleFonts.inter(fontSize: 15.sp, fontWeight: FontWeight.w600, color: _darkText),
          ),
        ],
      ),
    );
  }
}
