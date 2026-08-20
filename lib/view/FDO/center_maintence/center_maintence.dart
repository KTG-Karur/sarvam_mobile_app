import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

class CenterMaintence extends StatefulWidget {
  final String processFlowType;
  final String fileNo;
  final String branch;
  final String centerName;
  final String fileDate;

  const CenterMaintence({
    super.key,
    this.processFlowType = 'NWCENL',
    this.fileNo = '202190000007',
    this.branch = '202 - Thiruvarur',
    this.centerName = 'SEMMANKUPPAM',
    this.fileDate = '21/10/2019',
  });

  @override
  State<CenterMaintence> createState() => _CenterMaintenceState();
}

class _CenterMaintenceState extends State<CenterMaintence>
    with SingleTickerProviderStateMixin {
  static const _primaryGreen = Color(0xFF00843D);
  static const _darkGreen = Color(0xFF075E2E);
  static const _headerGreen = Color(0xFF10472A);
  static const _bgLight = Color(0xFFF8FAFC);
  static const _cardBg = Colors.white;
  static const _borderColor = Color(0xFFE2E8F0);

  late TabController _tabController;

  // Controllers for Prospect tab
  late TextEditingController _processFlowController;
  late TextEditingController _fileNoController;
  late TextEditingController _branchController;
  late TextEditingController _centerNameController;
  late TextEditingController _fileDateController;

  // Controllers & State for Address tab
  late TextEditingController _addressController;
  String _selectedLocation = '--Select--';
  String _selectedCenterType = 'New Center';
  String _selectedVillage = '--Select--';
  String _selectedAreaCategory = '--Select--';

  // Controllers & State for Location tab
  late TextEditingController _latitudeController;
  late TextEditingController _longitudeController;
  bool _isFetchingGps = false;

  final _formKey = GlobalKey<FormState>();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);

    _processFlowController = TextEditingController(
      text: widget.processFlowType,
    );
    _fileNoController = TextEditingController(text: widget.fileNo);
    _branchController = TextEditingController(text: widget.branch);
    _centerNameController = TextEditingController(text: widget.centerName);
    _fileDateController = TextEditingController(text: widget.fileDate);

    _addressController = TextEditingController(text: widget.centerName);
    _latitudeController = TextEditingController(text: '13.0441268');
    _longitudeController = TextEditingController(text: '80.2277187');
  }

  @override
  void dispose() {
    _tabController.dispose();
    _processFlowController.dispose();
    _fileNoController.dispose();
    _branchController.dispose();
    _centerNameController.dispose();
    _fileDateController.dispose();

    _addressController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    super.dispose();
  }

  void _saveForm() {
    if (_formKey.currentState?.validate() ?? true) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Row(
            children: [
              const Icon(Icons.check_circle, color: Colors.white),
              SizedBox(width: 8.w),
              const Expanded(
                child: Text('Prospect Maintenance details saved successfully!'),
              ),
            ],
          ),
          backgroundColor: _primaryGreen,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10.r),
          ),
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  void _fetchGps() async {
    setState(() => _isFetchingGps = true);
    await Future.delayed(const Duration(milliseconds: 800));
    if (mounted) {
      setState(() {
        _latitudeController.text = '13.0441268';
        _longitudeController.text = '80.2277187';
        _isFetchingGps = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('GPS Location Updated: 13.0441268, 80.2277187'),
          backgroundColor: _darkGreen,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10.r),
          ),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: _bgLight,
        appBar: AppBar(
          elevation: 0,
          scrolledUnderElevation: 0,
          backgroundColor: _headerGreen,
          leading: IconButton(
            onPressed: () => Navigator.maybePop(context),
            icon: const Icon(
              Icons.arrow_back_ios_new_rounded,
              color: Colors.white,
              size: 20,
            ),
          ),
          title: Text(
            'Prospect Maintenance',
            style: TextStyle(
              fontSize: 18.sp,
              fontWeight: FontWeight.w700,
              color: Colors.white,
              letterSpacing: 0.3,
            ),
          ),
          actions: [
            IconButton(
              onPressed: _saveForm,
              icon: Container(
                padding: EdgeInsets.all(6.w),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.save_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              tooltip: 'Save Maintenance',
            ),
            IconButton(
              onPressed: _fetchGps,
              icon: Container(
                padding: EdgeInsets.all(6.w),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.refresh_rounded,
                  color: Colors.white,
                  size: 20,
                ),
              ),
              tooltip: 'Refresh GPS',
            ),
            SizedBox(width: 8.w),
          ],
        ),
        body: Form(
          key: _formKey,
          child: Column(
            children: [
              // Top Header Banner Card
              _buildTopHeaderCard(),

              // Custom Segmented Pill Tab Bar
              _buildSegmentedTabBar(),

              // Tab Views Content
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    _buildProspectTab(),
                    _buildAddressTab(),
                    _buildLocationTab(),
                  ],
                ),
              ),

              // Bottom Action Bar
              _buildBottomActionBar(),
            ],
          ),
        ),
      ),
    );
  }

  // Modern Top Header Card with Center Info
  Widget _buildTopHeaderCard() {
    return Container(
      width: double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [_headerGreen, _primaryGreen],
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
        ),
      ),
      padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 16.h),
      child: Container(
        padding: EdgeInsets.all(14.w),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.12),
          borderRadius: BorderRadius.circular(14.r),
          border: Border.all(color: Colors.white.withOpacity(0.2)),
        ),
        child: Row(
          children: [
            Container(
              padding: EdgeInsets.all(10.w),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.business_rounded,
                color: Colors.white,
                size: 24.sp,
              ),
            ),
            SizedBox(width: 12.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        _centerNameController.text.toUpperCase(),
                        style: TextStyle(
                          fontSize: 16.sp,
                          fontWeight: FontWeight.w800,
                          color: Colors.white,
                          letterSpacing: 0.5,
                        ),
                      ),
                      const Spacer(),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 3.h,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20.r),
                        ),
                        child: Text(
                          _processFlowController.text,
                          style: TextStyle(
                            fontSize: 10.sp,
                            fontWeight: FontWeight.w800,
                            color: _darkGreen,
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 4.h),
                  Row(
                    children: [
                      Icon(
                        Icons.insert_drive_file_outlined,
                        color: Colors.white70,
                        size: 13.sp,
                      ),
                      SizedBox(width: 4.w),
                      Text(
                        'File: ${_fileNoController.text}',
                        style: TextStyle(
                          fontSize: 11.5.sp,
                          color: Colors.white.withValues(alpha: 0.9),
                        ),
                      ),
                      SizedBox(width: 12.w),
                      Icon(
                        Icons.account_tree_outlined,
                        color: Colors.white70,
                        size: 13.sp,
                      ),
                      SizedBox(width: 4.w),
                      Expanded(
                        child: Text(
                          _branchController.text,
                          style: TextStyle(
                            fontSize: 11.5.sp,
                            color: Colors.white.withValues(alpha: 0.9),
                          ),
                          overflow: TextOverflow.ellipsis,
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

  // Custom Animated Segmented Pill Tab Bar
  Widget _buildSegmentedTabBar() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 10.h),
      child: Container(
        height: 44.h,
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(12.r),
        ),
        child: TabBar(
          controller: _tabController,
          indicator: BoxDecoration(
            color: _primaryGreen,
            borderRadius: BorderRadius.circular(10.r),
            boxShadow: [
              BoxShadow(
                color: _primaryGreen.withOpacity(0.3),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          indicatorSize: TabBarIndicatorSize.tab,
          dividerColor: Colors.transparent,
          labelColor: Colors.white,
          unselectedLabelColor: const Color(0xFF64748B),
          labelStyle: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700),
          unselectedLabelStyle: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w600,
          ),
          tabs: const [
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.description_outlined, size: 16),
                  SizedBox(width: 6),
                  Text('Prospect'),
                ],
              ),
            ),
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.home_work_outlined, size: 16),
                  SizedBox(width: 6),
                  Text('Address'),
                ],
              ),
            ),
            Tab(
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.my_location_rounded, size: 16),
                  SizedBox(width: 6),
                  Text('Location'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // TAB 1: Prospect Details Card
  Widget _buildProspectTab() {
    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        children: [
          _buildCardContainer(
            title: 'Prospect General Info',
            icon: Icons.info_outline_rounded,
            children: [
              _buildModernTextField(
                label: 'Process Flow Type',
                controller: _processFlowController,
                readOnly: true,
                prefixIcon: Icons.account_tree_outlined,
              ),
              SizedBox(height: 14.h),
              _buildModernTextField(
                label: 'File No.',
                controller: _fileNoController,
                readOnly: true,
                prefixIcon: Icons.confirmation_number_outlined,
              ),
              SizedBox(height: 14.h),
              _buildModernTextField(
                label: 'Branch',
                controller: _branchController,
                readOnly: true,
                prefixIcon: Icons.storefront_outlined,
              ),
              SizedBox(height: 14.h),
              _buildModernTextField(
                label: 'Center Name',
                controller: _centerNameController,
                isRequired: true,
                prefixIcon: Icons.location_city_outlined,
              ),
              SizedBox(height: 14.h),
              _buildModernTextField(
                label: 'File Date',
                controller: _fileDateController,
                readOnly: true,
                prefixIcon: Icons.calendar_month_outlined,
                suffixIcon: Icon(
                  Icons.edit_calendar_rounded,
                  color: _primaryGreen,
                  size: 18.sp,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // TAB 2: Address Details Card (Matching Screenshot 1 structure with modern styling)
  Widget _buildAddressTab() {
    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        children: [
          _buildCardContainer(
            title: 'Address & Categorization',
            icon: Icons.map_outlined,
            children: [
              // 1. Address
              _buildModernTextField(
                label: 'Address',
                controller: _addressController,
                prefixIcon: Icons.home_outlined,
              ),
              SizedBox(height: 14.h),

              // 2. Location (Dropdown with Search Icon)
              _buildModernDropdownWithSearch(
                label: 'Location',
                value: _selectedLocation,
                items: [
                  '--Select--',
                  'Cuddalore Main',
                  'Semmankuppam Center',
                  'Thiruvarur Branch',
                ],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedLocation = val);
                },
              ),
              SizedBox(height: 14.h),

              // 3. Center Type Dropdown
              _buildModernDropdown(
                label: 'Center Type',
                value: _selectedCenterType,
                items: ['New Center', 'Renewal Center', 'Existing Center'],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedCenterType = val);
                },
              ),
              SizedBox(height: 14.h),

              // 4. Village Dropdown with Search Icon
              _buildModernDropdownWithSearch(
                label: 'Village',
                value: _selectedVillage,
                items: [
                  '--Select--',
                  'Semmankuppam',
                  'Thiruvarur',
                  'Panruti',
                  'Cuddalore',
                ],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedVillage = val);
                },
              ),
              SizedBox(height: 14.h),

              // 5. Area Category Dropdown
              _buildModernDropdown(
                label: 'Area Category',
                value: _selectedAreaCategory,
                items: ['--Select--', 'Rural', 'Semi-Urban', 'Urban'],
                onChanged: (val) {
                  if (val != null) setState(() => _selectedAreaCategory = val);
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  // TAB 3: Location Details & Embedded Interactive Map (Matching Screenshot 2)
  Widget _buildLocationTab() {
    return SingleChildScrollView(
      padding: EdgeInsets.all(16.w),
      child: Column(
        children: [
          _buildCardContainer(
            title: 'Geo-Coordinates & Live Map',
            icon: Icons.pin_drop_outlined,
            children: [
              Row(
                children: [
                  Expanded(
                    child: _buildModernTextField(
                      label: 'Latitude',
                      controller: _latitudeController,
                      prefixIcon: Icons.navigation_outlined,
                    ),
                  ),
                  SizedBox(width: 12.w),
                  Expanded(
                    child: _buildModernTextField(
                      label: 'Longitude',
                      controller: _longitudeController,
                      prefixIcon: Icons.explore_outlined,
                    ),
                  ),
                ],
              ),
              SizedBox(height: 12.h),

              // Fetch GPS Location Button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isFetchingGps ? null : _fetchGps,
                  icon: _isFetchingGps
                      ? SizedBox(
                          width: 16.w,
                          height: 16.w,
                          child: const CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(Icons.my_location_rounded, size: 18),
                  label: Text(
                    _isFetchingGps
                        ? 'Fetching GPS Coordinates...'
                        : 'Get Current Live GPS Location',
                    style: TextStyle(
                      fontSize: 12.5.sp,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _darkGreen,
                    foregroundColor: Colors.white,
                    padding: EdgeInsets.symmetric(vertical: 12.h),
                    elevation: 1,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                ),
              ),
              SizedBox(height: 14.h),

              // Interactive Embedded Map View Box
              Container(
                height: 220.h,
                width: double.infinity,
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(14.r),
                  border: Border.all(color: _borderColor),
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14.r),
                  child: Stack(
                    children: [
                      CustomPaint(
                        size: Size.infinite,
                        painter: MapBackgroundPainter(),
                      ),

                      // Map Landmark Labels
                      Positioned(
                        top: 15.h,
                        left: 50.w,
                        child: _mapLandmarkChip(
                          'Medway Medical Centre',
                          Colors.red.shade400,
                        ),
                      ),
                      Positioned(
                        top: 75.h,
                        left: 15.w,
                        child: _mapLandmarkChip(
                          'Axis Bank',
                          Colors.blue.shade700,
                        ),
                      ),
                      Positioned(
                        top: 130.h,
                        left: 80.w,
                        child: _mapLandmarkChip(
                          'Shri Navasakthi Vinayagar Temple',
                          Colors.grey.shade700,
                        ),
                      ),
                      Positioned(
                        top: 110.h,
                        right: 25.w,
                        child: _mapLandmarkChip(
                          'Kodambakkam',
                          Colors.blue.shade800,
                        ),
                      ),
                      Positioned(
                        bottom: 40.h,
                        left: 60.w,
                        child: _mapLandmarkChip(
                          'SRM HOSPITAL',
                          Colors.red.shade400,
                        ),
                      ),
                      Positioned(
                        bottom: 25.h,
                        right: 50.w,
                        child: Text(
                          'T. NAGAR',
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w900,
                            color: const Color(0xFF475569),
                            letterSpacing: 1.2,
                          ),
                        ),
                      ),
                      Positioned(
                        bottom: 10.h,
                        left: 110.w,
                        child: _mapLandmarkChip(
                          'Mambalam',
                          Colors.blue.shade700,
                        ),
                      ),

                      // GPS Accuracy Badge
                      Positioned(
                        top: 10.h,
                        right: 10.w,
                        child: Container(
                          padding: EdgeInsets.symmetric(
                            horizontal: 8.w,
                            vertical: 4.h,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20.r),
                            boxShadow: const [
                              BoxShadow(color: Colors.black12, blurRadius: 4),
                            ],
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 6.w,
                                height: 6.w,
                                decoration: const BoxDecoration(
                                  color: _primaryGreen,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              SizedBox(width: 4.w),
                              Text(
                                'GPS High Accuracy',
                                style: TextStyle(
                                  fontSize: 10.sp,
                                  fontWeight: FontWeight.w700,
                                  color: _darkGreen,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      // Red Pin Marker in Center
                      Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: EdgeInsets.all(5.w),
                              decoration: const BoxDecoration(
                                color: Colors.red,
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black26,
                                    blurRadius: 6,
                                    offset: Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: Icon(
                                Icons.location_on,
                                color: Colors.white,
                                size: 26.sp,
                              ),
                            ),
                            Container(
                              width: 8.w,
                              height: 8.w,
                              decoration: const BoxDecoration(
                                color: Colors.black38,
                                shape: BoxShape.circle,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // Card Container Utility
  Widget _buildCardContainer({
    required String title,
    required IconData icon,
    required List<Widget> children,
  }) {
    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(16.r),
        border: Border.all(color: _borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.03),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: EdgeInsets.all(16.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(6.w),
                decoration: BoxDecoration(
                  color: _primaryGreen.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8.r),
                ),
                child: Icon(icon, color: _primaryGreen, size: 18.sp),
              ),
              SizedBox(width: 8.w),
              Text(
                title,
                style: TextStyle(
                  fontSize: 14.5.sp,
                  fontWeight: FontWeight.w700,
                  color: _headerGreen,
                ),
              ),
            ],
          ),
          SizedBox(height: 12.h),
          const Divider(height: 1, color: Color(0xFFF1F5F9)),
          SizedBox(height: 14.h),
          ...children,
        ],
      ),
    );
  }

  // Modern Input Text Field Utility
  Widget _buildModernTextField({
    required String label,
    required TextEditingController controller,
    bool isRequired = false,
    bool readOnly = false,
    IconData? prefixIcon,
    Widget? suffixIcon,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        RichText(
          text: TextSpan(
            text: label.replaceAll(' *', ''),
            style: GoogleFonts.poppins(
              fontSize: 12.5.sp,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF334155),
            ),
            children: isRequired
                ? [
                    TextSpan(
                      text: ' *',
                      style: TextStyle(color: Colors.red, fontSize: 12.5.sp),
                    ),
                  ]
                : [],
          ),
        ),
        SizedBox(height: 6.h),
        TextFormField(
          controller: controller,
          readOnly: readOnly,
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w600,
            color: readOnly ? const Color(0xFF475569) : const Color(0xFF0F172A),
          ),
          decoration: InputDecoration(
            contentPadding: EdgeInsets.symmetric(
              horizontal: 14.w,
              vertical: 12.h,
            ),
            filled: true,
            fillColor: readOnly ? const Color(0xFFF8FAFC) : Colors.white,
            prefixIcon: prefixIcon != null
                ? Icon(
                    prefixIcon,
                    color: readOnly ? const Color(0xFF94A3B8) : _primaryGreen,
                    size: 18.sp,
                  )
                : null,
            suffixIcon: suffixIcon,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: _borderColor),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: BorderSide(
                color: readOnly
                    ? const Color(0xFFE2E8F0)
                    : const Color(0xFFCBD5E1),
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: _primaryGreen, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }

  // Modern Dropdown Utility
  Widget _buildModernDropdown({
    required String label,
    required String value,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 12.5.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF334155),
          ),
        ),
        SizedBox(height: 6.h),
        Container(
          padding: EdgeInsets.symmetric(horizontal: 14.w),
          decoration: BoxDecoration(
            color: const Color(0xFFF8FAFC),
            borderRadius: BorderRadius.circular(10.r),
            border: Border.all(color: const Color(0xFFCBD5E1)),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              isExpanded: true,
              dropdownColor: Colors.white,
              style: TextStyle(
                fontSize: 13.sp,
                fontWeight: FontWeight.w600,
                color: const Color(0xFF0F172A),
              ),
              icon: const Icon(
                Icons.arrow_drop_down_rounded,
                color: Color(0xFF64748B),
              ),
              items: items
                  .map(
                    (item) => DropdownMenuItem(value: item, child: Text(item)),
                  )
                  .toList(),
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }

  // Modern Dropdown with Search Trigger Utility
  Widget _buildModernDropdownWithSearch({
    required String label,
    required String value,
    required List<String> items,
    required ValueChanged<String?> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: GoogleFonts.poppins(
            fontSize: 12.5.sp,
            fontWeight: FontWeight.w600,
            color: const Color(0xFF334155),
          ),
        ),
        SizedBox(height: 6.h),
        Row(
          children: [
            Expanded(
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 14.w),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(10.r),
                  border: Border.all(color: const Color(0xFFCBD5E1)),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String>(
                    value: value,
                    isExpanded: true,
                    dropdownColor: Colors.white,
                    style: TextStyle(
                      fontSize: 13.sp,
                      fontWeight: FontWeight.w600,
                      color: const Color(0xFF0F172A),
                    ),
                    icon: const Icon(
                      Icons.arrow_drop_down_rounded,
                      color: Color(0xFF64748B),
                    ),
                    items: items
                        .map(
                          (item) =>
                              DropdownMenuItem(value: item, child: Text(item)),
                        )
                        .toList(),
                    onChanged: onChanged,
                  ),
                ),
              ),
            ),
            SizedBox(width: 8.w),
            InkWell(
              onTap: () {
                ScaffoldMessenger.of(
                  context,
                ).showSnackBar(SnackBar(content: Text('Search $label...')));
              },
              borderRadius: BorderRadius.circular(10.r),
              child: Container(
                padding: EdgeInsets.all(12.w),
                decoration: BoxDecoration(
                  color: _primaryGreen.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10.r),
                  border: Border.all(color: _primaryGreen.withOpacity(0.3)),
                ),
                child: Icon(
                  Icons.search_rounded,
                  color: _primaryGreen,
                  size: 20.sp,
                ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  // Map Chip Landmark Component
  Widget _mapLandmarkChip(String label, Color color) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.92),
        borderRadius: BorderRadius.circular(4.r),
        boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 2)],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 5.w,
            height: 5.w,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          SizedBox(width: 4.w),
          Text(
            label,
            style: TextStyle(
              fontSize: 9.sp,
              fontWeight: FontWeight.w600,
              color: const Color(0xFF334155),
            ),
          ),
        ],
      ),
    );
  }

  // Floating Bottom Action Bar
  Widget _buildBottomActionBar() {
    return Container(
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.06),
            blurRadius: 10,
            offset: const Offset(0, -3),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: () => Navigator.maybePop(context),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFFCBD5E1)),
                padding: EdgeInsets.symmetric(vertical: 13.h),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
              child: Text(
                'Cancel',
                style: TextStyle(
                  fontSize: 13.5.sp,
                  fontWeight: FontWeight.w700,
                  color: const Color(0xFF475569),
                ),
              ),
            ),
          ),
          SizedBox(width: 12.w),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _saveForm,
              icon: const Icon(
                Icons.check_circle_outline_rounded,
                color: Colors.white,
                size: 18,
              ),
              label: Text(
                'Save Maintenance',
                style: TextStyle(
                  fontSize: 13.5.sp,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: _primaryGreen,
                padding: EdgeInsets.symmetric(vertical: 13.h),
                elevation: 2,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Custom Painter for Map Grid Lines
class MapBackgroundPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final bgPaint = Paint()..color = const Color(0xFFE8ECEF);
    canvas.drawRect(Rect.fromLTWH(0, 0, size.width, size.height), bgPaint);

    final roadPaint = Paint()
      ..color = Colors.white
      ..strokeWidth = 14
      ..style = PaintingStyle.stroke;

    final path1 = Path()
      ..moveTo(0, size.height * 0.3)
      ..lineTo(size.width, size.height * 0.25);

    final path2 = Path()
      ..moveTo(size.width * 0.4, 0)
      ..lineTo(size.width * 0.45, size.height);

    final path3 = Path()
      ..moveTo(0, size.height * 0.75)
      ..quadraticBezierTo(
        size.width * 0.5,
        size.height * 0.8,
        size.width,
        size.height * 0.65,
      );

    canvas.drawPath(path1, roadPaint);
    canvas.drawPath(path2, roadPaint);
    canvas.drawPath(path3, roadPaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
