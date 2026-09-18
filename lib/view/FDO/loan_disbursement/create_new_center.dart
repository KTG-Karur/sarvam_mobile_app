import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/controller/centre_controller.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/secure_session_service.dart';

class CreateNewCenter extends StatefulWidget {
  const CreateNewCenter({super.key});

  @override
  State<CreateNewCenter> createState() => _CreateNewCenterState();
}

class _CreateNewCenterState extends State<CreateNewCenter> {
  static const _green = Color(0xFF00843D);
  final _formKey = GlobalKey<FormState>();

  final CentreController _controller = Get.isRegistered<CentreController>()
      ? Get.find<CentreController>()
      : Get.put(CentreController());

  final _nameController = TextEditingController();
  final _addressController = TextEditingController();
  final _localAreaController = TextEditingController();
  final _meetingPlaceController = TextEditingController();
  final _kmFromBranchController = TextEditingController();
  final _contactPersonController = TextEditingController();
  final _contactNumberController = TextEditingController();
  final _latitudeController = TextEditingController();
  final _longitudeController = TextEditingController();

  final _dateController = TextEditingController();
  final _timeController = TextEditingController(text: '--:--');
  DateTime _formationDate = DateTime.now();
  String? _meetingDay;

  double? _branchLat;
  double? _branchLng;
  List<String> _meetingPlaces = const [
    'Community Hall',
    'Center Lead House',
    'Panchayat Office',
    'School',
    'Temple',
    'Anganwadi',
  ];
  String? _selectedMeetingPlace;

  String _fdoName = '';
  bool _locating = false;
  bool _isCalculatingKm = false;

  @override
  void initState() {
    super.initState();
    _dateController.text = DateFormat('dd-MM-yyyy').format(_formationDate);
    _loadFdoName();
    _loadBranchLocation();
    _loadMeetingPlaces();
  }

  Future<void> _loadFdoName() async {
    final prefs = await SharedPreferences.getInstance();
    final firstName = prefs.getString('firstName') ?? '';
    final lastName = prefs.getString('lastName') ?? '';
    if (!mounted) return;
    setState(() => _fdoName = '$firstName $lastName'.trim());
  }

  Future<void> _loadBranchLocation() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      var branchId = prefs.getString('branchId') ?? '';
      final token = prefs.getString('accessToken') ?? '';

      // Self-heal: branchId is cached at login time, but a same-day MPIN
      // app-resume unlock deliberately doesn't re-send it (see mpin/verify's
      // dual-purpose doc comment), and a logout cycle in between wipes the
      // cache without a fresh full login to repopulate it. The access token
      // itself already carries branchId as a JWT claim, so decode it locally
      // as a fallback rather than leaving the branch lookup permanently
      // stuck once the cache goes stale.
      if (branchId.isEmpty && token.isNotEmpty) {
        final claims = SecureSessionService.decodeJwtPayload(token);
        final claimedBranchId = claims?['branchId']?.toString();
        if (claimedBranchId != null && claimedBranchId.isNotEmpty) {
          branchId = claimedBranchId;
          await prefs.setString('branchId', branchId);
        }
      }
      if (branchId.isEmpty) return;

      final response = await ApiClient().get(
        "${Api.branchesUrl}/$branchId",
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'];
        if (data is Map) {
          final lat = data['latitude'];
          final lng = data['longitude'];
          if (lat != null && lng != null) {
            _branchLat = double.tryParse('$lat');
            _branchLng = double.tryParse('$lng');

            final cLat = double.tryParse(_latitudeController.text);
            final cLng = double.tryParse(_longitudeController.text);
            if (cLat != null && cLng != null) {
              await _autoCalculateKmFromBranch(cLat, cLng);
            }
          }
        }
      }
    } catch (e) {
      debugPrint("Error loading branch location: $e");
    }
  }

  Future<void> _loadMeetingPlaces() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';

      final response = await ApiClient().get(
        "${Api.meetingPlacesUrl}?includeInactive=false",
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 200 && response.body != null) {
        final data = response.body['data'];
        if (data is List) {
          final fetched = data
              .whereType<Map>()
              .map((e) => (e['name'] ?? e['placeName'] ?? '').toString())
              .where((name) => name.isNotEmpty)
              .toList();
          if (fetched.isNotEmpty && mounted) {
            setState(() {
              final combined = <String>{..._meetingPlaces, ...fetched};
              _meetingPlaces = combined.toList();
            });
          }
        }
      }
    } catch (e) {
      debugPrint("Error loading meeting places: $e");
    }
  }

  double _haversineKm(double lat1, double lon1, double lat2, double lon2) {
    const R = 6371.0;
    final dLat = (lat2 - lat1) * math.pi / 180.0;
    final dLon = (lon2 - lon1) * math.pi / 180.0;
    final a = math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(lat1 * math.pi / 180.0) *
            math.cos(lat2 * math.pi / 180.0) *
            math.sin(dLon / 2) *
            math.sin(dLon / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return R * c;
  }

  /// Matches the web Center form's applyAutoKm(): fetches actual road
  /// (driving) distance from the backend — the same number the same two
  /// points would show as driving distance on Google Maps — rather than a
  /// straight-line estimate. Falls back to local straight-line (haversine)
  /// distance if the routing lookup fails, and flags that to the user so
  /// the number isn't silently a different kind of measurement than usual.
  Future<void> _autoCalculateKmFromBranch(double centerLat, double centerLng) async {
    if (_branchLat == null || _branchLng == null) return;
    if (mounted) setState(() => _isCalculatingKm = true);

    void notifyStraightLineFallback() => Get.snackbar(
          'Road distance unavailable',
          'Could not reach the routing service — showing straight-line distance instead.',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.orange,
          colorText: Colors.white,
        );

    // Only used when the API call itself failed (network error, non-200,
    // unparseable body) — if the API responded but had to fall back
    // server-side, its own distanceKm is used as-is instead of recomputing.
    void computeLocalFallback() {
      final distance = _haversineKm(_branchLat!, _branchLng!, centerLat, centerLng);
      if (!mounted) return;
      setState(() => _kmFromBranchController.text = distance.toStringAsFixed(2));
      notifyStraightLineFallback();
    }

    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString('accessToken') ?? '';
      final uri = Uri.parse(Api.geoDrivingDistanceUrl).replace(queryParameters: {
        'fromLat': '$_branchLat',
        'fromLng': '$_branchLng',
        'toLat': '$centerLat',
        'toLng': '$centerLng',
      });
      final response = await ApiClient().get(
        uri.toString(),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (!mounted) return;
      dynamic data;
      if (response.statusCode == 200 && response.body != null) {
        data = response.body['data'];
      }
      final distanceKm = data is Map ? double.tryParse('${data['distanceKm']}') : null;
      if (distanceKm != null) {
        setState(() => _kmFromBranchController.text = distanceKm.toStringAsFixed(2));
        if (data['source'] == 'straight-line') {
          notifyStraightLineFallback();
        }
      } else {
        computeLocalFallback();
      }
    } catch (_) {
      computeLocalFallback();
    } finally {
      if (mounted) setState(() => _isCalculatingKm = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    _localAreaController.dispose();
    _meetingPlaceController.dispose();
    _kmFromBranchController.dispose();
    _contactPersonController.dispose();
    _contactNumberController.dispose();
    _latitudeController.dispose();
    _longitudeController.dispose();
    _dateController.dispose();
    _timeController.dispose();
    super.dispose();
  }

  Future<void> _useCurrentLocation() async {
    setState(() => _locating = true);
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        _showLocationError('Location services are turned off.');
        return;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _showLocationError('Location permission was not granted.');
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      if (!mounted) return;
      setState(() {
        _latitudeController.text = position.latitude.toStringAsFixed(6);
        _longitudeController.text = position.longitude.toStringAsFixed(6);
      });

      // _loadBranchLocation() is fired-and-forgotten from initState() and can
      // still be in flight (or may have failed) by the time the user taps
      // "Locate Center" — previously that left _branchLat/_branchLng null and
      // _autoCalculateKmFromBranch() silently did nothing, so the read-only
      // KM field just stayed blank with no explanation. Retry once here and
      // surface a clear error if branch coordinates still aren't available.
      if (_branchLat == null || _branchLng == null) {
        await _loadBranchLocation();
      }
      if (!mounted) return;
      if (_branchLat != null && _branchLng != null) {
        await _autoCalculateKmFromBranch(position.latitude, position.longitude);
      } else {
        _showLocationError(
          'Could not load this branch\'s location, so the distance could not be calculated. Check your connection and try "Locate Center" again.',
        );
      }
    } catch (_) {
      _showLocationError('Unable to fetch your current location.');
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _showLocationError(String message) => Get.snackbar(
    'Location',
    message,
    snackPosition: SnackPosition.BOTTOM,
    backgroundColor: Colors.redAccent,
    colorText: Colors.white,
  );

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFFF1FBF5),
    body: SafeArea(
      child: Column(
        children: [
          _header(),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 96),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _section('Basic Information'),
                    const SizedBox(height: 13),
                    _textField(
                      'Center Name',
                      'Enter center name',
                      controller: _nameController,
                      required: true,
                      autofocus: true,
                    ),
                    const Padding(
                      padding: EdgeInsets.only(top: 5),
                      child: Text(
                        'Center ID is assigned automatically when you save.',
                        style: TextStyle(fontSize: 11, color: Color(0xFF27734D)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    _textField(
                      'Center address',
                      'Enter center address',
                      controller: _addressController,
                    ),
                    const SizedBox(height: 12),
                    _textField(
                      'Local Area',
                      'Enter local area',
                      controller: _localAreaController,
                    ),
                    const SizedBox(height: 20),
                    _section('FDO & Formation Details'),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        Expanded(
                          child: _textField(
                            'FDO Name',
                            '',
                            controller: TextEditingController(text: _fdoName),
                            readOnly: true,
                          ),
                        ),
                        const SizedBox(width: 13),
                        Expanded(child: _dateField()),
                      ],
                    ),
                    const Padding(
                      padding: EdgeInsets.only(top: 5),
                      child: Text(
                        'Automatically assigned to you as\nthe creating FDO.',
                        style: TextStyle(
                          fontSize: 11,
                          height: 1.25,
                          color: Color(0xFF27734D),
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    _section('Meeting Details'),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        Expanded(
                          child: _dropdown('Meeting Day', _meetingDay, const [
                            'Monday',
                            'Tuesday',
                            'Wednesday',
                            'Thursday',
                            'Friday',
                            'Saturday',
                            'Sunday',
                          ], (value) => setState(() => _meetingDay = value)),
                        ),
                        const SizedBox(width: 13),
                        Expanded(child: _timeField()),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _dropdown(
                      'Meeting Place',
                      _selectedMeetingPlace,
                      _meetingPlaces,
                      (value) => setState(() {
                        _selectedMeetingPlace = value;
                        _meetingPlaceController.text = value ?? '';
                      }),
                      allowCustom: true,
                      required: false,
                    ),
                    const SizedBox(height: 20),
                    _section('Contact & Location'),
                    const SizedBox(height: 13),
                    SizedBox(
                      width: double.infinity,
                      height: 46,
                      child: OutlinedButton.icon(
                        onPressed: _locating ? null : _useCurrentLocation,
                        icon: _locating
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.location_on_rounded, size: 14),
                        label: Text(
                          _locating ? 'Locating…' : 'Locate Center',
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        style: _outlinedStyle(),
                      ),
                    ),
                    const SizedBox(height: 13),
                    Row(
                      children: [
                        Expanded(
                          child: _textField(
                            'Latitude',
                            'Use "Locate Center" button',
                            controller: _latitudeController,
                            helper: '(Read Only)',
                            readOnly: true,
                          ),
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: _textField(
                            'Longitude',
                            'Use "Locate Center" button',
                            controller: _longitudeController,
                            helper: '(Read Only)',
                            readOnly: true,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    _textField(
                      'KM From Branch',
                      'Auto-calculated when location is captured',
                      controller: _kmFromBranchController,
                      helper: _isCalculatingKm
                          ? '(calculating road distance…)'
                          : '(Auto-Calculated)',
                      readOnly: true,
                      required: true,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      validator: (value) {
                        final km = double.tryParse(value?.trim() ?? '');
                        if (km == null || km <= 0) {
                          return '';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: _textField(
                            'Contact Person',
                            'Enter contact person name',
                            controller: _contactPersonController,
                            required: true,
                            validator: (value) {
                              final trimmed = value?.trim() ?? '';
                              if (trimmed.length < 3) return '';
                              return null;
                            },
                          ),
                        ),
                        const SizedBox(width: 13),
                        Expanded(
                          child: _textField(
                            'Contact Person Number',
                            'Enter contact person mobile',
                            controller: _contactNumberController,
                            required: true,
                            keyboardType: TextInputType.phone,
                            validator: (value) {
                              final digits = value?.trim() ?? '';
                              if (!RegExp(r'^\d{10}$').hasMatch(digits)) return '';
                              return null;
                            },
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
    bottomNavigationBar: _actions(),
  );

  Widget _header() => Container(
    height: 78,
    padding: const EdgeInsets.symmetric(horizontal: 22),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(bottom: BorderSide(color: Color(0xFFB8E3C8))),
    ),
    child: Row(
      children: [
        const Expanded(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Create New Center',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: Color(0xFF063B20),
                ),
              ),
              SizedBox(height: 3),
              Text(
                'Fill in the details to create a new center.',
                style: TextStyle(fontSize: 12, color: Color(0xFF24724B)),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: () => Navigator.maybePop(context),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(),
          icon: const Icon(Icons.close, size: 19, color: Color(0xFF28543E)),
        ),
      ],
    ),
  );

  Widget _section(String title) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        title,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: Color(0xFF075E2E),
        ),
      ),
      const SizedBox(height: 7),
      const Divider(height: 1, color: Color(0xFFBCE2C9)),
    ],
  );

  Widget _textField(
    String label,
    String hint, {
    TextEditingController? controller,
    bool required = false,
    String? helper,
    bool readOnly = false,
    bool autofocus = false,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label(label, required: required, helper: helper),
      const SizedBox(height: 5),
      SizedBox(
        height: 46,
        child: TextFormField(
          controller: controller,
          autofocus: autofocus,
          readOnly: readOnly,
          keyboardType: keyboardType,
          validator: validator ??
              (required
                  ? (value) => value == null || value.trim().isEmpty ? '' : null
                  : null),
          style: const TextStyle(fontSize: 13, color: Color(0xFF073E23)),
          decoration: _decoration(hint),
        ),
      ),
    ],
  );

  Widget _dropdown(
    String label,
    String? value,
    List<String> items,
    ValueChanged<String?> onChanged, {
    bool allowCustom = false,
    bool required = true,
  }) {
    final validValue = (value != null && items.contains(value)) ? value : value;
    final displayText = validValue ?? '';
    final hasValue = displayText.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _label(label, required: required),
        const SizedBox(height: 5),
        InkWell(
          onTap: () => _openSearchableBottomSheet(
            title: 'Select $label',
            items: items,
            selectedValue: value,
            allowCustom: allowCustom,
            onSelected: onChanged,
          ),
          borderRadius: BorderRadius.circular(5),
          child: Container(
            height: 46,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: const Color(0xFFF8FFFA),
              borderRadius: BorderRadius.circular(5),
              border: Border.all(color: const Color(0xFF82C69A)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    hasValue
                        ? displayText
                        : '-- SELECT ${label.split(' ').first.toUpperCase()} --',
                    style: TextStyle(
                      fontSize: hasValue ? 13 : 11,
                      color: hasValue
                          ? const Color(0xFF073E23)
                          : const Color(0xFF6B9D7C),
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const Icon(
                  Icons.search_rounded,
                  size: 16,
                  color: Color(0xFF478E66),
                ),
                const SizedBox(width: 4),
                const Icon(
                  Icons.keyboard_arrow_down_rounded,
                  size: 16,
                  color: Color(0xFF478E66),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  void _openSearchableBottomSheet({
    required String title,
    required List<String> items,
    required String? selectedValue,
    required ValueChanged<String?> onSelected,
    bool allowCustom = false,
  }) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (bottomSheetContext) => _SearchablePickerSheet(
        title: title,
        items: items,
        selectedValue: selectedValue,
        allowCustom: allowCustom,
        onSelected: (val) {
          Navigator.pop(bottomSheetContext);
          onSelected(val);
        },
      ),
    );
  }

  Widget _dateField() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label('Formation Date', required: true),
      const SizedBox(height: 5),
      SizedBox(
        height: 46,
        child: TextFormField(
          controller: _dateController,
          readOnly: true,
          onTap: _pickDate,
          style: const TextStyle(fontSize: 13, color: Color(0xFF073E23)),
          decoration: _decoration('').copyWith(
            suffixIcon: const Icon(
              Icons.calendar_month_outlined,
              size: 15,
              color: Color(0xFF246B45),
            ),
          ),
        ),
      ),
    ],
  );

  Widget _timeField() => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label('Meeting Time', required: true),
      const SizedBox(height: 5),
      SizedBox(
        height: 46,
        child: TextFormField(
          controller: _timeController,
          readOnly: true,
          onTap: _pickTime,
          style: const TextStyle(fontSize: 13, color: Color(0xFF073E23)),
          decoration: _decoration('').copyWith(
            suffixIcon: const Icon(
              Icons.access_time_rounded,
              size: 15,
              color: Color(0xFF246B45),
            ),
          ),
        ),
      ),
    ],
  );

  Widget _label(String label, {bool required = false, String? helper}) =>
      Text.rich(
        TextSpan(
          children: [
            TextSpan(text: label),
            if (helper != null)
              TextSpan(
                text: '  $helper',
                style: const TextStyle(fontSize: 10, color: Color(0xFF4E8A68)),
              ),
            if (required)
              const TextSpan(
                text: ' *',
                style: TextStyle(color: Color(0xFFE11D48)),
              ),
          ],
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: Color(0xFF075E2E),
        ),
      );

  InputDecoration _decoration(String hint) => InputDecoration(
    hintText: hint,
    hintStyle: const TextStyle(fontSize: 11, color: Color(0xFF71A488)),
    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
    filled: true,
    fillColor: const Color(0xFFF8FFFA),
    border: _border(),
    enabledBorder: _border(),
    focusedBorder: _border(color: _green, width: 1.5),
    errorStyle: const TextStyle(fontSize: 0, height: 0),
  );
  OutlineInputBorder _border({
    Color color = const Color(0xFF82C69A),
    double width = 1,
  }) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(5),
    borderSide: BorderSide(color: color, width: width),
  );
  ButtonStyle _outlinedStyle() => OutlinedButton.styleFrom(
    foregroundColor: const Color(0xFF086533),
    side: const BorderSide(color: Color(0xFF27A85B)),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(5)),
  );

  Widget _actions() => Container(
    height: 76,
    padding: const EdgeInsets.fromLTRB(22, 12, 22, 16),
    decoration: const BoxDecoration(
      color: Colors.white,
      border: Border(top: BorderSide(color: Color(0xFFBFE5CC))),
    ),
    child: Row(
      children: [
        SizedBox(
          height: 44,
          child: Obx(
            () => FilledButton.icon(
              onPressed: _controller.isCreating.value ? null : _save,
              icon: _controller.isCreating.value
                  ? const SizedBox(
                      width: 13,
                      height: 13,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.save_outlined, size: 13),
              label: Text(
                _controller.isCreating.value ? 'Saving…' : 'Save Center',
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
              ),
              style: FilledButton.styleFrom(
                backgroundColor: _green,
                padding: const EdgeInsets.symmetric(horizontal: 11),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(5),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(width: 9),
        SizedBox(
          height: 44,
          child: OutlinedButton.icon(
            onPressed: _reset,
            icon: const Icon(Icons.refresh_rounded, size: 13),
            label: const Text(
              'Cancel',
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
            ),
            style: _outlinedStyle().copyWith(
              padding: const WidgetStatePropertyAll(
                EdgeInsets.symmetric(horizontal: 11),
              ),
            ),
          ),
        ),
      ],
    ),
  );

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      initialDate: _formationDate,
    );
    if (date != null) {
      setState(() {
        _formationDate = date;
        _dateController.text = DateFormat('dd-MM-yyyy').format(date);
      });
    }
  }

  Future<void> _pickTime() async {
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.now(),
    );
    if (time != null) {
      setState(() => _timeController.text = time.format(context));
    }
  }

  void _reset() => setState(() {
    _formKey.currentState?.reset();
    _nameController.clear();
    _addressController.clear();
    _localAreaController.clear();
    _meetingPlaceController.clear();
    _kmFromBranchController.clear();
    _contactPersonController.clear();
    _contactNumberController.clear();
    _latitudeController.clear();
    _longitudeController.clear();
    _meetingDay = null;
    _selectedMeetingPlace = null;
    _formationDate = DateTime.now();
    _dateController.text = DateFormat('dd-MM-yyyy').format(_formationDate);
    _timeController.text = '--:--';
  });

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_meetingDay == null) {
      Get.snackbar(
        'Meeting Day required',
        'Please select a meeting day.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return;
    }

    // Meeting Place is optional (matches the web Center form) — no
    // required-field check here, unlike Meeting Day above.
    final meetingPlace = _selectedMeetingPlace ?? _meetingPlaceController.text.trim();

    final prefs = await SharedPreferences.getInstance();
    var branchId = prefs.getString('branchId') ?? '';
    if (branchId.isEmpty) {
      final token = prefs.getString('accessToken') ?? '';
      final claims = token.isEmpty ? null : SecureSessionService.decodeJwtPayload(token);
      final claimedBranchId = claims?['branchId']?.toString();
      if (claimedBranchId != null && claimedBranchId.isNotEmpty) {
        branchId = claimedBranchId;
        await prefs.setString('branchId', branchId);
      }
    }

    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
      'address': _addressController.text.trim(),
      'localArea': _localAreaController.text.trim(),
      'branchId': branchId,
      'formationDate': DateFormat('yyyy-MM-dd').format(_formationDate),
      'meetingDay': _meetingDay,
      'meetingTime': _timeController.text.trim(),
      'meetingPlace': meetingPlace,
      'latitude': double.tryParse(_latitudeController.text.trim()),
      'longitude': double.tryParse(_longitudeController.text.trim()),
      'kmFromBranch': double.tryParse(_kmFromBranchController.text.trim()),
      'contactPerson': _contactPersonController.text.trim(),
      'contactNumber': _contactNumberController.text.trim(),
    };

    final center = await _controller.createCenter(body);
    if (center == null || !mounted) return;

    await _showSuccessDialog(center);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _showSuccessDialog(Map center) {
    final name = '${center['name'] ?? ''}';
    final code = '${center['code'] ?? '—'}';

    return showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Dialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 28, 24, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: const BoxDecoration(
                  color: Color(0xFFE1F5E7),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_rounded,
                  color: Color(0xFF08753A),
                  size: 32,
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                'Center Created',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: Color(0xFF063B20),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '$name was created successfully.',
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 12.5, color: Color(0xFF4E8A68)),
              ),
              const SizedBox(height: 18),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FFFA),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFBCE2C9)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Assigned Center ID',
                      style: TextStyle(
                        fontSize: 11.5,
                        color: Color(0xFF4E8A68),
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      code,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: Color(0xFF063B20),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: FilledButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  style: FilledButton.styleFrom(
                    backgroundColor: _green,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(5),
                    ),
                  ),
                  child: const Text(
                    'OK',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SearchablePickerSheet extends StatefulWidget {
  const _SearchablePickerSheet({
    required this.title,
    required this.items,
    required this.selectedValue,
    required this.onSelected,
    this.allowCustom = false,
  });

  final String title;
  final List<String> items;
  final String? selectedValue;
  final ValueChanged<String?> onSelected;
  final bool allowCustom;

  @override
  State<_SearchablePickerSheet> createState() => _SearchablePickerSheetState();
}

class _SearchablePickerSheetState extends State<_SearchablePickerSheet> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _searchQuery.trim().toLowerCase();
    final filtered = widget.items
        .where((item) => item.toLowerCase().contains(query))
        .toList();

    final showCustomOption = widget.allowCustom &&
        _searchQuery.trim().isNotEmpty &&
        !filtered.any((item) => item.toLowerCase() == query);

    return Container(
      height: MediaQuery.of(context).size.height * 0.65,
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
            decoration: const BoxDecoration(
              border: Border(bottom: BorderSide(color: Color(0xFFE2E8F0))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF063B20),
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded, size: 20),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              autofocus: true,
              onChanged: (val) => setState(() => _searchQuery = val),
              style: const TextStyle(fontSize: 13),
              decoration: InputDecoration(
                hintText: 'Search options...',
                hintStyle: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                prefixIcon: const Icon(Icons.search_rounded, size: 18, color: Color(0xFF00843D)),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear_rounded, size: 16),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                filled: true,
                fillColor: const Color(0xFFF8FFFA),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF82C69A)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF82C69A)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFF00843D), width: 1.5),
                ),
              ),
            ),
          ),
          if (showCustomOption)
            InkWell(
              onTap: () => widget.onSelected(_searchQuery.trim()),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
                color: const Color(0xFFF0FDF4),
                child: Row(
                  children: [
                    const Icon(Icons.add_circle_outline_rounded, size: 18, color: Color(0xFF00843D)),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Use custom value: "${_searchQuery.trim()}"',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF00843D),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          Expanded(
            child: filtered.isEmpty && !showCustomOption
                ? const Center(
                    child: Text(
                      'No matching options found',
                      style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const Divider(height: 1, indent: 16, endIndent: 16),
                    itemBuilder: (context, index) {
                      final item = filtered[index];
                      final isSelected = item == widget.selectedValue;

                      return ListTile(
                        dense: true,
                        title: Text(
                          item,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                            color: isSelected ? const Color(0xFF00843D) : const Color(0xFF0F172A),
                          ),
                        ),
                        trailing: isSelected
                            ? const Icon(Icons.check_circle_rounded, size: 18, color: Color(0xFF00843D))
                            : null,
                        onTap: () => widget.onSelected(item),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
