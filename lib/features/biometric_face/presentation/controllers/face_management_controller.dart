import 'package:get/get.dart';
import '../../data/repositories/face_biometric_repository_impl.dart';
import '../../domain/repositories/face_biometric_repository.dart';

class FaceManagementController extends GetxController {
  final IFaceBiometricRepository _repository;
  final String userId;

  final RxBool isEnrolled = false.obs;
  final RxBool isConsentGranted = false.obs;
  final RxBool isLoading = false.obs;
  final RxString statusMessage = ''.obs;

  FaceManagementController({
    required this.userId,
    IFaceBiometricRepository? repository,
  }) : _repository = repository ?? FaceBiometricRepositoryImpl();

  @override
  void onInit() {
    super.onInit();
    checkEnrollmentStatus();
  }

  Future<void> checkEnrollmentStatus() async {
    isLoading.value = true;
    try {
      isConsentGranted.value = await _repository.isConsentGranted();
      isEnrolled.value = await _repository.isFaceEnrolled(userId);
    } finally {
      isLoading.value = false;
    }
  }

  Future<void> setConsent(bool granted) async {
    await _repository.setConsentGranted(granted);
    isConsentGranted.value = granted;
  }

  Future<bool> deleteEnrolledBiometricData() async {
    isLoading.value = true;
    try {
      final success = await _repository.deleteEnrolledFace(userId);
      if (success) {
        isEnrolled.value = false;
        statusMessage.value = 'Enrolled face template deleted successfully.';
      } else {
        statusMessage.value = 'Failed to delete face data.';
      }
      return success;
    } finally {
      isLoading.value = false;
    }
  }
}
