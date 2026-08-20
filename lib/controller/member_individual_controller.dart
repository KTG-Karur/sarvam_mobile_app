import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:sarvam/services/api_client.dart';
import 'package:sarvam/services/loan_api_service.dart';
import 'package:sarvam/services/member_individual_api_service.dart';

/// Powers the BM "Member Individual" roster screen — mirrors
/// `components/loan-module/MemberIndividualClient.tsx`'s roster tab (Members
/// only; GRT Sessions stays web-only). BM picks a center and sees indexed,
/// non-disbursed loans with per-tab completion status.
class MemberIndividualController extends GetxController {
  MemberIndividualController({MemberIndividualApiService? api, LoanApiService? loanApi})
    : api =
          api ??
          MemberIndividualApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          ),
      loanApi =
          loanApi ??
          LoanApiService(
            Get.isRegistered<ApiClient>()
                ? Get.find<ApiClient>()
                : Get.put(ApiClient()),
          );

  final MemberIndividualApiService api;
  // Reused only for its already-role-scoped `getApprovedCenters()` lookup.
  final LoanApiService loanApi;

  final isLoadingCenters = true.obs;
  final isLoadingRoster = false.obs;

  final centers = <dynamic>[].obs;
  final roster = <dynamic>[].obs;

  final Rxn<String> centerId = Rxn<String>();

  @override
  void onInit() {
    super.onInit();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    isLoadingCenters.value = true;
    try {
      final result = await loanApi.getApprovedCenters();
      centers.assignAll(result);
      if (centers.length == 1) {
        final only = centers.first;
        if (only is Map && only['id'] != null) {
          await onCenterChanged(only['id'].toString());
        }
      }
    } catch (e) {
      debugPrint('Failed to load Member Individual centers: $e');
      Get.snackbar(
        'Error',
        'Failed to load centers. Pull to refresh and try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingCenters.value = false;
    }
  }

  Future<void> onCenterChanged(String? value) async {
    centerId.value = value;
    roster.clear();
    if (value == null || value.isEmpty) return;

    isLoadingRoster.value = true;
    try {
      roster.assignAll(await api.getRoster(value));
    } catch (e) {
      debugPrint('Failed to load Member Individual roster: $e');
      Get.snackbar(
        'Error',
        'Failed to load roster for this center. Please try again.',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    } finally {
      isLoadingRoster.value = false;
    }
  }

  Future<void> reloadRoster() => onCenterChanged(centerId.value);
}
