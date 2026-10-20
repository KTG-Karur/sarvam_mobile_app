import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/view/FDO/client_search_locate/location_navigation_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocateCenterTab extends StatefulWidget {
  const LocateCenterTab({super.key});

  @override
  State<LocateCenterTab> createState() => _LocateCenterTabState();
}

class _LocateCenterTabState extends State<LocateCenterTab> {
  static const _green = Color(0xFF008A3D);
  static const _darkGreen = Color(0xFF10472A);
  static const _mutedGreen = Color(0xFF4B8A68);
  static const _border = Color(0xFFD2E9DB);
  static const _lightGreen = Color(0xFFE4F5EB);
  static const _fill = Color(0xFFF7FBF7);

  List<dynamic> _branches = [];
  List<dynamic> _centers = [];
  dynamic _selectedBranch;
  dynamic _selectedCenter;
  Map<String, dynamic>? _centerDetails;

  bool _loadingBranches = false;
  bool _loadingCenters = false;
  bool _loadingDetails = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchBranches();
  }

  Future<void> _fetchBranches() async {
    setState(() {
      _loadingBranches = true;
      _error = null;
    });
    try {
      final prefs = await SharedPreferences.getInstance();
      final assignedBranchIds = prefs.getStringList('assignedBranchIds') ?? [];
      final primaryBranchId = prefs.getString('branchId');
      final primaryBranchName = prefs.getString('branchName');
      final primaryBranchCode = prefs.getString('branchCode');

      final client = ApiClient();
      final response = await client.get("${Api.branchesUrl}?includeInactive=false");
      
      if (response.statusCode == 200 && response.body['success'] == true) {
        List<dynamic> data = response.body['data'] ?? [];
        
        // Filter branches to only include those assigned to the user
        if (assignedBranchIds.isNotEmpty) {
          data = data.where((b) => assignedBranchIds.contains(b['id'].toString())).toList();
        } else if (primaryBranchId != null && primaryBranchId.isNotEmpty) {
          data = data.where((b) => b['id'].toString() == primaryBranchId).toList();
        }
        
        setState(() {
          _branches = data;
          // Auto-select if there's only one branch assigned
          if (_branches.length == 1) {
            _selectedBranch = _branches[0];
            _fetchCenters(_selectedBranch['id'].toString());
          }
        });
      } else {
        // Fallback to locally stored branch if API fails
        if (primaryBranchId != null && primaryBranchName != null) {
          setState(() {
            _branches = [
              {
                'id': primaryBranchId,
                'name': primaryBranchName,
                'code': primaryBranchCode ?? '',
              }
            ];
            _selectedBranch = _branches[0];
            _fetchCenters(primaryBranchId);
          });
        } else {
          throw Exception("Failed to load branches");
        }
      }
    } catch (e) {
      setState(() => _error = "Error loading branches");
    } finally {
      setState(() => _loadingBranches = false);
    }
  }

  Future<void> _fetchCenters(String branchId) async {
    setState(() {
      _loadingCenters = true;
      _centers = [];
      _selectedCenter = null;
      _centerDetails = null;
    });
    try {
      final client = ApiClient();
      final url = "${Api.centersUrl}?branchId=$branchId&includeInactive=false";
      final response = await client.get(url);
      if (response.statusCode == 200 && response.body['success'] == true) {
        final List<dynamic> data = response.body['data'] ?? [];
        // Sort centers A-Z by name
        data.sort((a, b) => (a['name']?.toString() ?? '').toLowerCase().compareTo((b['name']?.toString() ?? '').toLowerCase()));
        setState(() {
          _centers = data;
        });
      } else {
        throw Exception("Failed to load centers");
      }
    } catch (e) {
      setState(() => _error = "Error loading centers");
    } finally {
      setState(() => _loadingCenters = false);
    }
  }

  Future<void> _fetchCenterDetails(String centerId) async {
    setState(() {
      _loadingDetails = true;
      _centerDetails = null;
    });
    try {
      final client = ApiClient();
      final url = "${Api.centersUrl}/$centerId";
      final response = await client.get(url);
      
      if (response.statusCode == 200 && response.body['success'] == true) {
        final data = response.body['data'];
        
        // Diagnostic Logging
        debugPrint('[Diagnostic] Center Details API: $url');
        debugPrint('[Diagnostic] Raw FDO data: fdoName="${data['fdoName']}", fdoObject=${data['fdo']}');
        debugPrint('[Diagnostic] Raw Coordinates: lat=${data['latitude']}, lng=${data['longitude']}');
        
        setState(() {
          _centerDetails = data;
        });
      } else {
        throw Exception("Failed to load center details");
      }
    } catch (e) {
      setState(() => _error = "Error loading details");
    } finally {
      setState(() => _loadingDetails = false);
    }
  }

  void _reset() {
    setState(() {
      _selectedCenter = null;
      _centerDetails = null;
      _error = null;
      if (_branches.length == 1) {
        _selectedBranch = _branches[0];
        _fetchCenters(_selectedBranch['id'].toString());
      } else {
        _selectedBranch = null;
        _centers = [];
      }
    });
  }

  String _getDisplayFdo(Map<String, dynamic>? details) {
    if (details == null) return 'N/A';
    
    final fName = details['fdoName'];
    final fObj = details['fdo'];
    String result = 'N/A';
    
    if (fName != null && fName.toString().trim().isNotEmpty && fName.toString().toLowerCase() != 'null') {
      result = fName.toString().trim();
    } else if (fObj != null && fObj is Map) {
      final first = fObj['firstName']?.toString() ?? '';
      final last = fObj['lastName']?.toString() ?? '';
      result = "$first $last".trim();
    }
    
    return (result.isEmpty || result.toLowerCase() == 'null') ? 'N/A' : result;
  }

  bool _hasValidLocation() {
    if (_centerDetails == null) return false;
    final latVal = _centerDetails!['latitude'];
    final lngVal = _centerDetails!['longitude'];
    final lat = double.tryParse(latVal?.toString() ?? '');
    final lng = double.tryParse(lngVal?.toString() ?? '');
    return lat != null && lng != null && lat != 0 && lng != 0;
  }

  void _openMap() {
    if (_centerDetails == null) return;
    
    final latVal = _centerDetails!['latitude'];
    final lngVal = _centerDetails!['longitude'];
    final lat = double.tryParse(latVal?.toString() ?? '');
    final lng = double.tryParse(lngVal?.toString() ?? '');
    
    if (lat == null || lng == null || lat == 0 || lng == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('No location details available'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: Colors.redAccent,
        ),
      );
      return;
    }

    final point = LatLng(lat, lng);
    debugPrint('[Diagnostic] Map Launch: point=$point');

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => LocationNavigationScreen(
          title: _centerDetails!['name'] ?? 'Center Location',
          targets: [
            NavTarget(
              label: 'Centre',
              name: _centerDetails!['name'] ?? '',
              icon: Icons.groups_outlined,
              hue: BitmapDescriptor.hueGreen,
              point: point,
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _dropdownDecoration(String label) => InputDecoration(
        labelText: label,
        labelStyle: TextStyle(fontSize: 12.sp, color: _mutedGreen),
        isDense: true,
        filled: true,
        fillColor: _fill,
        contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 12.h),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10.r), borderSide: const BorderSide(color: _border)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10.r), borderSide: const BorderSide(color: _border)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10.r), borderSide: const BorderSide(color: _green, width: 1.5)),
      );

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.fromLTRB(16.w, 16.h, 16.w, 24.h),
      children: [
        Text(
          'Select a center from the dropdown to view its location',
          style: TextStyle(fontSize: 12.sp, color: _mutedGreen),
        ),
        SizedBox(height: 16.h),
        
        // Selection Card
        Container(
          padding: EdgeInsets.all(15.w),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16.r),
            border: Border.all(color: _border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Icon(Icons.location_on_outlined, size: 16.sp, color: _darkGreen),
                  SizedBox(width: 8.w),
                  Text('Center Selection', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700, color: _darkGreen)),
                ],
              ),
              SizedBox(height: 16.h),
              
              // Branch Dropdown
              DropdownButtonFormField<dynamic>(
                isExpanded: true,
                value: _selectedBranch,
                decoration: _dropdownDecoration('Branch'),
                hint: Text(_loadingBranches ? 'Loading branches...' : 'Select Branch', style: TextStyle(fontSize: 12.sp)),
                items: _branches.map((b) => DropdownMenuItem(
                  value: b,
                  child: Text("${b['code']} - ${b['name']}", style: TextStyle(fontSize: 12.sp)),
                )).toList(),
                onChanged: _loadingBranches ? null : (value) {
                  setState(() => _selectedBranch = value);
                  _fetchCenters(value['id']);
                },
              ),
              SizedBox(height: 12.h),
              
              // Center Dropdown
              DropdownButtonFormField<dynamic>(
                isExpanded: true,
                value: _selectedCenter,
                decoration: _dropdownDecoration('Center Name'),
                hint: Text(_loadingCenters ? 'Loading centers...' : 'Select Center', style: TextStyle(fontSize: 12.sp)),
                items: _centers.map((c) => DropdownMenuItem(
                  value: c,
                  child: Text("${c['name']} (${c['code']})", style: TextStyle(fontSize: 12.sp)),
                )).toList(),
                onChanged: (_loadingCenters || _selectedBranch == null) ? null : (value) {
                  setState(() => _selectedCenter = value);
                  _fetchCenterDetails(value['id']);
                },
              ),
              SizedBox(height: 16.h),
              
              // Reset Button
              OutlinedButton.icon(
                onPressed: _reset,
                icon: Icon(Icons.refresh, size: 16.sp),
                label: Text('Reset', style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w600)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: _mutedGreen,
                  side: const BorderSide(color: _border),
                  padding: EdgeInsets.symmetric(vertical: 12.h),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                ),
              ),
            ],
          ),
        ),

        if (_loadingDetails) 
          Padding(
            padding: EdgeInsets.symmetric(vertical: 40.h),
            child: const Center(child: CircularProgressIndicator(color: _green)),
          ),

        if (_centerDetails != null) ...[
          SizedBox(height: 20.h),
          
          // Details Card
          Container(
            padding: EdgeInsets.all(15.w),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16.r),
              border: Border.all(color: _border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.info_outline, size: 16.sp, color: _darkGreen),
                        SizedBox(width: 8.w),
                        Text('Center Details', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700, color: _darkGreen)),
                      ],
                    ),
                    if (_hasValidLocation())
                      Container(
                        padding: EdgeInsets.symmetric(horizontal: 8.w, vertical: 4.h),
                        decoration: BoxDecoration(color: _lightGreen, borderRadius: BorderRadius.circular(12.r)),
                        child: Row(
                          children: [
                            Icon(Icons.check_circle, size: 12.sp, color: _green),
                            SizedBox(width: 4.w),
                            Text('Has Location', style: TextStyle(fontSize: 10.sp, fontWeight: FontWeight.w700, color: _green)),
                          ],
                        ),
                      ),
                  ],
                ),
                SizedBox(height: 16.h),
                _detailRow('Center Name', _centerDetails!['name'], 'Center Code', _centerDetails!['code']),
                SizedBox(height: 12.h),
                _detailLabel('Address'),
                Text(_centerDetails!['address'] ?? 'N/A', style: TextStyle(fontSize: 12.sp, color: _darkGreen)),
                SizedBox(height: 12.h),
                _detailRow(
                  'Branch', 
                  _centerDetails!['branch']?['name'] ?? _selectedBranch?['name'], 
                  'Assigned FDO', 
                  _getDisplayFdo(_centerDetails)
                ),
                SizedBox(height: 12.h),
                _detailRow('Latitude', _centerDetails!['latitude']?.toString() ?? 'N/A', 'Longitude', _centerDetails!['longitude']?.toString() ?? 'N/A'),
                
                Divider(height: 32.h, color: _border),
                
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _openMap,
                    icon: Icon(Icons.map, size: 18.sp),
                    label: Text('View on Map', style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w700)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _hasValidLocation() ? _green : Colors.grey,
                      foregroundColor: Colors.white,
                      padding: EdgeInsets.symmetric(vertical: 14.h),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        
        if (_error != null) ...[
          SizedBox(height: 20.h),
          Center(child: Text(_error!, style: TextStyle(color: Colors.red, fontSize: 13.sp))),
        ],
      ],
    );
  }

  Widget _detailRow(String label1, String? value1, String label2, String? value2) {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _detailLabel(label1),
              Text(value1 ?? 'N/A', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600, color: _darkGreen)),
            ],
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _detailLabel(label2),
              Text(value2 ?? 'N/A', style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600, color: _darkGreen)),
            ],
          ),
        ),
      ],
    );
  }

  Widget _detailLabel(String label) => Padding(
    padding: EdgeInsets.only(bottom: 2.h),
    child: Text(label, style: TextStyle(fontSize: 11.sp, color: _mutedGreen)),
  );
}
