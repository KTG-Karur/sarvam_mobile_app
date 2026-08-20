import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:geolocator/geolocator.dart';
import 'package:get/get.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

class BranchToCentreDistancePage extends StatefulWidget {
  const BranchToCentreDistancePage({super.key});

  @override
  State<BranchToCentreDistancePage> createState() =>
      _BranchToCentreDistancePageState();
}

class _BranchToCentreDistancePageState
    extends State<BranchToCentreDistancePage> {
  final _formKey = GlobalKey<FormState>();
  final _branchLatitude = TextEditingController(text: '10.0104');
  final _branchLongitude = TextEditingController(text: '77.4768');
  final _centreLatitude = TextEditingController(text: '10.0161');
  final _centreLongitude = TextEditingController(text: '77.4821');
  GoogleMapController? _mapController;
  double? _distanceKm;
  LatLng? _branch;
  LatLng? _centre;
  bool _locatingBranch = false;
  bool _locatingCentre = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _calculateDistance());
  }

  @override
  void dispose() {
    _branchLatitude.dispose();
    _branchLongitude.dispose();
    _centreLatitude.dispose();
    _centreLongitude.dispose();
    super.dispose();
  }

  Future<void> _useCurrentLocation({required bool isBranch}) async {
    setState(() {
      if (isBranch) {
        _locatingBranch = true;
      } else {
        _locatingCentre = true;
      }
    });
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
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      if (!mounted) return;
      setState(() {
        if (isBranch) {
          _branchLatitude.text = position.latitude.toStringAsFixed(6);
          _branchLongitude.text = position.longitude.toStringAsFixed(6);
        } else {
          _centreLatitude.text = position.latitude.toStringAsFixed(6);
          _centreLongitude.text = position.longitude.toStringAsFixed(6);
        }
      });
      await _calculateDistance();
    } catch (_) {
      _showLocationError('Unable to fetch your current location.');
    } finally {
      if (mounted) {
        setState(() {
          if (isBranch) {
            _locatingBranch = false;
          } else {
            _locatingCentre = false;
          }
        });
      }
    }
  }

  void _showLocationError(String message) => Get.snackbar(
    'Location',
    message,
    snackPosition: SnackPosition.BOTTOM,
    backgroundColor: Colors.redAccent,
    colorText: Colors.white,
    margin: EdgeInsets.all(16.w),
    borderRadius: 8.r,
  );

  double? _coordinate(String? value, bool latitude) {
    final coordinate = double.tryParse(value?.trim() ?? '');
    final limit = latitude ? 90 : 180;
    if (coordinate == null || coordinate.abs() > limit) return null;
    return coordinate;
  }

  Future<void> _calculateDistance() async {
    if (!_formKey.currentState!.validate()) return;
    final branch = LatLng(
      _coordinate(_branchLatitude.text, true)!,
      _coordinate(_branchLongitude.text, false)!,
    );
    final centre = LatLng(
      _coordinate(_centreLatitude.text, true)!,
      _coordinate(_centreLongitude.text, false)!,
    );
    setState(() {
      _branch = branch;
      _centre = centre;
      _distanceKm = _haversineKm(branch, centre);
    });
    await _fitMapToMarkers(branch, centre);
  }

  double _haversineKm(LatLng start, LatLng end) {
    const radiusKm = 6371.0;
    final dLat = _radians(end.latitude - start.latitude);
    final dLng = _radians(end.longitude - start.longitude);
    final a =
        math.sin(dLat / 2) * math.sin(dLat / 2) +
        math.cos(_radians(start.latitude)) *
            math.cos(_radians(end.latitude)) *
            math.sin(dLng / 2) *
            math.sin(dLng / 2);
    return radiusKm * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
  }

  double _radians(double degrees) => degrees * math.pi / 180;

  Future<void> _fitMapToMarkers(LatLng branch, LatLng centre) async {
    final controller = _mapController;
    if (controller == null) return;
    final bounds = LatLngBounds(
      southwest: LatLng(
        math.min(branch.latitude, centre.latitude),
        math.min(branch.longitude, centre.longitude),
      ),
      northeast: LatLng(
        math.max(branch.latitude, centre.latitude),
        math.max(branch.longitude, centre.longitude),
      ),
    );
    await controller.animateCamera(CameraUpdate.newLatLngBounds(bounds, 55));
  }

  @override
  Widget build(BuildContext context) {
    final branch = _branch;
    final centre = _centre;
    final markers = <Marker>{
      if (branch != null)
        Marker(
          markerId: const MarkerId('branch'),
          position: branch,
          infoWindow: const InfoWindow(title: 'Branch'),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueOrange,
          ),
        ),
      if (centre != null)
        Marker(
          markerId: const MarkerId('centre'),
          position: centre,
          infoWindow: const InfoWindow(title: 'Centre'),
          icon: BitmapDescriptor.defaultMarkerWithHue(
            BitmapDescriptor.hueGreen,
          ),
        ),
    };
    return Theme(
      data: ThemeData.from(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF008A3D)),
        useMaterial3: true,
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF5FBF7),
        appBar: AppBar(
          backgroundColor: const Color(0xFF008A3D),
          foregroundColor: Colors.white,
          elevation: 0,
          title: const Text('Branch to Centre Distance'),
          actions: [
            IconButton(
              onPressed: () => Get.snackbar(
                'About this screen',
                'Enter GPS coordinates for a branch and a centre to see the '
                    'direct distance and route between them.',
                snackPosition: SnackPosition.BOTTOM,
                backgroundColor: const Color(0xFF10472A),
                colorText: Colors.white,
                margin: EdgeInsets.all(16.w),
                borderRadius: 8.r,
              ),
              icon: const Icon(Icons.info_outline),
            ),
          ],
        ),
        body: SafeArea(
          top: false,
          child: SingleChildScrollView(
            padding: EdgeInsets.fromLTRB(18.w, 18.h, 18.w, 28.h),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Location distance',
                    style: TextStyle(
                      fontSize: 24.sp,
                      fontWeight: FontWeight.w800,
                      color: const Color(0xFF10472A),
                    ),
                  ),
                  SizedBox(height: 5.h),
                  Text(
                    'Enter the GPS coordinates for the branch and centre.',
                    style: TextStyle(
                      fontSize: 13.sp,
                      color: const Color(0xFF4B8A68),
                    ),
                  ),
                  SizedBox(height: 18.h),
                  _coordinateCard(
                    'Branch location',
                    Icons.account_balance_outlined,
                    _branchLatitude,
                    _branchLongitude,
                    const Color(0xFF008A3D),
                    const Color(0xFFE4F5EB),
                    isLocating: _locatingBranch,
                    onUseMyLocation: () => _useCurrentLocation(isBranch: true),
                  ),
                  SizedBox(height: 12.h),
                  _coordinateCard(
                    'Centre location',
                    Icons.location_city_outlined,
                    _centreLatitude,
                    _centreLongitude,
                    const Color(0xFF0D6842),
                    const Color(0xFFE4F5EB),
                    isLocating: _locatingCentre,
                    onUseMyLocation: () => _useCurrentLocation(isBranch: false),
                  ),
                  SizedBox(height: 16.h),
                  SizedBox(
                    width: double.infinity,
                    height: 54.h,
                    child: FilledButton.icon(
                      onPressed: _calculateDistance,
                      icon: const Icon(Icons.route_rounded),
                      label: const Text('Calculate Distance'),
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF008A3D),
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14.r),
                        ),
                      ),
                    ),
                  ),
                  if (_distanceKm != null) ...[
                    SizedBox(height: 16.h),
                    _distanceCard(),
                    SizedBox(height: 16.h),
                    Text(
                      'Map route',
                      style: TextStyle(
                        fontSize: 16.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF10472A),
                      ),
                    ),
                    SizedBox(height: 9.h),
                    SizedBox(
                      height: 290.h,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(18.r),
                        child: GoogleMap(
                          initialCameraPosition: CameraPosition(
                            target: branch!,
                            zoom: 13,
                          ),
                          onMapCreated: (controller) {
                            _mapController = controller;
                            _fitMapToMarkers(branch, centre);
                          },
                          markers: markers,
                          polylines: {
                            Polyline(
                              polylineId: const PolylineId(
                                'branch-centre-route',
                              ),
                              points: [branch, centre!],
                              color: const Color(0xFF008A3D),
                              width: 5,
                              geodesic: true,
                            ),
                          },
                          myLocationButtonEnabled: false,
                          zoomControlsEnabled: false,
                        ),
                      ),
                    ),
                    SizedBox(height: 7.h),
                    Text(
                      'The green line shows the direct aerial route between the locations.',
                      style: TextStyle(
                        fontSize: 11.sp,
                        color: const Color(0xFF4B8A68),
                      ),
                    ),
                    SizedBox(height: 18.h),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _fitMapToMarkers(branch, centre),
                            icon: const Icon(Icons.alt_route_rounded),
                            label: const Text('View Route'),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFF008A3D),
                              side: const BorderSide(
                                color: Color(0xFF008A3D),
                              ),
                              minimumSize: Size(0, 52.h),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14.r),
                              ),
                            ),
                          ),
                        ),
                        SizedBox(width: 12.w),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: _saveDistance,
                            icon: const Icon(Icons.save_outlined),
                            label: const Text('Save'),
                            style: FilledButton.styleFrom(
                              backgroundColor: const Color(0xFF008A3D),
                              foregroundColor: Colors.white,
                              minimumSize: Size(0, 52.h),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14.r),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  void _saveDistance() {
    final distance = _distanceKm;
    if (distance == null) return;
    Get.snackbar(
      'Saved',
      'Branch-to-centre distance of ${distance.toStringAsFixed(2)} km saved.',
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFF008A3D),
      colorText: Colors.white,
      margin: EdgeInsets.all(16.w),
      borderRadius: 8.r,
    );
  }

  Widget _coordinateCard(
    String title,
    IconData icon,
    TextEditingController latitude,
    TextEditingController longitude,
    Color accent,
    Color accentBg, {
    required bool isLocating,
    required VoidCallback onUseMyLocation,
  }) => Card(
    elevation: 0,
    color: Colors.white,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(16.r),
      side: const BorderSide(color: Color(0xFFD2E9DB)),
    ),
    child: Padding(
      padding: EdgeInsets.all(15.w),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(8.w),
                decoration: BoxDecoration(
                  color: accentBg,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: accent, size: 20.sp),
              ),
              SizedBox(width: 9.w),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    fontSize: 15.sp,
                    fontWeight: FontWeight.w800,
                    color: const Color(0xFF10472A),
                  ),
                ),
              ),
              if (isLocating)
                SizedBox(
                  width: 16.w,
                  height: 16.w,
                  child: CircularProgressIndicator(strokeWidth: 2, color: accent),
                )
              else
                InkWell(
                  onTap: onUseMyLocation,
                  borderRadius: BorderRadius.circular(8.r),
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 4.h),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.my_location_rounded, size: 14.sp, color: accent),
                        SizedBox(width: 4.w),
                        Text(
                          'Use my location',
                          style: TextStyle(
                            fontSize: 10.sp,
                            fontWeight: FontWeight.w700,
                            color: accent,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          SizedBox(height: 14.h),
          Row(
            children: [
              Expanded(child: _field('Latitude', latitude, true, accent)),
              SizedBox(width: 10.w),
              Expanded(child: _field('Longitude', longitude, false, accent)),
            ],
          ),
        ],
      ),
    ),
  );

  Widget _field(
    String label,
    TextEditingController controller,
    bool isLatitude,
    Color accent,
  ) => TextFormField(
    controller: controller,
    keyboardType: const TextInputType.numberWithOptions(
      decimal: true,
      signed: true,
    ),
    inputFormatters: [
      FilteringTextInputFormatter.allow(RegExp(r'-?\d*\.?\d*')),
    ],
    validator: (value) =>
        _coordinate(value, isLatitude) == null ? 'Invalid' : null,
    decoration: InputDecoration(
      labelText: label,
      hintText: isLatitude ? '10.0000' : '77.0000',
      isDense: true,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10.r),
        borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10.r),
        borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10.r),
        borderSide: BorderSide(color: accent, width: 1.5),
      ),
    ),
  );

  Widget _distanceCard() => Container(
    width: double.infinity,
    padding: EdgeInsets.all(18.w),
    decoration: BoxDecoration(
      color: const Color(0xFF008A3D),
      borderRadius: BorderRadius.circular(18.r),
    ),
    child: Row(
      children: [
        const Icon(Icons.straighten_rounded, color: Colors.white, size: 30),
        SizedBox(width: 13.w),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'DIRECT DISTANCE',
                style: TextStyle(
                  color: const Color(0xFFCFEBDA),
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  letterSpacing: .8,
                ),
              ),
              SizedBox(height: 3.h),
              Text(
                '${_distanceKm!.toStringAsFixed(2)} KM',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 28.sp,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
