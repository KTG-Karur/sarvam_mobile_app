import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/enrollment_api_service.dart';
import 'package:sarvam/constant/roles.dart';

/// Drives the BM-only "Member Approval" screen — a Flutter port of the web
/// app's `ApprovalWorkbenchClient.tsx` (Tab 1: client enrollment approval
/// chain; Tab 2: independent co-applicant BM→AM→QC→Admin workflow). Only
/// whole-record actions are implemented (Submit to AM / Retake / Reject,
/// Approve/Reject) — no per-KYC-document review in this pass.
class MemberApprovalController extends GetxController {
  final EnrollmentApiService api = EnrollmentApiService(ApiClient());

  Future<bool> _isBranchManager() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return RoleScope.isBranchManager(
        prefs.getString('rbacRoleName') ?? prefs.getString('role') ?? '',
      );
    } catch (_) {
      return false;
    }
  }

  /// Public role helpers for views
  Future<bool> isBranchManagerRole() => _isBranchManager();

  Future<bool> isAreaManagerRole() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return RoleScope.isAreaManager(
        prefs.getString('rbacRoleName') ?? prefs.getString('role') ?? '',
      );
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Tab 1 — Member Approval (client enrollment review)
  // ---------------------------------------------------------------------

  final approvalQueue = <dynamic>[].obs;
  final isLoadingQueue = false.obs;
  final searchQuery = ''.obs;

  final Rxn<Map<String, dynamic>> clientDetail = Rxn<Map<String, dynamic>>();
  final RxList<dynamic> checklist = <dynamic>[].obs;
  final isLoadingDetail = false.obs;
  final isSubmittingClientAction = false.obs;
  final Rxn<String> submittingDocId = Rxn<String>();

  Future<void> loadApprovalQueue() async {
    isLoadingQueue.value = true;
    try {
      approvalQueue.assignAll(
        await api.getApprovalQueue(search: searchQuery.value),
      );
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load approval queue: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingQueue.value = false;
    }
  }

  /// `GET /api/approval/clients/{clientId}` responds with the client record
  /// nested inside a `{client, groups, checklist, dynamicLevel}` wrapper —
  /// not the client record itself. [clientDetail] must hold the unwrapped
  /// `client` map (the view reads fields like `detail['firstName']`
  /// directly), otherwise every field silently falls back to '—' and KYC
  /// documents/action buttons never appear.
  Future<void> loadClientDetail(String clientId) async {
    final isInitialLoad = clientDetail.value == null;
    if (isInitialLoad) {
      clientDetail.value = null;
      checklist.clear();
    }
    isLoadingDetail.value = true;
    try {
      final wrapper = await api.getApprovalClientDetail(clientId);
      final client = wrapper?['client'];
      clientDetail.value = client is Map
          ? Map<String, dynamic>.from(client)
          : null;
      final items = wrapper?['checklist'];
      checklist.assignAll(items is List ? items : const []);
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load client detail: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingDetail.value = false;
    }
  }

  /// [decision] is one of `VERIFIED`, `RETAKE_REQUIRED`, `DELETED`,
  /// `REJECTED`. Reloads the full client detail on success so the doc's
  /// updated bmDecision/remark/reviewer and the checklist stay in sync
  /// (simpler and safer than patching the nested list locally).
  Future<bool> submitDocumentReview(
    String clientId,
    String documentId,
    String decision, {
    String? remark,
  }) async {
    submittingDocId.value = documentId;
    try {
      await api.reviewKycDocument(
        clientId,
        documentId,
        decision,
        remark: remark,
      );
      await loadClientDetail(clientId);
      return true;
    } catch (e) {
      Get.snackbar(
        'Action Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      submittingDocId.value = null;
    }
  }

  /// [action] is one of `BM_SUBMIT_TO_AM`, `BM_RETAKE`, `BM_REJECT`,
  /// `AM_APPROVE`, `AM_RETAKE`, `AM_REJECT`.
  Future<bool> submitClientAction(
    String clientId,
    String action, {
    String? remarks,
  }) async {
    isSubmittingClientAction.value = true;
    try {
      final result = await api.submitClientApprovalAction(
        clientId,
        action,
        remarks: remarks,
      );
      Get.snackbar(
        'Success',
        result['message']?.toString() ?? 'Action completed successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      approvalQueue.removeWhere(
        (c) => c is Map && c['clientId']?.toString() == clientId,
      );
      return true;
    } on EnrollmentApiException catch (e) {
      Get.snackbar(
        'Action Failed',
        e.message,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } catch (e) {
      Get.snackbar(
        'Action Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      isSubmittingClientAction.value = false;
    }
  }

  /// Verification & Approval action for Branch Manager (BM)
  Future<bool> verifyAndSubmitMember(String clientId, {String? remarks}) async {
    return submitClientAction(clientId, 'BM_SUBMIT_TO_AM', remarks: remarks);
  }

  /// Request retake of documents for a member (BM)
  Future<bool> requestMemberRetake(String clientId, String remarks) async {
    return submitClientAction(clientId, 'BM_RETAKE', remarks: remarks);
  }

  /// Reject a member enrollment application (BM)
  Future<bool> rejectMember(String clientId, String remarks) async {
    return submitClientAction(clientId, 'BM_REJECT', remarks: remarks);
  }

  /// Final approval action for Area Manager (AM)
  Future<bool> approveMemberAM(String clientId, {String? remarks}) async {
    return submitClientAction(clientId, 'AM_APPROVE', remarks: remarks);
  }

  /// Request retake of documents for a member (AM)
  Future<bool> requestMemberRetakeAM(String clientId, String remarks) async {
    return submitClientAction(clientId, 'AM_RETAKE', remarks: remarks);
  }

  /// Reject a member enrollment application (AM)
  Future<bool> rejectMemberAM(String clientId, String remarks) async {
    return submitClientAction(clientId, 'AM_REJECT', remarks: remarks);
  }

  /// Bulk approval action for multiple clients at once
  Future<bool> submitBulkClientAction(
    List<String> clientIds,
    String action, {
    String? remarks,
  }) async {
    if (clientIds.isEmpty) return false;
    isSubmittingClientAction.value = true;
    try {
      final result = await api.submitBulkClientApprovalAction(
        clientIds,
        action,
        remarks: remarks,
      );
      Get.snackbar(
        'Success',
        result['message']?.toString() ?? 'Bulk action completed successfully.',
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      approvalQueue.removeWhere(
        (c) => c is Map && clientIds.contains(c['clientId']?.toString()),
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Bulk Action Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      isSubmittingClientAction.value = false;
    }
  }

  // ---------------------------------------------------------------------
  // Tab 2 — Co-Applicant Approval
  // ---------------------------------------------------------------------

  final coApplicantQueue = <dynamic>[].obs;
  final isLoadingCoApplicants = false.obs;
  final Map<String, RxBool> coApplicantSubmitting = {};

  RxBool _coApplicantSubmittingFlag(String id) =>
      coApplicantSubmitting.putIfAbsent(id, () => false.obs);

  Future<void> loadCoApplicantQueue() async {
    isLoadingCoApplicants.value = true;
    try {
      coApplicantQueue.assignAll(await api.getCoApplicantApprovalQueue());
    } catch (e) {
      Get.snackbar(
        'Error',
        'Failed to load co-applicant queue: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingCoApplicants.value = false;
    }
  }

  /// [action] is lowercase `'approve'` or `'reject'`.
  Future<bool> submitCoApplicantAction(
    String id,
    String action, {
    String? remarks,
  }) async {
    final isBm = await _isBranchManager();
    final isAm = await isAreaManagerRole();
    if (!isBm && !isAm) {
      Get.snackbar(
        'Action Not Allowed',
        'Your role does not permit this action.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return false;
    }

    final submitting = _coApplicantSubmittingFlag(id);
    submitting.value = true;
    try {
      final result = await api.submitCoApplicantAction(
        id,
        action,
        remarks: remarks,
      );
      Get.snackbar(
        'Success',
        result['message']?.toString() ??
            (action == 'approve' ? 'Approved' : 'Rejected'),
        backgroundColor: const Color(0xFF008A3D),
        colorText: Colors.white,
      );
      coApplicantQueue.removeWhere(
        (c) => c is Map && c['id']?.toString() == id,
      );
      return true;
    } catch (e) {
      Get.snackbar(
        'Action Failed',
        '$e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
        duration: const Duration(seconds: 5),
      );
      return false;
    } finally {
      submitting.value = false;
    }
  }

  // ---------------------------------------------------------------------
  // Shared — signed URL resolution for private-bucket KYC documents
  // ---------------------------------------------------------------------

  final RxMap<String, String> signedUrlCache = <String, String>{}.obs;
  final Set<String> _resolvingKeys = {};

  /// Resolves [key] to a viewable URL once, caching the result. Callers
  /// should read [signedUrlCache] reactively (e.g. via `Obx`) and call this
  /// to kick off resolution the first time a document is rendered.
  Future<void> resolveSignedUrl(String key) async {
    if (key.isEmpty ||
        signedUrlCache.containsKey(key) ||
        _resolvingKeys.contains(key)) {
      return;
    }
    _resolvingKeys.add(key);
    try {
      final url = await api.getSignedUrl(key);
      if (url != null) signedUrlCache[key] = url;
    } catch (e) {
      debugPrint('Failed to resolve signed URL for $key: $e');
    } finally {
      _resolvingKeys.remove(key);
    }
  }
}
