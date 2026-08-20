import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/controller/centre_controller.dart';

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

  String _fdoName = '';
  bool _locating = false;

  @override
  void initState() {
    super.initState();
    _dateController.text = DateFormat('dd-MM-yyyy').format(_formationDate);
    _loadFdoName();
  }

  Future<void> _loadFdoName() async {
    final prefs = await SharedPreferences.getInstance();
    final firstName = prefs.getString('firstName') ?? '';
    final lastName = prefs.getString('lastName') ?? '';
    if (!mounted) return;
    setState(() => _fdoName = '$firstName $lastName'.trim());
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
                      required: true,
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
                    _textField(
                      'Meeting Place',
                      'Enter meeting place',
                      controller: _meetingPlaceController,
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
                      'Enter distance from branch in KM',
                      controller: _kmFromBranchController,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
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
          validator: required
              ? (value) => value == null || value.trim().isEmpty ? '' : null
              : null,
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
    ValueChanged<String?> onChanged,
  ) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      _label(label, required: true),
      const SizedBox(height: 5),
      SizedBox(
        height: 46,
        child: DropdownButtonFormField<String>(
          initialValue: value,
          isExpanded: true,
          decoration: _decoration(''),
          hint: Text(
            '-- SELECT ${label.split(' ').first.toUpperCase()} --',
            style: const TextStyle(fontSize: 11, color: Color(0xFF6B9D7C)),
            overflow: TextOverflow.ellipsis,
          ),
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            size: 15,
            color: Color(0xFF478E66),
          ),
          items: items
              .map(
                (item) => DropdownMenuItem(
                  value: item,
                  child: Text(item, style: const TextStyle(fontSize: 13)),
                ),
              )
              .toList(),
          onChanged: onChanged,
        ),
      ),
    ],
  );

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

    final prefs = await SharedPreferences.getInstance();
    final branchId = prefs.getString('branchId') ?? '';

    final body = <String, dynamic>{
      'name': _nameController.text.trim(),
      'address': _addressController.text.trim(),
      'localArea': _localAreaController.text.trim(),
      'branchId': branchId,
      'formationDate': DateFormat('yyyy-MM-dd').format(_formationDate),
      'meetingDay': _meetingDay,
      'meetingTime': _timeController.text.trim(),
      'meetingPlace': _meetingPlaceController.text.trim(),
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
