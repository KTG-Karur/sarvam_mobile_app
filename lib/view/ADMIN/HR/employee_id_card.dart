// ignore_for_file: deprecated_member_use

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/hr_api_service.dart';

/// Everything the card prints, resolved from the signed-in employee's own
/// profile + document catalog.
class _IdCardData {
  const _IdCardData({
    required this.fullName,
    required this.employeeId,
    required this.designation,
    required this.branchName,
    this.dateOfJoining,
    this.dateOfBirth,
    this.bloodGroup,
    this.emergencyMobile,
    this.address,
    this.photoUrl,
  });

  final String fullName;
  final String employeeId;
  final String designation;
  final String branchName;
  final DateTime? dateOfJoining;
  final DateTime? dateOfBirth;
  final String? bloodGroup;
  final String? emergencyMobile;
  final String? address;

  /// Absolute, ready-to-fetch URL (storage proxy for private keys).
  final String? photoUrl;
}

/// EmployeeIdCardPage — the signed-in employee's identity card (front + back),
/// mirroring the web app's Employee Identity Card. Reached from the HR home
/// bottom navigation.
class EmployeeIdCardPage extends StatefulWidget {
  const EmployeeIdCardPage({super.key});

  @override
  State<EmployeeIdCardPage> createState() => _EmployeeIdCardPageState();
}

class _EmployeeIdCardPageState extends State<EmployeeIdCardPage> {
  static const _darkText = Color(0xFF0F172A);
  static const _muted = Color(0xFF64748B);
  static const _green = Color(0xFF037F35);
  static const _greenDark = Color(0xFF025C27);
  static const _pageBg = Color(0xFFF1F5F9);

  // Native design size of one card (CR80 portrait ratio).
  static const double _cardW = 320;
  static const double _cardH = 507;

  _IdCardData? _data;
  String _token = '';
  String? _error;
  bool _loading = true;
  bool _showBack = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      _token = prefs.getString('accessToken') ?? '';

      final data = await _fetchCardData();
      if (!mounted) return;
      setState(() => _data = data);
    } catch (error) {
      if (mounted) setState(() => _error = error.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  static String? _text(dynamic v) {
    final s = v?.toString().trim();
    return s == null || s.isEmpty ? null : s;
  }

  static String? _photoUrlFor(String? key) {
    if (key == null || key.isEmpty) return null;
    return key.startsWith('http') ? key : Api.storageProxyUrl(key);
  }

  Future<_IdCardData> _fetchCardData() async {
    // Preferred: the dedicated ID-card endpoint (profile + onboarding record
    // + photo in one call, not subject to field-visibility settings).
    try {
      final card = await HrApiService.myIdCard();
      final employeeId = _text(card['employeeId']);
      if (employeeId == null) {
        throw const HrApiException('Your employee ID has not been assigned yet.');
      }
      return _IdCardData(
        fullName: _text(card['fullName']) ?? '',
        employeeId: employeeId,
        designation: _text(card['designation']) ?? 'Staff',
        branchName: _text(card['branchName']) ?? 'Head Office',
        dateOfJoining: DateTime.tryParse(card['dateOfJoining']?.toString() ?? ''),
        dateOfBirth: DateTime.tryParse(card['dateOfBirth']?.toString() ?? ''),
        bloodGroup: _text(card['bloodGroup']),
        emergencyMobile: _text(card['emergencyContactMobile']),
        address: _text(card['address']),
        photoUrl: _photoUrlFor(_text(card['photoKey'])),
      );
    } on HrApiException catch (e) {
      // "No employee ID" is a real answer; anything else (endpoint not
      // deployed yet, transient error) falls back to the plain profile.
      if (e.message.contains('employee ID')) rethrow;
    } catch (_) {}

    final profile = await HrApiService.myEmployeeProfile();
    final userId = _text(profile['id']);
    final employeeId = _text(profile['employeeId']);
    if (userId == null || employeeId == null) {
      throw const HrApiException('Your employee ID has not been assigned yet.');
    }

    String? photoKey;
    try {
      final docs = await HrApiService.employeeDocuments(userId);
      for (final doc in docs.whereType<Map>()) {
        if (doc['category'] == 'KYC' &&
            doc['subtype'] == 'Photo' &&
            doc['fileUrl'] != null) {
          photoKey = doc['fileUrl'].toString();
          break;
        }
      }
    } catch (_) {}

    String nameOf(dynamic map) => map is Map ? (map['name']?.toString() ?? '') : '';

    return _IdCardData(
      fullName: '${profile['firstName'] ?? ''} ${profile['lastName'] ?? ''}'.trim(),
      employeeId: employeeId,
      designation: _text(nameOf(profile['designation'])) ?? 'Staff',
      branchName: _text(nameOf(profile['branch'])) ?? 'Head Office',
      dateOfJoining: DateTime.tryParse(profile['dateOfJoining']?.toString() ?? ''),
      dateOfBirth: DateTime.tryParse(profile['dob']?.toString() ?? ''),
      bloodGroup: _text(profile['bloodGroup']),
      emergencyMobile: _text(profile['emergencyContactMobile']),
      address: _text(profile['address']),
      photoUrl: _photoUrlFor(photoKey ?? _text(profile['profilePhotoUrl'])),
    );
  }

  String _dmy(DateTime? d) {
    if (d == null) return '—';
    final local = d.toLocal();
    return '${local.day.toString().padLeft(2, '0')}-'
        '${local.month.toString().padLeft(2, '0')}-${local.year}';
  }

  void _copyVerifyLink(String employeeId) {
    Clipboard.setData(ClipboardData(text: Api.employeeVerifyUrl(employeeId)));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Verification link copied'),
        backgroundColor: _green,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 1),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _pageBg,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: Colors.white,
      padding: EdgeInsets.fromLTRB(12.w, 10.h, 20.w, 12.h),
      child: Row(
        children: [
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: Icon(Icons.arrow_back_rounded, color: _darkText, size: 22.sp),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Employee ID Card',
                  style: GoogleFonts.inter(
                    fontSize: 17.sp,
                    fontWeight: FontWeight.w700,
                    color: _darkText,
                  ),
                ),
                Text(
                  'Your official identity card',
                  style: GoogleFonts.inter(fontSize: 11.sp, color: _muted),
                ),
              ],
            ),
          ),
          Image.asset(
            'assets/icon/Sarvam_01.png',
            width: 100.w,
            height: 38.h,
            fit: BoxFit.contain,
            alignment: Alignment.centerRight,
          ),
        ],
      ),
    );
  }

  Widget _buildBody() {
    if (_loading) return const Center(child: CircularProgressIndicator(color: _green));
    final data = _data;
    if (_error != null || data == null) {
      return Center(
        child: Padding(
          padding: EdgeInsets.symmetric(horizontal: 32.w),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.badge_outlined, size: 44.sp, color: _muted),
              SizedBox(height: 12.h),
              Text(
                _error ?? 'Unable to load your ID card.',
                textAlign: TextAlign.center,
                style: GoogleFonts.inter(fontSize: 13.sp, color: _muted),
              ),
              SizedBox(height: 16.h),
              OutlinedButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try again'),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        SizedBox(height: 14.h),
        _buildSideToggle(),
        Expanded(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: 20.w, vertical: 14.h),
            // Fixed-size card scaled to whatever the screen has, so nothing
            // is ever cropped or reflowed on small phones.
            child: FittedBox(
              fit: BoxFit.contain,
              child: MediaQuery(
                data: MediaQuery.of(context).copyWith(textScaler: TextScaler.noScaling),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 250),
                  child: KeyedSubtree(
                    key: ValueKey(_showBack),
                    child: _showBack ? _buildBack(data) : _buildFront(data),
                  ),
                ),
              ),
            ),
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(20.w, 0, 20.w, 16.h),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () => _copyVerifyLink(data.employeeId),
              icon: Icon(Icons.link_rounded, size: 18.sp, color: _greenDark),
              label: Text(
                'Copy verification link',
                style: GoogleFonts.inter(
                  fontSize: 13.sp,
                  fontWeight: FontWeight.w600,
                  color: _greenDark,
                ),
              ),
              style: OutlinedButton.styleFrom(
                padding: EdgeInsets.symmetric(vertical: 12.h),
                side: const BorderSide(color: _green),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12.r)),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildSideToggle() {
    Widget segment(String label, bool selected, VoidCallback onTap) {
      return GestureDetector(
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: 96.w,
          height: 34.h,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? _green : Colors.transparent,
            borderRadius: BorderRadius.circular(24.r),
          ),
          child: Text(
            label,
            style: GoogleFonts.inter(
              fontSize: 12.5.sp,
              fontWeight: FontWeight.w700,
              color: selected ? Colors.white : _darkText,
            ),
          ),
        ),
      );
    }

    return Container(
      padding: EdgeInsets.all(3.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(30.r),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.08),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          segment('Front', !_showBack, () => setState(() => _showBack = false)),
          segment('Back', _showBack, () => setState(() => _showBack = true)),
        ],
      ),
    );
  }

  // ── Card chrome ─────────────────────────────────────────────────────────
  Widget _cardShell({required Widget child}) {
    return Container(
      width: _cardW,
      height: _cardH,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFCBD5E1)),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF025C27).withOpacity(0.12),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(15),
        child: Stack(
          children: [
            const Positioned(
              top: 0,
              left: 0,
              child: CustomPaint(size: Size(34, 330), painter: _WavePainter(top: true)),
            ),
            const Positioned(
              bottom: 0,
              right: 0,
              child: CustomPaint(size: Size(34, 260), painter: _WavePainter(top: false)),
            ),
            // Fill the card: a bare Stack child is only as wide as its
            // content and pins to the left edge, which pushed every
            // centred element off-centre.
            Positioned.fill(child: child),
          ],
        ),
      ),
    );
  }

  TextStyle _poppins(double size, {Color color = _darkText, double? letterSpacing}) {
    return GoogleFonts.poppins(
      fontSize: size,
      fontWeight: FontWeight.w700,
      color: color,
      letterSpacing: letterSpacing,
      height: 1.2,
    );
  }

  Widget _logoIcon(double size) {
    return Image.network(
      Api.brandingAssetUrl('logo-icon'),
      width: size,
      height: size,
      fit: BoxFit.contain,
      errorBuilder: (_, __, ___) =>
          Image.asset('assets/icon/icon.png', width: size, height: size, fit: BoxFit.contain),
    );
  }

  // ── Front ───────────────────────────────────────────────────────────────
  Widget _buildFront(_IdCardData d) {
    Widget infoRow(String label, String value, {bool mono = false}) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            SizedBox(width: 136, child: Text(label, style: _poppins(12, color: _green))),
            SizedBox(width: 12, child: Text(':', textAlign: TextAlign.center, style: _poppins(12))),
            Expanded(child: Text(value, style: _poppins(12), maxLines: 1, overflow: TextOverflow.ellipsis)),
          ],
        ),
      );
    }

    return _cardShell(
      child: Column(
        children: [
          const SizedBox(height: 28),
          _logoIcon(56),
          const SizedBox(height: 6),
          Text('SARVAM', style: _poppins(19, letterSpacing: 1.5)),
          const SizedBox(height: 20),
          Container(
            width: 124,
            height: 138,
            decoration: BoxDecoration(
              color: const Color(0xFFE6F5EC).withOpacity(0.3),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0xFFE2E8F0)),
            ),
            clipBehavior: Clip.antiAlias,
            child: _photo(d),
          ),
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              d.fullName.toUpperCase(),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: _poppins(17),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            d.designation,
            textAlign: TextAlign.center,
            style: _poppins(11, color: _muted),
          ),
          const SizedBox(height: 12),
          Text('Employee Code : ${d.employeeId}', style: _poppins(12.5, letterSpacing: 0.4)),
          const SizedBox(height: 34),
          SizedBox(
            width: 256,
            child: Column(
              children: [
                infoRow('Blood Group', d.bloodGroup ?? '—'),
                infoRow('Emergency Contact', d.emergencyMobile ?? '—'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _photo(_IdCardData d) {
    Widget placeholder() => Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.person_rounded, size: 40, color: Color(0xFFCBD5E1)),
            const SizedBox(height: 4),
            Text(
              'PHOTO NOT AVAILABLE',
              textAlign: TextAlign.center,
              style: _poppins(7.5, color: const Color(0xFF94A3B8), letterSpacing: 0.6),
            ),
          ],
        );
    final url = d.photoUrl;
    if (url == null) return placeholder();
    return Image.network(
      url,
      fit: BoxFit.cover,
      // Private storage objects come through the authenticated proxy.
      headers: url.startsWith(Api.baseUrl) && _token.isNotEmpty
          ? {'Authorization': 'Bearer $_token'}
          : null,
      loadingBuilder: (_, child, progress) => progress == null
          ? child
          : const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: _green),
              ),
            ),
      errorBuilder: (_, __, ___) => placeholder(),
    );
  }

  // ── Back ────────────────────────────────────────────────────────────────
  Widget _buildBack(_IdCardData d) {
    Widget metaRow(String label, String value, {int maxLines = 1}) {
      return Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 124,
              child: Text(label, style: _poppins(10.5, color: const Color(0xFF4B5563))),
            ),
            SizedBox(
              width: 12,
              child: Text(':', textAlign: TextAlign.center, style: _poppins(10.5, color: const Color(0xFF4B5563))),
            ),
            Expanded(
              child: Text(
                value,
                maxLines: maxLines,
                overflow: TextOverflow.ellipsis,
                style: _poppins(9.5),
              ),
            ),
          ],
        ),
      );
    }

    return _cardShell(
      child: Padding(
        padding: EdgeInsets.zero,
        child: Column(
          children: [
            // Metadata sits inside the green wave's margin; the blocks below
            // are centred on the full card width.
            Padding(
              padding: const EdgeInsets.fromLTRB(42, 32, 26, 0),
              child: SizedBox(
                height: 118,
                child: Column(
                  children: [
                    metaRow('Date of Joining', _dmy(d.dateOfJoining)),
                    metaRow('Date of Birth', _dmy(d.dateOfBirth)),
                    metaRow('Residential Address', d.address ?? '—', maxLines: 3),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: 256,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    children: [
                      Container(
                        width: 74,
                        height: 74,
                        padding: const EdgeInsets.all(4),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(4),
                          border: Border.all(color: const Color(0xFF059669).withOpacity(0.3)),
                        ),
                        child: QrImageView(
                          data: Api.employeeVerifyUrl(d.employeeId),
                          padding: EdgeInsets.zero,
                          backgroundColor: Colors.white,
                          errorCorrectionLevel: QrErrorCorrectLevel.M,
                          eyeStyle: const QrEyeStyle(
                            eyeShape: QrEyeShape.square,
                            color: Color(0xFF01401B),
                          ),
                          dataModuleStyle: const QrDataModuleStyle(
                            dataModuleShape: QrDataModuleShape.square,
                            color: Color(0xFF01401B),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('SCAN TO VERIFY', style: _poppins(8, color: _green, letterSpacing: 0.6)),
                    ],
                  ),
                  Column(
                    children: [
                      SizedBox(
                        width: 110,
                        height: 74,
                        child: Center(
                          child: Image.network(
                            Api.brandingAssetUrl('authorised-signatory'),
                            height: 52,
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('Authorised Signatory', style: _poppins(9, color: Colors.black)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 34),
            SizedBox(
              width: 256,
              child: Column(
                children: [
                  _logoIcon(44),
                  const SizedBox(height: 6),
                  Text('SARVAM', style: _poppins(16, letterSpacing: 1.2)),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      const Expanded(child: Divider(color: Color(0xFFCBD5E1), height: 1)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 6),
                        child: Text('HEAD OFFICE :', style: _poppins(7.5, color: const Color(0xFF334155), letterSpacing: 0.6)),
                      ),
                      const Expanded(child: Divider(color: Color(0xFFCBD5E1), height: 1)),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Text(
                    'No-188C, Naganampatty Fire Service Road,\nKVP Anna Nagar Opposite, Oddanchatram - 624619.',
                    textAlign: TextAlign.center,
                    style: _poppins(8.5),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '☎ 04553 243227  •  ✉ sarvamheadoffice@gmail.com',
                    textAlign: TextAlign.center,
                    style: _poppins(8),
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

/// The two organic wave accents (green top-left, yellow bottom-right) that
/// frame the card — same path data as the web card's SVGs.
class _WavePainter extends CustomPainter {
  const _WavePainter({required this.top});

  final bool top;

  @override
  void paint(Canvas canvas, Size size) {
    final path = Path();
    if (top) {
      path
        ..moveTo(0, 0)
        ..lineTo(20, 0)
        ..cubicTo(30, 14, 34, 34, 30, 68)
        ..cubicTo(25, 105, 16, 155, 12, 210)
        ..cubicTo(8, 260, 3, 300, 0, 330)
        ..close();
    } else {
      path
        ..moveTo(34, 260)
        ..lineTo(14, 260)
        ..cubicTo(4, 246, 0, 226, 5, 195)
        ..cubicTo(9, 160, 18, 110, 24, 60)
        ..cubicTo(28, 28, 31, 12, 34, 0)
        ..close();
    }
    canvas.drawPath(
      path,
      Paint()..color = top ? const Color(0xFF037F35) : const Color(0xFFFEBA02),
    );
  }

  @override
  bool shouldRepaint(covariant _WavePainter oldDelegate) => oldDelegate.top != top;
}
