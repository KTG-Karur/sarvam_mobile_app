import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/grt_api_service.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

class GrtSessionConductScreen extends StatefulWidget {
  const GrtSessionConductScreen({
    super.key,
    required this.sessionId,
    required this.centerName,
  });

  final String sessionId;
  final String centerName;

  @override
  State<GrtSessionConductScreen> createState() =>
      _GrtSessionConductScreenState();
}

class _GrtSessionConductScreenState extends State<GrtSessionConductScreen> {
  late final GrtApiService _api = GrtApiService(
    Get.isRegistered<ApiClient>()
        ? Get.find<ApiClient>()
        : Get.put(ApiClient()),
  );

  bool _isLoading = true;
  bool _isSaving = false;
  bool _isCompleting = false;
  bool _isUploadingPhoto = false;

  Map<String, dynamic>? _sessionData;
  final Map<String, bool?> _answersBool = {};
  final Map<String, TextEditingController> _answersTextCtrl = {};
  final RxMap<String, String> _signedUrlCache = <String, String>{}.obs;
  final Set<String> _resolvingKeys = <String>{};

  @override
  void initState() {
    super.initState();
    _loadSession();
  }

  @override
  void dispose() {
    for (final c in _answersTextCtrl.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _resolveSignedUrl(String key) async {
    if (key.isEmpty ||
        _signedUrlCache.containsKey(key) ||
        _resolvingKeys.contains(key)) {
      return;
    }
    if (key.startsWith('http://') ||
        key.startsWith('https://') ||
        key.startsWith('data:')) {
      _signedUrlCache[key] = key;
      return;
    }
    if (key.startsWith('/')) {
      _signedUrlCache[key] = '${Api.baseUrl}$key';
      return;
    }

    _resolvingKeys.add(key);
    try {
      final rawUrl = await _api.getSignedUrl(key);
      if (rawUrl != null && rawUrl.isNotEmpty) {
        String finalUrl = rawUrl;
        if (finalUrl.startsWith('/')) {
          finalUrl = '${Api.baseUrl}$finalUrl';
        }
        _signedUrlCache[key] = finalUrl;
      }
    } catch (e) {
      debugPrint('Failed to resolve signed URL for $key: $e');
    } finally {
      _resolvingKeys.remove(key);
    }
  }

  Future<void> _loadSession() async {
    setState(() => _isLoading = true);
    try {
      final res = await _api.getGrtSessionDetail(widget.sessionId);
      _sessionData = res;

      final questions = (res['questionnaire']?['questions'] as List?) ?? [];
      final existingAnswers = (res['answers'] as List?) ?? [];

      for (final q in questions) {
        final qId = q['id'].toString();
        _answersTextCtrl[qId] ??= TextEditingController();

        final ans = existingAnswers.firstWhere(
          (a) => a['questionId']?.toString() == qId,
          orElse: () => null,
        );
        if (ans != null) {
          if (ans['answerBool'] is bool) {
            _answersBool[qId] = ans['answerBool'] as bool;
          }
          if (ans['answerText'] != null) {
            _answersTextCtrl[qId]?.text = ans['answerText'].toString();
          }
        }
      }
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load GRT Session: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<bool> _saveAnswers() async {
    setState(() => _isSaving = true);
    try {
      final questions =
          (_sessionData?['questionnaire']?['questions'] as List?) ?? [];
      final payload = <Map<String, dynamic>>[];

      for (final q in questions) {
        final qId = q['id'].toString();
        payload.add({
          'questionId': qId,
          'answerBool': _answersBool[qId],
          'answerText': _answersTextCtrl[qId]?.text.trim(),
        });
      }

      await _api.saveGrtAnswers(widget.sessionId, payload);
      Get.snackbar(
        'Saved',
        'GRT Answers saved.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to save GRT answers: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  Future<void> _uploadPhoto({
    String? questionId,
    required bool useCamera,
  }) async {
    final picked = await ImagePicker().pickImage(
      source: useCamera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 80,
    );
    if (picked == null) return;

    setState(() => _isUploadingPhoto = true);
    try {
      final bytes = await picked.readAsBytes();
      await _api.uploadGrtPhoto(
        widget.sessionId,
        bytes: bytes,
        filename: picked.name,
        contentType: 'image/jpeg',
        questionId: questionId,
      );
      Get.snackbar(
        'Uploaded',
        'Photo uploaded successfully.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await _loadSession();
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to upload photo: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      if (mounted) setState(() => _isUploadingPhoto = false);
    }
  }

  Future<void> _deletePhoto(String photoId) async {
    try {
      await _api.deleteGrtPhoto(widget.sessionId, photoId);
      Get.snackbar(
        'Deleted',
        'Photo removed.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      await _loadSession();
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to remove photo: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }

  Future<void> _completeSession() async {
    final saved = await _saveAnswers();
    if (!saved) return;

    setState(() => _isCompleting = true);
    try {
      await _api.completeGrtSession(widget.sessionId);
      Get.snackbar(
        'Completed',
        'GRT Session marked complete.',
        backgroundColor: const Color(0xFF00843D),
        colorText: Colors.white,
      );
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      Get.snackbar(
        'Cannot Complete',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      if (mounted) setState(() => _isCompleting = false);
    }
  }

  Widget _storageImageWidget(
    String? photoKey, {
    required double width,
    required double height,
  }) {
    if (photoKey == null || photoKey.trim().isEmpty) {
      return Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: const Color(0xFFEFF3F1),
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Icon(Icons.image_outlined, size: 20.sp, color: _muted),
      );
    }

    final key = photoKey.trim();
    _resolveSignedUrl(key);

    return Obx(() {
      final url = _signedUrlCache[key];
      if (url == null) {
        return Container(
          width: width,
          height: height,
          decoration: BoxDecoration(
            color: const Color(0xFFEFF3F1),
            borderRadius: BorderRadius.circular(8.r),
          ),
          alignment: Alignment.center,
          child: SizedBox(
            width: 14.sp,
            height: 14.sp,
            child: const CircularProgressIndicator(
              strokeWidth: 2,
              color: _green,
            ),
          ),
        );
      }
      return ClipRRect(
        borderRadius: BorderRadius.circular(8.r),
        child: Image.network(
          url,
          width: width,
          height: height,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Container(
            width: width,
            height: height,
            color: const Color(0xFFEFF3F1),
            child: Icon(
              Icons.broken_image_outlined,
              size: 20.sp,
              color: Colors.redAccent,
            ),
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final isComplete = _sessionData?['completedAt'] != null;

    return Theme(
      data: Theme.of(context).copyWith(
        textTheme: GoogleFonts.poppinsTextTheme(Theme.of(context).textTheme),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF7FBF8),
        appBar: AppBar(
          elevation: 0,
          backgroundColor: Colors.white,
          leading: IconButton(
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.arrow_back, color: _green),
          ),
          title: Text(
            'Conduct GRT Session',
            style: TextStyle(
              fontSize: 16.sp,
              fontWeight: FontWeight.w800,
              color: const Color(0xFF10472A),
            ),
          ),
        ),
        body: SafeArea(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: _green))
              : _sessionData == null
              ? const Center(child: Text('Session data not found.'))
              : SingleChildScrollView(
                  padding: EdgeInsets.all(16.w),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildHeaderCard(isComplete),
                      SizedBox(height: 14.h),
                      _buildMembersCard(),
                      SizedBox(height: 14.h),
                      _buildQuestionsSection(isComplete),
                      SizedBox(height: 14.h),
                      _buildSessionPhotosSection(isComplete),
                      SizedBox(height: 20.h),
                      if (!isComplete) ...[
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton(
                                onPressed: _isSaving ? null : _saveAnswers,
                                style: OutlinedButton.styleFrom(
                                  foregroundColor: _green,
                                  side: const BorderSide(color: _green),
                                  padding: EdgeInsets.symmetric(vertical: 13.h),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10.r),
                                  ),
                                ),
                                child: _isSaving
                                    ? SizedBox(
                                        width: 16.sp,
                                        height: 16.sp,
                                        child: const CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: _green,
                                        ),
                                      )
                                    : Text(
                                        'Save Draft',
                                        style: TextStyle(
                                          fontSize: 13.sp,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                              ),
                            ),
                            SizedBox(width: 10.w),
                            Expanded(
                              child: ElevatedButton(
                                onPressed: (_isCompleting || _isSaving)
                                    ? null
                                    : _completeSession,
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: _green,
                                  foregroundColor: Colors.white,
                                  padding: EdgeInsets.symmetric(vertical: 13.h),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10.r),
                                  ),
                                ),
                                child: _isCompleting
                                    ? SizedBox(
                                        width: 16.sp,
                                        height: 16.sp,
                                        child: const CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : Text(
                                        'Complete Session',
                                        style: TextStyle(
                                          fontSize: 13.sp,
                                          fontWeight: FontWeight.w700,
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
    );
  }

  Widget _buildHeaderCard(bool isComplete) {
    final sId = _sessionData?['sessionId']?.toString() ?? widget.sessionId;
    final qTitle =
        _sessionData?['questionnaire']?['title']?.toString() ?? 'Questionnaire';
    final dateStr =
        _sessionData?['sessionDate']?.toString().split('T')[0] ?? '';

    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Session: $sId',
                style: TextStyle(
                  fontSize: 14.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
              Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 4.h),
                decoration: BoxDecoration(
                  color: isComplete
                      ? const Color(0xFFDCFCE7)
                      : const Color(0xFFFFF8E1),
                  borderRadius: BorderRadius.circular(6.r),
                  border: Border.all(
                    color: isComplete
                        ? const Color(0xFF86EFAC)
                        : const Color(0xFFF5DD9E),
                  ),
                ),
                child: Text(
                  isComplete ? 'COMPLETED' : 'IN PROGRESS',
                  style: TextStyle(
                    fontSize: 10.sp,
                    fontWeight: FontWeight.w800,
                    color: isComplete
                        ? const Color(0xFF15803D)
                        : const Color(0xFF9A6B00),
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 6.h),
          Text(
            qTitle,
            style: TextStyle(
              fontSize: 12.sp,
              fontWeight: FontWeight.w600,
              color: _green,
            ),
          ),
          SizedBox(height: 4.h),
          Text(
            '${widget.centerName} · Date: $dateStr',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
        ],
      ),
    );
  }

  Widget _buildMembersCard() {
    final clients = (_sessionData?['clients'] as List?) ?? [];
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(14.w),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: const Color(0xFFE1EAE4)),
        borderRadius: BorderRadius.circular(14.r),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.people_alt_rounded, size: 16.sp, color: _green),
              SizedBox(width: 6.w),
              Text(
                'Members Included (${clients.length})',
                style: TextStyle(
                  fontSize: 12.5.sp,
                  fontWeight: FontWeight.w800,
                  color: _darkText,
                ),
              ),
            ],
          ),
          SizedBox(height: 8.h),
          Wrap(
            spacing: 6.w,
            runSpacing: 6.h,
            children: clients.map((c) {
              final name =
                  '${c['client']?['firstName'] ?? ''} ${c['client']?['lastName'] ?? ''}'
                      .trim();
              final cId = c['client']?['clientId']?.toString() ?? '';
              return Container(
                padding: EdgeInsets.symmetric(horizontal: 10.w, vertical: 5.h),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0FAF4),
                  borderRadius: BorderRadius.circular(8.r),
                  border: Border.all(color: const Color(0xFFE1EAE4)),
                ),
                child: Text(
                  '$cId · $name',
                  style: TextStyle(
                    fontSize: 10.5.sp,
                    fontWeight: FontWeight.w600,
                    color: _darkText,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildQuestionsSection(bool isComplete) {
    final questions =
        (_sessionData?['questionnaire']?['questions'] as List?) ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Questionnaire Answers',
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
        SizedBox(height: 10.h),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: questions.length,
          separatorBuilder: (_, __) => SizedBox(height: 10.h),
          itemBuilder: (_, index) {
            final q = questions[index];
            final qId = q['id'].toString();
            final qText = q['question']?.toString() ?? '';

            return Container(
              padding: EdgeInsets.all(12.w),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: const Color(0xFFE1EAE4)),
                borderRadius: BorderRadius.circular(12.r),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      CircleAvatar(
                        radius: 11.r,
                        backgroundColor: const Color(0xFFE6F5EC),
                        child: Text(
                          '${index + 1}',
                          style: TextStyle(
                            fontSize: 10.sp,
                            fontWeight: FontWeight.w800,
                            color: _green,
                          ),
                        ),
                      ),
                      SizedBox(width: 8.w),
                      Expanded(
                        child: Text(
                          qText,
                          style: TextStyle(
                            fontSize: 12.sp,
                            fontWeight: FontWeight.w700,
                            color: _darkText,
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 10.h),
                  Padding(
                    padding: EdgeInsets.only(left: 30.w),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            _toggleAnswerBtn(qId, true, 'Yes', isComplete),
                            SizedBox(width: 8.w),
                            _toggleAnswerBtn(qId, false, 'No', isComplete),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _toggleAnswerBtn(String qId, bool val, String label, bool isComplete) {
    final selected = _answersBool[qId] == val;
    final color = val ? const Color(0xFF00843D) : Colors.redAccent;

    return InkWell(
      onTap: isComplete
          ? null
          : () => setState(() => _answersBool[qId] = selected ? null : val),
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 14.w, vertical: 6.h),
        decoration: BoxDecoration(
          color: selected ? color.withValues(alpha: 0.12) : Colors.white,
          border: Border.all(
            color: selected ? color : const Color(0xFFCBD5E1),
            width: selected ? 1.5 : 1,
          ),
          borderRadius: BorderRadius.circular(8.r),
        ),
        child: Row(
          children: [
            Icon(
              selected
                  ? (val ? Icons.check_circle_rounded : Icons.cancel_rounded)
                  : Icons.radio_button_unchecked,
              size: 14.sp,
              color: selected ? color : _muted,
            ),
            SizedBox(width: 5.w),
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5.sp,
                fontWeight: FontWeight.w700,
                color: selected ? color : _darkText,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessionPhotosSection(bool isComplete) {
    final photos = (_sessionData?['photos'] as List?) ?? [];
    final sessionPhotos = photos.where((p) => p['questionId'] == null).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Session Photos',
          style: TextStyle(
            fontSize: 13.sp,
            fontWeight: FontWeight.w800,
            color: _darkText,
          ),
        ),
        SizedBox(height: 8.h),
        if (sessionPhotos.isNotEmpty)
          SizedBox(
            height: 80.h,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: sessionPhotos.length,
              separatorBuilder: (_, __) => SizedBox(width: 8.w),
              itemBuilder: (_, index) {
                final p = sessionPhotos[index];
                final pId = p['id'].toString();
                final key = p['photoUrl']?.toString();
                return Stack(
                  children: [
                    _storageImageWidget(key, width: 80.h, height: 80.h),
                    if (!isComplete)
                      Positioned(
                        top: 2,
                        right: 2,
                        child: GestureDetector(
                          onTap: () => _deletePhoto(pId),
                          child: CircleAvatar(
                            radius: 10.r,
                            backgroundColor: Colors.black54,
                            child: Icon(
                              Icons.close,
                              size: 12.sp,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          )
        else
          Text(
            'No session photos uploaded yet.',
            style: TextStyle(fontSize: 11.sp, color: _muted),
          ),
        if (!isComplete) ...[
          SizedBox(height: 8.h),
          OutlinedButton.icon(
            onPressed: _isUploadingPhoto
                ? null
                : () => _uploadPhoto(useCamera: true),
            style: OutlinedButton.styleFrom(
              foregroundColor: _green,
              side: const BorderSide(color: _green),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8.r),
              ),
            ),
            icon: const Icon(Icons.camera_alt_rounded, size: 16),
            label: const Text('Add Session Photo'),
          ),
        ],
      ],
    );
  }
}
