import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';

class MemberHouseVerification extends StatefulWidget {
  const MemberHouseVerification({super.key});

  @override
  State<MemberHouseVerification> createState() =>
      _MemberHouseVerificationState();
}

class _MemberHouseVerificationState extends State<MemberHouseVerification>
    with TickerProviderStateMixin {
  static const _green = Color(0xFF00843D);
  static const _darkGreen = Color(0xFF07552C);
  static const _bg = Color(0xFFF4FAF6);
  static const _cardBorder = Color(0xFFDCEEE2);
  static const _muted = Color(0xFF5C7A68);

  static const _houseDocs = ['House Image 1', 'House Image 2', 'House Image 3'];
  static const _nocDocs = [
    'NOC (Gas Bill)',
    'NOC Image 1',
    'NOC Image 2',
    'NOC Image 3',
  ];
  static const _requiredDocs = {'House Image 1', 'NOC (Gas Bill)'};
  static const _allDocs = [..._houseDocs, ..._nocDocs, 'Location QR'];

  final _latitudeController = TextEditingController();
  final _longitudeController = TextEditingController();
  final Map<String, String> _files = {};
  bool _qrGenerated = false;
  bool _isLoading = true;

  late AnimationController _entranceController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _entranceController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fadeAnimation = CurvedAnimation(
      parent: _entranceController,
      curve: Curves.easeOut,
    );
    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.06), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _entranceController,
            curve: Curves.easeOutCubic,
          ),
        );
    Future.delayed(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() => _isLoading = false);
      _entranceController.forward(from: 0);
    });
  }

  @override
  void dispose() {
    _latitudeController.dispose();
    _longitudeController.dispose();
    _entranceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        elevation: 0,
        backgroundColor: _green,
        foregroundColor: Colors.white,
        title: Text(
          'House Hold Assesment)',
          style: GoogleFonts.poppins(
            fontSize: 16.sp,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(
              child: _isLoading
                  ? _buildShimmerLoading()
                  : FadeTransition(
                      opacity: _fadeAnimation,
                      child: SlideTransition(
                        position: _slideAnimation,
                        child: _buildContent(),
                      ),
                    ),
            ),
            _bottomActions(),
          ],
        ),
      ),
    );
  }

  Widget _buildContent() => SingleChildScrollView(
    padding: EdgeInsets.all(14.w),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _progressBanner(),
        SizedBox(height: 14.h),
        _sectionCard(
          icon: Icons.home_work_outlined,
          title: 'House Photos',
          subtitle: 'Clear photos of the house exterior/interior.',
          children: _houseDocs
              .map(
                (label) => Padding(
                  padding: EdgeInsets.only(bottom: 10.h),
                  child: _uploadTile(
                    label,
                    required: _requiredDocs.contains(label),
                  ),
                ),
              )
              .toList(),
        ),
        SizedBox(height: 14.h),
        _sectionCard(
          icon: Icons.description_outlined,
          title: 'NOC Documents',
          subtitle: 'Gas bill and supporting NOC documents.',
          children: _nocDocs
              .map(
                (label) => Padding(
                  padding: EdgeInsets.only(bottom: 10.h),
                  child: _uploadTile(
                    label,
                    required: _requiredDocs.contains(label),
                  ),
                ),
              )
              .toList(),
        ),
        SizedBox(height: 14.h),
        _sectionCard(
          icon: Icons.my_location_outlined,
          title: 'GPS Location',
          subtitle: 'Capture coordinates and generate a map QR.',
          children: [
            _locationFields(),
            SizedBox(height: 10.h),
            _mapsUrlBanner(),
            SizedBox(height: 14.h),
            _uploadTile('Location QR', required: false),
            SizedBox(height: 12.h),
            _generateQrButton(),
            AnimatedSize(
              duration: const Duration(milliseconds: 300),
              curve: Curves.easeOut,
              child: _qrGenerated
                  ? Padding(
                      padding: EdgeInsets.only(top: 12.h),
                      child: _qrPreview(),
                    )
                  : const SizedBox.shrink(),
            ),
          ],
        ),
      ],
    ),
  );

  Widget _buildShimmerLoading() => ListView(
    padding: EdgeInsets.all(14.w),
    children: [
      _shimmerBlock(height: 78.h, radius: 14.r),
      SizedBox(height: 14.h),
      _shimmerBlock(height: 220.h, radius: 16.r),
      SizedBox(height: 14.h),
      _shimmerBlock(height: 260.h, radius: 16.r),
      SizedBox(height: 14.h),
      _shimmerBlock(height: 240.h, radius: 16.r),
    ],
  );

  Widget _shimmerBlock({required double height, required double radius}) =>
      Container(
        width: double.infinity,
        height: height,
        decoration: BoxDecoration(
          color: const Color(0xFFE9F3EC),
          borderRadius: BorderRadius.circular(radius),
        ),
      );

  Widget _progressBanner() {
    final uploaded = _files.length;
    final total = _allDocs.length;
    final ratio = total == 0 ? 0.0 : uploaded / total;
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [_green, _darkGreen],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14.r),
        boxShadow: [
          BoxShadow(
            color: _green.withValues(alpha: 0.25),
            blurRadius: 14.r,
            offset: Offset(0, 6.h),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.fact_check_outlined, color: Colors.white, size: 20.sp),
              SizedBox(width: 8.w),
              Expanded(
                child: Text(
                  'Verification Progress',
                  style: GoogleFonts.poppins(
                    fontSize: 13.sp,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                child: Text(
                  '$uploaded / $total',
                  key: ValueKey(uploaded),
                  style: GoogleFonts.poppins(
                    fontSize: 12.sp,
                    fontWeight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 10.h),
          ClipRRect(
            borderRadius: BorderRadius.circular(6.r),
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: ratio),
              duration: const Duration(milliseconds: 500),
              curve: Curves.easeOutCubic,
              builder: (context, value, _) => LinearProgressIndicator(
                value: value,
                minHeight: 6.h,
                backgroundColor: Colors.white.withValues(alpha: 0.25),
                valueColor: const AlwaysStoppedAnimation(Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) => Container(
    width: double.infinity,
    padding: EdgeInsets.all(14.w),
    decoration: BoxDecoration(
      color: Colors.white,
      border: Border.all(color: _cardBorder),
      borderRadius: BorderRadius.circular(16.r),
      boxShadow: [
        BoxShadow(
          color: const Color(0xFFE8F6EC),
          blurRadius: 14.r,
          offset: Offset(0, 4.h),
        ),
      ],
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Container(
              width: 34.w,
              height: 34.h,
              decoration: BoxDecoration(
                color: const Color(0xFFE6F5EB),
                borderRadius: BorderRadius.circular(10.r),
              ),
              child: Icon(icon, size: 18.sp, color: _darkGreen),
            ),
            SizedBox(width: 10.w),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.poppins(
                      fontSize: 13.5.sp,
                      fontWeight: FontWeight.w700,
                      color: _darkGreen,
                    ),
                  ),
                  SizedBox(height: 2.h),
                  Text(
                    subtitle,
                    style: GoogleFonts.poppins(
                      fontSize: 10.5.sp,
                      color: _muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        SizedBox(height: 12.h),
        Divider(height: 1, color: _cardBorder),
        SizedBox(height: 12.h),
        ...children,
      ],
    ),
  );

  Widget _uploadTile(String label, {bool required = false}) {
    final fileName = _files[label];
    final uploaded = fileName != null;
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
      padding: EdgeInsets.all(10.w),
      decoration: BoxDecoration(
        color: uploaded ? const Color(0xFFF3FBF6) : const Color(0xFFFAFCFB),
        border: Border.all(
          color: uploaded ? const Color(0xFFB9E2C8) : const Color(0xFFE7EEEA),
        ),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: Row(
        children: [
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 250),
            transitionBuilder: (child, animation) =>
                ScaleTransition(scale: animation, child: child),
            child: Container(
              key: ValueKey(uploaded),
              width: 38.w,
              height: 38.h,
              decoration: BoxDecoration(
                color: uploaded
                    ? const Color(0xFFD9F1E1)
                    : const Color(0xFFEFF3F1),
                borderRadius: BorderRadius.circular(10.r),
              ),
              child: Icon(
                uploaded ? Icons.check_circle : Icons.image_outlined,
                size: 18.sp,
                color: uploaded ? _green : _muted,
              ),
            ),
          ),
          SizedBox(width: 10.w),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.poppins(
                          fontSize: 12.sp,
                          fontWeight: FontWeight.w600,
                          color: const Color(0xFF073E23),
                        ),
                      ),
                    ),
                    SizedBox(width: 4.w),
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 5.w,
                        vertical: 1.h,
                      ),
                      decoration: BoxDecoration(
                        color: required
                            ? const Color(0xFFFDE7E7)
                            : const Color(0xFFEFF3F1),
                        borderRadius: BorderRadius.circular(4.r),
                      ),
                      child: Text(
                        required ? 'Required' : 'Optional',
                        style: GoogleFonts.poppins(
                          fontSize: 8.5.sp,
                          fontWeight: FontWeight.w600,
                          color: required ? const Color(0xFFE5484D) : _muted,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 2.h),
                Text(
                  fileName ?? 'No file selected',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.poppins(
                    fontSize: 10.sp,
                    color: uploaded ? _green : _muted,
                  ),
                ),
              ],
            ),
          ),
          SizedBox(width: 6.w),
          _smallIcon(
            Icons.camera_alt_outlined,
            () => _selectFile(label, camera: true),
          ),
          SizedBox(width: 6.w),
          _smallIcon(
            uploaded ? Icons.delete_outline : Icons.upload_file_outlined,
            () => uploaded
                ? setState(() => _files.remove(label))
                : _selectFile(label),
          ),
        ],
      ),
    );
  }

  Widget _smallIcon(IconData icon, VoidCallback onTap) => Material(
    color: Colors.white,
    borderRadius: BorderRadius.circular(9.r),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(9.r),
      child: Container(
        width: 30.w,
        height: 30.h,
        decoration: BoxDecoration(
          border: Border.all(color: const Color(0xFFC7E7D2)),
          borderRadius: BorderRadius.circular(9.r),
        ),
        child: Icon(icon, size: 15.sp, color: _darkGreen),
      ),
    ),
  );

  Widget _locationFields() => LayoutBuilder(
    builder: (context, constraints) {
      final wide = constraints.maxWidth >= 360;
      final latitude = _coordinateField(
        'Latitude',
        'e.g. 11.016844',
        Icons.swap_vert,
        _latitudeController,
      );
      final longitude = _coordinateField(
        'Longitude',
        'e.g. 76.955833',
        Icons.swap_horiz,
        _longitudeController,
      );
      final fields = wide
          ? Row(
              children: [
                Expanded(child: latitude),
                SizedBox(width: 10.w),
                Expanded(child: longitude),
              ],
            )
          : Column(
              children: [
                latitude,
                SizedBox(height: 10.h),
                longitude,
              ],
            );
      return Column(
        children: [
          fields,
          SizedBox(height: 10.h),
          SizedBox(
            height: 42.h,
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: _useCurrentLocation,
              icon: Icon(
                Icons.near_me_outlined,
                size: 16.sp,
                color: _darkGreen,
              ),
              label: Text(
                'Use current location',
                style: GoogleFonts.poppins(
                  fontSize: 11.5.sp,
                  color: _darkGreen,
                ),
              ),
              style: OutlinedButton.styleFrom(
                backgroundColor: const Color(0xFFF5FBF7),
                side: const BorderSide(color: Color(0xFFC7E7D2)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10.r),
                ),
              ),
            ),
          ),
        ],
      );
    },
  );

  Widget _coordinateField(
    String label,
    String hint,
    IconData icon,
    TextEditingController controller,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        label,
        style: GoogleFonts.poppins(
          fontSize: 11.5.sp,
          fontWeight: FontWeight.w600,
          color: const Color(0xFF073E23),
        ),
      ),
      SizedBox(height: 6.h),
      SizedBox(
        height: 44.h,
        child: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(
            decimal: true,
            signed: true,
          ),
          style: GoogleFonts.poppins(fontSize: 11.sp),
          onChanged: (_) => setState(() {}),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: GoogleFonts.poppins(fontSize: 11.sp, color: _muted),
            prefixIcon: Icon(icon, size: 16.sp, color: _darkGreen),
            filled: true,
            fillColor: const Color(0xFFF5FBF7),
            contentPadding: EdgeInsets.symmetric(vertical: 8.h),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: Color(0xFFC7E7D2)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: Color(0xFFC7E7D2)),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10.r),
              borderSide: const BorderSide(color: _green, width: 1.4),
            ),
          ),
        ),
      ),
    ],
  );

  Widget _mapsUrlBanner() => Container(
    width: double.infinity,
    padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 8.h),
    decoration: BoxDecoration(
      color: const Color(0xFFF5FBF7),
      borderRadius: BorderRadius.circular(8.r),
      border: Border.all(color: const Color(0xFFE1F1E8)),
    ),
    child: Row(
      children: [
        Icon(Icons.link, size: 13.sp, color: const Color(0xFF267447)),
        SizedBox(width: 6.w),
        Expanded(
          child: Text(
            _mapsUrl,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.poppins(
              fontSize: 9.5.sp,
              color: const Color(0xFF267447),
            ),
          ),
        ),
      ],
    ),
  );

  Widget _generateQrButton() => SizedBox(
    width: double.infinity,
    child: FilledButton.icon(
      onPressed: () => setState(() => _qrGenerated = true),
      icon: Icon(Icons.qr_code_2_rounded, size: 17.sp),
      label: const Text('Generate & Upload QR'),
      style: FilledButton.styleFrom(
        backgroundColor: _green,
        foregroundColor: Colors.white,
        padding: EdgeInsets.symmetric(vertical: 12.h),
        minimumSize: Size(0, 44.h),
        textStyle: GoogleFonts.poppins(
          fontSize: 11.5.sp,
          fontWeight: FontWeight.w600,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(10.r),
        ),
      ),
    ),
  );

  Widget _qrPreview() => Container(
    width: double.infinity,
    padding: EdgeInsets.all(12.w),
    decoration: BoxDecoration(
      color: const Color(0xFFF0FAF4),
      border: Border.all(color: const Color(0xFFB7E1C5)),
      borderRadius: BorderRadius.circular(10.r),
    ),
    child: Row(
      children: [
        Container(
          width: 56.w,
          height: 56.h,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(8.r),
            border: Border.all(color: const Color(0xFFB7E1C5)),
          ),
          child: Icon(
            Icons.qr_code_2_rounded,
            size: 36.sp,
            color: Colors.black,
          ),
        ),
        SizedBox(width: 12.w),
        Expanded(
          child: Text(
            'Scan to open location in Google Maps.',
            style: GoogleFonts.poppins(fontSize: 10.5.sp, color: _darkGreen),
          ),
        ),
      ],
    ),
  );

  Widget _bottomActions() => Container(
    padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
    decoration: BoxDecoration(
      color: Colors.white,
      border: const Border(top: BorderSide(color: Color(0xFFD1ECDC))),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withValues(alpha: 0.04),
          blurRadius: 8.r,
          offset: Offset(0, -2.h),
        ),
      ],
    ),
    child: SizedBox(
      width: double.infinity,
      child: FilledButton.icon(
        onPressed: () {},
        icon: Icon(Icons.save, size: 16.sp),
        label: Text(
          'Save',
          style: GoogleFonts.poppins(
            fontSize: 13.sp,
            fontWeight: FontWeight.w600,
          ),
        ),
        style: FilledButton.styleFrom(
          backgroundColor: _green,
          foregroundColor: Colors.white,
          minimumSize: Size(0, 46.h),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10.r),
          ),
        ),
      ),
    ),
  );

  String get _mapsUrl {
    final lat = _latitudeController.text.isEmpty
        ? '0.000000'
        : _latitudeController.text;
    final lng = _longitudeController.text.isEmpty
        ? '0.000000'
        : _longitudeController.text;
    return 'Maps URL: https://www.google.com/maps?q=$lat,$lng';
  }

  void _selectFile(String label, {bool camera = false}) => setState(
    () => _files[label] = camera ? 'Camera image.jpg' : 'Selected document.jpg',
  );

  void _useCurrentLocation() => setState(() {
    _latitudeController.text = '11.016844';
    _longitudeController.text = '76.955833';
  });
}
