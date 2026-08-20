import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/controller/collection_controller.dart';

class CollectionSubmissionFlowPage extends StatefulWidget {
  const CollectionSubmissionFlowPage({
    super.key,
    required this.collectedAmount,
    required this.selectedClients,
    required this.centerId,
    required this.collectionDate,
    required this.allClients,
  });

  final double collectedAmount;
  final List<Map<String, dynamic>> selectedClients;
  final String centerId;
  final String collectionDate;
  final List<Map<String, dynamic>> allClients;

  @override
  State<CollectionSubmissionFlowPage> createState() =>
      _CollectionSubmissionFlowPageState();
}

class _CollectionSubmissionFlowPageState
    extends State<CollectionSubmissionFlowPage> {
  int _currentStep = 2; // Step 2: Meeting Photo

  final ImagePicker _picker = ImagePicker();
  Uint8List? _meetingPhotoBytes;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _retrieveLostData();
  }

  Future<void> _retrieveLostData() async {
    final response = await _picker.retrieveLostData();
    if (response.isEmpty || response.file == null) return;
    final bytes = await response.file!.readAsBytes();
    if (!mounted) return;
    setState(() => _meetingPhotoBytes = bytes);
  }

  // Step 3 Denomination controllers
  final Map<int, TextEditingController> _denominationControllers = {
    500: TextEditingController(text: '6'),
    200: TextEditingController(text: '1'),
    100: TextEditingController(text: '4'),
    50: TextEditingController(),
    20: TextEditingController(),
    10: TextEditingController(),
    5: TextEditingController(),
    2: TextEditingController(),
    1: TextEditingController(),
  };
  final TextEditingController _upiController = TextEditingController();

  double get _calculatedTotal {
    double total = 0;
    _denominationControllers.forEach((note, controller) {
      final count = int.tryParse(controller.text.trim()) ?? 0;
      total += note * count;
    });
    final upi = double.tryParse(_upiController.text.trim()) ?? 0;
    total += upi;
    return total;
  }

  bool get _isMatch =>
      (_calculatedTotal - widget.collectedAmount).abs() < 0.01;

  @override
  void dispose() {
    for (var controller in _denominationControllers.values) {
      controller.dispose();
    }
    _upiController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5FBF7),
      appBar: AppBar(
        backgroundColor: const Color(0xFF008A3D),
        foregroundColor: Colors.white,
        elevation: 0,
        title: const Text('Collection Submission'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: EdgeInsets.all(16.w),
          child: _currentStep == 2 ? _buildStep2() : _buildStep3(),
        ),
      ),
    );
  }

  /// Step 2 of 3 — Meeting Photo
  Widget _buildStep2() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: const Color(0xFFD2E9DB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(8.w),
                decoration: const BoxDecoration(
                  color: Color(0xFFE4F5EB),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.camera_alt_outlined,
                  color: const Color(0xFF008A3D),
                  size: 20.sp,
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Step 2 of 3 — Meeting Photo',
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF10472A),
                      ),
                    ),
                    Text(
                      'Capture a photo of the center meeting before entering the cash count',
                      style: TextStyle(
                        fontSize: 10.sp,
                        color: const Color(0xFF638B74),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 20.h),
          Center(
            child: Container(
              width: double.infinity,
              height: 200.h,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF1E2421),
                borderRadius: BorderRadius.circular(12.r),
              ),
              child: _meetingPhotoBytes != null
                  ? Image.memory(_meetingPhotoBytes!, fit: BoxFit.cover)
                  : Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(
                          Icons.image_outlined,
                          size: 46.sp,
                          color: Colors.white38,
                        ),
                        SizedBox(height: 8.h),
                        Text(
                          'No meeting photo captured yet',
                          style: TextStyle(
                            fontSize: 11.sp,
                            color: Colors.white60,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
          SizedBox(height: 14.h),
          Center(
            child: OutlinedButton.icon(
              onPressed: _takePhoto,
              icon: Icon(Icons.camera_alt_outlined, size: 16.sp),
              label: Text(
                _meetingPhotoBytes != null ? 'Retake Photo' : 'Take Photo',
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFF385046),
                side: const BorderSide(color: Color(0xFFD2E9DB)),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8.r),
                ),
              ),
            ),
          ),
          SizedBox(height: 24.h),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.arrow_back),
                label: const Text('Back'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF385046),
                  side: const BorderSide(color: Color(0xFFD2E9DB)),
                  minimumSize: Size(0, 48.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: _meetingPhotoBytes != null
                      ? () => setState(() => _currentStep = 3)
                      : null,
                  icon: const Icon(Icons.arrow_forward),
                  label: const Text('Continue to Denomination'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF008A3D),
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: const Color(0xFFA7D1B8),
                    minimumSize: Size(0, 48.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _takePhoto() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined, color: Color(0xFF008A3D)),
              title: const Text('Take Photo with Camera'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: Color(0xFF008A3D)),
              title: const Text('Choose from Gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      final photo = await _picker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 80,
      );
      if (photo == null) return;
      final bytes = await photo.readAsBytes();
      if (!mounted) return;
      setState(() => _meetingPhotoBytes = bytes);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to select photo: $e'),
          backgroundColor: Colors.redAccent,
        ),
      );
    }
  }

  /// Step 3 of 3 — Cash Denomination
  Widget _buildStep3() {
    final collectedStr = widget.collectedAmount.toStringAsFixed(2);
    final calculatedStr = _calculatedTotal.toStringAsFixed(2);

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(16.w),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14.r),
        border: Border.all(color: const Color(0xFFD2E9DB)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: EdgeInsets.all(8.w),
                decoration: const BoxDecoration(
                  color: Color(0xFFE4F5EB),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.payments_outlined,
                  color: const Color(0xFF008A3D),
                  size: 20.sp,
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Step 3 of 3 — Cash Denomination',
                      style: TextStyle(
                        fontSize: 14.sp,
                        fontWeight: FontWeight.w800,
                        color: const Color(0xFF10472A),
                      ),
                    ),
                    Text(
                      'Count the physical cash collected and enter the note breakdown',
                      style: TextStyle(
                        fontSize: 10.sp,
                        color: const Color(0xFF638B74),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          SizedBox(height: 20.h),

          // Grid of notes
          GridView.count(
            crossAxisCount: MediaQuery.sizeOf(context).width < 360 ? 1 : 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            childAspectRatio: 2.3,
            crossAxisSpacing: 10.w,
            mainAxisSpacing: 12.h,
            children: [
              _denomInput(500),
              _denomInput(200),
              _denomInput(100),
              _denomInput(50),
              _denomInput(20),
              _denomInput(10),
              _denomInput(5),
              _denomInput(2),
              _denomInput(1),
            ],
          ),
          SizedBox(height: 12.h),

          // UPI Field
          Text(
            'UPI (₹)',
            style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
          ),
          SizedBox(height: 6.h),
          TextFormField(
            controller: _upiController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600),
            onChanged: (_) => setState(() {}),
            decoration: _inputDeco(),
          ),
          SizedBox(height: 20.h),

          // Mismatch / Match Bar
          Container(
            padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 12.h),
            decoration: BoxDecoration(
              color: _isMatch ? const Color(0xFFE4F5EB) : const Color(0xFFFFF8E6),
              borderRadius: BorderRadius.circular(10.r),
              border: Border.all(
                color: _isMatch ? const Color(0xFF008A3D) : const Color(0xFFFFE0B2),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Denomination Total: ₹$calculatedStr',
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w800,
                          color: const Color(0xFF10472A),
                        ),
                      ),
                      SizedBox(height: 2.h),
                      Text(
                        'Must match collected cash: ₹$collectedStr',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: const Color(0xFF638B74),
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 5.h),
                  decoration: BoxDecoration(
                    color: _isMatch ? const Color(0xFF008A3D) : const Color(0xFFD32F2F),
                    borderRadius: BorderRadius.circular(12.r),
                  ),
                  child: Text(
                    _isMatch ? 'Match' : 'Mismatch',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 10.sp,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 20.h),

          Row(
            children: [
              OutlinedButton.icon(
                onPressed: () => setState(() => _currentStep = 2),
                icon: const Icon(Icons.arrow_back),
                label: const Text('Back'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF385046),
                  side: const BorderSide(color: Color(0xFFD2E9DB)),
                  minimumSize: Size(0, 48.h),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8.r),
                  ),
                ),
              ),
              SizedBox(width: 10.w),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: (_isMatch && !_submitting) ? _submit : null,
                  icon: _submitting
                      ? SizedBox(
                          width: 18.w,
                          height: 18.w,
                          child: const CircularProgressIndicator(
                            color: Colors.white,
                            strokeWidth: 2,
                          ),
                        )
                      : const Icon(Icons.check_circle_outline),
                  label: Text(
                    _submitting ? 'Submitting...' : 'Submit for BM Approval',
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF008A3D),
                    disabledBackgroundColor: const Color(0xFFA7D1B8),
                    foregroundColor: Colors.white,
                    minimumSize: Size(0, 48.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8.r),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  num _asNum(dynamic value) => value is num
      ? value
      : num.tryParse(value?.toString().replaceAll(',', '') ?? '') ?? 0;

  Future<void> _submit() async {
    setState(() => _submitting = true);

    final upi = double.tryParse(_upiController.text.trim()) ?? 0;
    final denomination = <String, dynamic>{
      for (final entry in _denominationControllers.entries) ...{
        '${entry.key}': int.tryParse(entry.value.text.trim()) ?? 0,
        'd${entry.key}': int.tryParse(entry.value.text.trim()) ?? 0,
      },
      'upi': upi,
    };

    final collections = widget.selectedClients.map((client) {
      final amount = _asNum(
        client['collectedAmount'] ??
            client['collectAmount'] ??
            client['totalDemand'],
      );
      final advance = _asNum(
        client['loanAdvanceCollectedToday'] ?? client['loanAdvanceCollect'],
      );
      return {
        'loanId': client['loanId'],
        'clientId': client['clientId'],
        'loanNumber': client['loanNumber'],
        'scheduleIds': client['scheduleIds'],
        // The backend expects an as-yet-unconfirmed key for the per-item
        // amount ("No collections with positive amounts to process" even
        // with collectedAmount set) — send several common aliases pointing
        // at the same value until we know the real one.
        'amountCollected': amount,
        'collectedAmount': amount,
        'amount': amount,
        'collectAmount': amount,
        'paidAmount': amount,
        'collectionAmount': amount,
        'savingsCollected': advance,
        'loanAdvanceAmount': advance,
        'loanAdvanceCollect': advance,
        'loanAdvance': advance,
        'attendance': client['attendance'] ?? 'A',
      };
    }).toList();

    // A client can have multiple loans (and so multiple rows in
    // allClients), but attendance is per-client, not per-loan.
    final attendanceByClient = <String, Map<String, dynamic>>{};
    for (final client in widget.allClients) {
      final clientId = client['clientId']?.toString();
      if (clientId == null || clientId.isEmpty) continue;
      attendanceByClient[clientId] = {
        'clientId': clientId,
        'attendance': client['attendance'] ?? 'A',
      };
    }
    final attendance = attendanceByClient.values.toList();

    final controller = Get.isRegistered<CollectionController>()
        ? Get.find<CollectionController>()
        : Get.put(CollectionController());

    final result = await controller.submitDemandCollection(
      centerId: widget.centerId,
      collectionDate: widget.collectionDate,
      collections: collections,
      attendance: attendance,
      denomination: {...denomination, 'upi': upi},
      totalCollected: _calculatedTotal,
      meetingPhotoBytes: _meetingPhotoBytes,
    );

    if (!mounted) return;
    setState(() => _submitting = false);
    if (result == null) return;

    Get.snackbar(
      'Success',
      'Submitted for BM Approval successfully!',
      snackPosition: SnackPosition.BOTTOM,
      backgroundColor: const Color(0xFF008A3D),
      colorText: Colors.white,
    );
    Navigator.pop(context, true);
  }

  Widget _denomInput(int note) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '₹$note',
          style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w600),
        ),
        SizedBox(height: 4.h),
        Expanded(
          child: TextFormField(
            controller: _denominationControllers[note],
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: TextStyle(fontSize: 14.sp, fontWeight: FontWeight.w600),
            onChanged: (_) => setState(() {}),
            decoration: _inputDeco(),
          ),
        ),
      ],
    );
  }

  InputDecoration _inputDeco() => InputDecoration(
    isDense: true,
    contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 16.h),
    filled: true,
    fillColor: const Color(0xFFF7FCF8),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(8.r),
      borderSide: const BorderSide(color: Color(0xFFD2E9DB)),
    ),
  );
}
