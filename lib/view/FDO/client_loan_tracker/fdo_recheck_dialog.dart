import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/view/BM/member_approval/widgets/doc_type_labels.dart';

const _green = Color(0xFF0C5F34);
const _amber = Color(0xFFB45309);

/// FDO-side counterpart to the web app's `FDORecheckDialog.tsx`: lets the
/// FDO see exactly which KYC documents a reviewer flagged for retake (with
/// the reviewer's remark), re-upload a replacement for each, and only then
/// resubmit — mirroring `POST .../documents/{documentId}/reupload` followed
/// by `POST .../action` with `FDO_RESUBMIT`, the same two calls the web
/// dialog makes. Replaces the mobile app's previous local-only stub, which
/// never called the server at all.
class FdoRecheckDialog extends StatefulWidget {
  const FdoRecheckDialog({
    super.key,
    required this.clientId,
    required this.clientName,
    this.stageRemark,
  });

  final String clientId;
  final String clientName;
  final String? stageRemark;

  @override
  State<FdoRecheckDialog> createState() => _FdoRecheckDialogState();
}

class _FdoRecheckDialogState extends State<FdoRecheckDialog> {
  final EnrollmentApiService _api = EnrollmentApiService(ApiClient());
  final ImagePicker _picker = ImagePicker();

  bool _loading = true;
  bool _submitting = false;
  String? _uploadingDocId;
  String? _loadError;
  List<Map<String, dynamic>> _docs = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final wrapper = await _api.getApprovalClientDetail(widget.clientId);
      final client = wrapper?['client'];
      final docs = client is Map && client['kycDocuments'] is List
          ? (client['kycDocuments'] as List)
              .whereType<Map>()
              .map((d) => Map<String, dynamic>.from(d))
              .toList()
          : <Map<String, dynamic>>[];
      if (!mounted) return;
      setState(() => _docs = docs);
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadError = 'Unable to load client details: $e');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _isFlagged(Map<String, dynamic> doc) =>
      doc['bmDecision'] == 'RETAKE_REQUIRED' ||
      doc['amDecision'] == 'RETAKE_REQUIRED' ||
      doc['qcDecision'] == 'RETAKE_REQUIRED';

  String? _flagRemark(Map<String, dynamic> doc) {
    if (doc['bmDecision'] == 'RETAKE_REQUIRED') return doc['bmRemark']?.toString();
    if (doc['amDecision'] == 'RETAKE_REQUIRED') return doc['amRemark']?.toString();
    if (doc['qcDecision'] == 'RETAKE_REQUIRED') return doc['qcRemark']?.toString();
    return null;
  }

  Future<ImageSource?> _pickSource() => showModalBottomSheet<ImageSource>(
        context: context,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        ),
        builder: (ctx) => SafeArea(
          child: Wrap(
            children: [
              ListTile(
                leading: const Icon(Icons.photo_camera_outlined, color: _green),
                title: const Text('Take Photo'),
                onTap: () => Navigator.pop(ctx, ImageSource.camera),
              ),
              ListTile(
                leading: const Icon(Icons.photo_library_outlined, color: _green),
                title: const Text('Choose from Gallery'),
                onTap: () => Navigator.pop(ctx, ImageSource.gallery),
              ),
            ],
          ),
        ),
      );

  Future<void> _reupload(Map<String, dynamic> doc) async {
    final docId = doc['id']?.toString() ?? '';
    if (docId.isEmpty || _uploadingDocId != null) return;
    final source = await _pickSource();
    if (source == null) return;
    final picked = await _picker.pickImage(
      source: source,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 80,
    );
    if (picked == null) return;

    setState(() => _uploadingDocId = docId);
    try {
      final bytes = await picked.readAsBytes();
      await _api.reuploadKycDocument(
        clientId: widget.clientId,
        documentId: docId,
        bytes: bytes,
        filename: picked.name,
        contentType: 'image/jpeg',
      );
      // Reload rather than patch locally — the server resets this
      // document's flagged decision(s) back to PENDING, and that's what
      // actually determines whether the Submit button unlocks below.
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Upload failed: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _uploadingDocId = null);
    }
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await _api.submitClientApprovalAction(widget.clientId, 'FDO_RESUBMIT');
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Resubmit failed: $e'),
            backgroundColor: Colors.redAccent,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final flaggedDocs = _docs.where(_isFlagged).toList();
    final allResolved = flaggedDocs.isEmpty;

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) => Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20.r)),
        ),
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(16.r, 14.r, 16.r, 8.r),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Resolve Recheck',
                          style: TextStyle(
                            fontSize: 16.sp,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          widget.clientName,
                          style: TextStyle(
                            fontSize: 12.sp,
                            color: const Color(0xFF64748B),
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context, false),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator(color: _green))
                  : _loadError != null
                      ? Center(
                          child: Padding(
                            padding: EdgeInsets.all(24.r),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  _loadError!,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(color: Colors.redAccent),
                                ),
                                SizedBox(height: 12.h),
                                OutlinedButton(
                                  onPressed: _load,
                                  child: const Text('Retry'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView(
                          controller: scrollController,
                          padding: EdgeInsets.all(16.r),
                          children: [
                            if (flaggedDocs.isEmpty &&
                                (widget.stageRemark?.trim().isNotEmpty ?? false))
                              _banner(
                                'Sent back for recheck',
                                widget.stageRemark!.trim(),
                              ),
                            if (flaggedDocs.isNotEmpty)
                              _banner(
                                '${flaggedDocs.length} document(s) flagged for retake',
                                'Re-upload each flagged document below. Submit unlocks once all of them are resolved.',
                              ),
                            SizedBox(height: 8.h),
                            if (_docs.isEmpty)
                              const Text(
                                'No KYC documents on file.',
                                style: TextStyle(color: Color(0xFF64748B)),
                              )
                            else
                              ..._docs.map((doc) => _docTile(doc)),
                          ],
                        ),
            ),
            const Divider(height: 1),
            Padding(
              padding: EdgeInsets.all(16.r),
              child: SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: (_loading || _submitting || !allResolved)
                      ? null
                      : _submit,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _green,
                    disabledBackgroundColor: const Color(0xFFCBD5E1),
                    padding: EdgeInsets.symmetric(vertical: 12.h),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10.r),
                    ),
                  ),
                  icon: _submitting
                      ? SizedBox(
                          width: 16.r,
                          height: 16.r,
                          child: const CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send_rounded, color: Colors.white),
                  label: Text(
                    allResolved
                        ? 'Submit for Review'
                        : 'Resolve ${flaggedDocs.length} flagged document(s) first',
                    style: const TextStyle(color: Colors.white),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _banner(String title, String body) => Container(
        width: double.infinity,
        margin: EdgeInsets.only(bottom: 12.h),
        padding: EdgeInsets.all(12.r),
        decoration: BoxDecoration(
          color: const Color(0xFFFFFBEB),
          borderRadius: BorderRadius.circular(10.r),
          border: Border.all(color: const Color(0xFFFDE68A)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 12.5.sp,
                fontWeight: FontWeight.w800,
                color: _amber,
              ),
            ),
            SizedBox(height: 3.h),
            Text(
              body,
              style: TextStyle(fontSize: 11.5.sp, color: const Color(0xFF92400E)),
            ),
          ],
        ),
      );

  Widget _docTile(Map<String, dynamic> doc) {
    final docId = doc['id']?.toString() ?? '';
    final documentType = doc['documentType']?.toString() ?? '';
    final label = kycDocTypeLabel(documentType);
    final flagged = _isFlagged(doc);
    final remark = _flagRemark(doc);
    final isUploading = _uploadingDocId == docId;

    return Container(
      margin: EdgeInsets.only(bottom: 10.h),
      padding: EdgeInsets.all(12.r),
      decoration: BoxDecoration(
        color: flagged ? const Color(0xFFFFF7ED) : Colors.white,
        borderRadius: BorderRadius.circular(12.r),
        border: Border.all(
          color: flagged ? const Color(0xFFFDBA74) : const Color(0xFFE1EEE6),
        ),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        label,
                        style: TextStyle(
                          fontSize: 13.sp,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    if (flagged)
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 8.w,
                          vertical: 2.h,
                        ),
                        decoration: BoxDecoration(
                          color: _amber,
                          borderRadius: BorderRadius.circular(20.r),
                        ),
                        child: Text(
                          'Retake',
                          style: TextStyle(
                            fontSize: 9.5.sp,
                            fontWeight: FontWeight.w700,
                            color: Colors.white,
                          ),
                        ),
                      )
                    else
                      Icon(
                        Icons.check_circle_rounded,
                        size: 16.sp,
                        color: _green,
                      ),
                  ],
                ),
                if (flagged && remark != null && remark.isNotEmpty) ...[
                  SizedBox(height: 4.h),
                  Text(
                    remark,
                    style: TextStyle(fontSize: 11.sp, color: _amber),
                  ),
                ],
              ],
            ),
          ),
          if (flagged) ...[
            SizedBox(width: 10.w),
            OutlinedButton.icon(
              onPressed: isUploading ? null : () => _reupload(doc),
              icon: isUploading
                  ? SizedBox(
                      width: 14.r,
                      height: 14.r,
                      child: const CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.upload_file_outlined, size: 15),
              label: Text(
                isUploading ? 'Uploading…' : 'Re-upload',
                style: TextStyle(fontSize: 11.5.sp),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: _green,
                side: const BorderSide(color: Color(0xFFBBE5CE)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
