import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/grt_api_service.dart';
import 'package:sarvam/services/member_individual_api_service.dart';

const _green = Color(0xFF0D6842);
const _darkText = Color(0xFF172033);
const _muted = Color(0xFF64748B);

class GrtSessionCreateDialog extends StatefulWidget {
  const GrtSessionCreateDialog({
    super.key,
    required this.centerId,
    required this.centerName,
  });

  final String centerId;
  final String centerName;

  @override
  State<GrtSessionCreateDialog> createState() => _GrtSessionCreateDialogState();
}

class _GrtSessionCreateDialogState extends State<GrtSessionCreateDialog> {
  late final GrtApiService _grtApi = GrtApiService(
    Get.isRegistered<ApiClient>() ? Get.find<ApiClient>() : Get.put(ApiClient()),
  );
  late final MemberIndividualApiService _memberApi = MemberIndividualApiService(
    Get.isRegistered<ApiClient>() ? Get.find<ApiClient>() : Get.put(ApiClient()),
  );

  bool _isLoading = true;
  bool _isCreating = false;

  DateTime _sessionDate = DateTime.now();
  List<dynamic> _questionnaires = [];
  String? _selectedQuestionnaireId;

  List<dynamic> _rosterLoans = [];
  final Set<String> _selectedLoanIds = {};

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  Future<void> _loadInitialData() async {
    setState(() => _isLoading = true);
    try {
      final qList = await _grtApi.getQuestionnaires();
      final roster = await _memberApi.getRoster(widget.centerId);

      _questionnaires = qList;
      if (qList.isNotEmpty) {
        _selectedQuestionnaireId = qList[0]['id']?.toString();
      }

      _rosterLoans = roster;
      for (final loan in roster) {
        final lId = loan['loanId']?.toString();
        final grtDone = loan['grtComplete'] == true;
        if (lId != null && !grtDone) {
          _selectedLoanIds.add(lId);
        }
      }
    } catch (e) {
      Get.snackbar('Error', 'Failed to load options: $e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _handleCreate() async {
    if (_selectedQuestionnaireId == null || _selectedQuestionnaireId!.isEmpty) {
      Get.snackbar('Select Questionnaire', 'Please select a GRT questionnaire.', backgroundColor: Colors.redAccent, colorText: Colors.white);
      return;
    }
    if (_selectedLoanIds.isEmpty) {
      Get.snackbar('Select Members', 'Please select at least one member loan for this GRT session.', backgroundColor: Colors.redAccent, colorText: Colors.white);
      return;
    }

    setState(() => _isCreating = true);
    try {
      final dateStr = '${_sessionDate.year}-${_sessionDate.month.toString().padLeft(2, '0')}-${_sessionDate.day.toString().padLeft(2, '0')}';
      final res = await _grtApi.createGrtSession(
        centerId: widget.centerId,
        sessionDate: dateStr,
        questionnaireId: _selectedQuestionnaireId!,
        loanIds: _selectedLoanIds.toList(),
      );

      final sessionId = res['sessionId']?.toString() ?? res['id']?.toString();
      Get.snackbar('Created', 'GRT Session created successfully.', backgroundColor: const Color(0xFF00843D), colorText: Colors.white);
      if (mounted) Navigator.pop(context, sessionId);
    } catch (e) {
      Get.snackbar('Error', 'Failed to create GRT session: $e', backgroundColor: Colors.redAccent, colorText: Colors.white);
    } finally {
      if (mounted) setState(() => _isCreating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16.r)),
      insetPadding: EdgeInsets.symmetric(horizontal: 16.w, vertical: 24.h),
      child: Container(
        padding: EdgeInsets.all(16.w),
        constraints: BoxConstraints(maxHeight: 0.85.sh),
        child: _isLoading
            ? const Center(child: CircularProgressIndicator(color: _green))
            : Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Create GRT Session', style: TextStyle(fontSize: 16.sp, fontWeight: FontWeight.w800, color: _darkText)),
                      IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close, color: _muted)),
                    ],
                  ),
                  Text(widget.centerName, style: TextStyle(fontSize: 11.sp, color: _muted)),
                  SizedBox(height: 12.h),

                  Text('Session Date', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText)),
                  SizedBox(height: 4.h),
                  InkWell(
                    onTap: () async {
                      final picked = await showDatePicker(
                        context: context,
                        initialDate: _sessionDate,
                        firstDate: DateTime(2025),
                        lastDate: DateTime(2030),
                      );
                      if (picked != null) setState(() => _sessionDate = picked);
                    },
                    child: Container(
                      padding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 10.h),
                      decoration: BoxDecoration(border: Border.all(color: const Color(0xFFCBD5E1)), borderRadius: BorderRadius.circular(8.r)),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('${_sessionDate.day.toString().padLeft(2, '0')}-${_sessionDate.month.toString().padLeft(2, '0')}-${_sessionDate.year}', style: TextStyle(fontSize: 12.sp, color: _darkText)),
                          Icon(Icons.calendar_today_rounded, size: 16.sp, color: _green),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 12.h),

                  Text('Questionnaire', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText)),
                  SizedBox(height: 4.h),
                  DropdownButtonFormField<String>(
                    initialValue: _selectedQuestionnaireId,
                    decoration: InputDecoration(
                      contentPadding: EdgeInsets.symmetric(horizontal: 12.w, vertical: 8.h),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8.r)),
                    ),
                    items: _questionnaires.map((q) {
                      return DropdownMenuItem<String>(
                        value: q['id']?.toString(),
                        child: Text(q['title']?.toString() ?? '', style: TextStyle(fontSize: 12.sp)),
                      );
                    }).toList(),
                    onChanged: (val) => setState(() => _selectedQuestionnaireId = val),
                  ),
                  SizedBox(height: 12.h),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('Select Members (${_selectedLoanIds.length}/${_rosterLoans.length})', style: TextStyle(fontSize: 11.sp, fontWeight: FontWeight.w700, color: _darkText)),
                      TextButton(
                        onPressed: () {
                          setState(() {
                            if (_selectedLoanIds.length == _rosterLoans.length) {
                              _selectedLoanIds.clear();
                            } else {
                              _selectedLoanIds.addAll(_rosterLoans.map((l) => l['loanId'].toString()));
                            }
                          });
                        },
                        child: Text(
                          _selectedLoanIds.length == _rosterLoans.length ? 'Deselect All' : 'Select All',
                          style: TextStyle(fontSize: 11.sp, color: _green, fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 4.h),

                  Expanded(
                    child: ListView.separated(
                      shrinkWrap: true,
                      itemCount: _rosterLoans.length,
                      separatorBuilder: (_, __) => SizedBox(height: 6.h),
                      itemBuilder: (_, index) {
                        final loan = _rosterLoans[index];
                        final lId = loan['loanId']?.toString() ?? '';
                        final clientName = loan['clientName']?.toString() ?? 'Client';
                        final cDisplayId = loan['clientDisplayId']?.toString() ?? '';
                        final grtDone = loan['grtComplete'] == true;
                        final isChecked = _selectedLoanIds.contains(lId);

                        return CheckboxListTile(
                          dense: true,
                          contentPadding: EdgeInsets.symmetric(horizontal: 8.w),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8.r), side: const BorderSide(color: Color(0xFFE1EAE4))),
                          title: Text('$cDisplayId — $clientName', style: TextStyle(fontSize: 11.5.sp, fontWeight: FontWeight.w700, color: _darkText)),
                          subtitle: Text('Loan: ${loan['loanNumber'] ?? ''}${grtDone ? ' · (GRT Completed)' : ''}', style: TextStyle(fontSize: 10.sp, color: _muted)),
                          activeColor: _green,
                          value: isChecked,
                          onChanged: (val) {
                            setState(() {
                              if (val == true) {
                                _selectedLoanIds.add(lId);
                              } else {
                                _selectedLoanIds.remove(lId);
                              }
                            });
                          },
                        );
                      },
                    ),
                  ),
                  SizedBox(height: 14.h),

                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isCreating ? null : _handleCreate,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: _green,
                        foregroundColor: Colors.white,
                        padding: EdgeInsets.symmetric(vertical: 12.h),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10.r)),
                      ),
                      child: _isCreating
                          ? SizedBox(width: 16.sp, height: 16.sp, child: const CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                          : Text('Create Session', style: TextStyle(fontSize: 13.sp, fontWeight: FontWeight.w700)),
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}
