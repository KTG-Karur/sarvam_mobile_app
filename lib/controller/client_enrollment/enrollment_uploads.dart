import 'dart:async';
import 'dart:io' as io;
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
import 'package:image/image.dart' as img;
import 'package:qr_flutter/qr_flutter.dart';
import 'package:sarvam/controller/client_enrollment/enrollment_options.dart';
import 'package:sarvam/services/enrollment_api_service.dart';

/// Local + remote state for one KYC/residence document tile.
class EnrollmentDocState {
  EnrollmentDocState({
    this.localPreviewPath,
    this.fileUrl,
    this.fileName,
    this.fileSize,
    this.mimeType,
    this.isUploading = false,
  });

  final String? localPreviewPath;
  final String? fileUrl;
  final String? fileName;
  final int? fileSize;
  final String? mimeType;
  final bool isUploading;

  bool get isUploaded => fileUrl != null && fileUrl!.isNotEmpty;

  EnrollmentDocState copyWith({
    String? localPreviewPath,
    String? fileUrl,
    String? fileName,
    int? fileSize,
    String? mimeType,
    bool? isUploading,
  }) => EnrollmentDocState(
    localPreviewPath: localPreviewPath ?? this.localPreviewPath,
    fileUrl: fileUrl ?? this.fileUrl,
    fileName: fileName ?? this.fileName,
    fileSize: fileSize ?? this.fileSize,
    mimeType: mimeType ?? this.mimeType,
    isUploading: isUploading ?? this.isUploading,
  );
}

/// Picks + immediately uploads every Tab-6 KYC/residence document, and
/// auto-generates + uploads the `location_qr` image once lat/lng settle —
/// matching the web app's "upload on pick, no separate submit step" flow.
mixin EnrollmentUploadsMixin on GetxController {
  EnrollmentApiService get api;
  RxString get latitude;
  RxString get longitude;
  RxString get mapsUrl;

  final RxMap<String, EnrollmentDocState> kycDocuments =
      <String, EnrollmentDocState>{}.obs;

  final _picker = ImagePicker();
  Timer? _qrDebounce;

  void _setDocState(String documentType, EnrollmentDocState state) {
    kycDocuments[documentType] = state;
  }

  EnrollmentDocState? docState(String documentType) =>
      kycDocuments[documentType];

  /// Picks (image, or image-or-PDF for [allowPdf] fields) and immediately
  /// uploads via `POST /api/kyc/aadhaar/upload`, storing the returned
  /// `fileUrl`/`fileName`/`fileSize`/`mimeType` in [kycDocuments].
  Future<void> pickAndUploadDocument(
    String documentType, {
    required String owner,
    bool allowPdf = false,
    ImageSource? source,
  }) async {
    try {
      List<int>? bytes;
      String? filename;
      String? contentType;

      if (source == ImageSource.camera) {
        final picked = await _picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1920,
          maxHeight: 1920,
          imageQuality: 80,
        );
        if (picked == null) return;
        final rawBytes = await picked.readAsBytes();
        bytes = await _rotateImageIfNecessary(rawBytes);
        if (bytes == null) return;
        filename = picked.name;
        contentType = 'image/jpeg';
      } else if (source == ImageSource.gallery) {
        final picked = await _picker.pickImage(
          source: ImageSource.gallery,
          maxWidth: 1920,
          maxHeight: 1920,
          imageQuality: 80,
        );
        if (picked == null) return;
        final rawBytes = await picked.readAsBytes();
        bytes = await _rotateImageIfNecessary(rawBytes);
        if (bytes == null) return;
        filename = picked.name;
        contentType = 'image/jpeg';
      } else if (allowPdf) {
        final result = await FilePicker.platform.pickFiles(
          type: FileType.custom,
          allowedExtensions: const ['jpg', 'jpeg', 'png', 'pdf'],
          withData: true,
        );
        final picked = result?.files.single;
        if (picked == null) return;
        if (picked.bytes != null) {
          bytes = picked.bytes;
        } else if (picked.path != null && picked.path!.isNotEmpty) {
          final file = io.File(picked.path!);
          if (await file.exists()) {
            bytes = await file.readAsBytes();
          }
        }
        if (bytes == null) return;
        filename = picked.name;
        final ext = (picked.extension ?? '').toLowerCase();
        contentType = ext == 'pdf' ? 'application/pdf' : 'image/${ext.isEmpty ? 'jpeg' : ext}';

        if (contentType.startsWith('image/')) {
          bytes = await _rotateImageIfNecessary(bytes!);
          if (bytes == null) return;
        }
      } else {
        final picked = await _picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1920,
          maxHeight: 1920,
          imageQuality: 80,
        );
        if (picked == null) return;
        final rawBytes = await picked.readAsBytes();
        bytes = await _rotateImageIfNecessary(rawBytes);
        if (bytes == null) return;
        filename = picked.name;
        contentType = 'image/jpeg';
      }

      _setDocState(
        documentType,
        (docState(documentType) ?? EnrollmentDocState()).copyWith(
          isUploading: true,
        ),
      );

      final result = await api.uploadKycDocument(
        bytes: bytes,
        filename: filename,
        contentType: contentType,
        documentType: documentType,
        owner: owner,
      );

      _setDocState(
        documentType,
        EnrollmentDocState(
          fileUrl: result['fileUrl']?.toString(),
          fileName: result['fileName']?.toString() ?? filename,
          fileSize: result['fileSize'] is int
              ? result['fileSize'] as int
              : int.tryParse('${result['fileSize']}'),
          mimeType: result['mimeType']?.toString() ?? contentType,
          isUploading: false,
        ),
      );
    } catch (e) {
      _setDocState(
        documentType,
        (docState(documentType) ?? EnrollmentDocState()).copyWith(
          isUploading: false,
        ),
      );
      Get.snackbar(
        'Upload Failed',
        'Failed to upload document: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }

  void removeDocument(String documentType) {
    kycDocuments.remove(documentType);
  }

  /// Debounced (~800ms) auto-generation + upload of a PNG QR code encoding
  /// the current `mapsUrl`, mirroring the web app's location_qr behavior.
  Future<void> generateAndUploadLocationQr() async {
    _qrDebounce?.cancel();
    _qrDebounce = Timer(const Duration(milliseconds: 800), () async {
      if (mapsUrl.value.isEmpty) return;
      try {
        final painter = QrPainter(
          data: mapsUrl.value,
          version: QrVersions.auto,
          gapless: true,
        );
        final imageData = await painter.toImageData(
          300,
          format: ui.ImageByteFormat.png,
        );
        if (imageData == null) return;
        final bytes = imageData.buffer.asUint8List();

        _setDocState(
          EnrollmentOptions.docLocationQr,
          (docState(EnrollmentOptions.docLocationQr) ?? EnrollmentDocState())
              .copyWith(isUploading: true),
        );

        final result = await api.uploadKycDocument(
          bytes: bytes,
          filename: 'location_qr.png',
          contentType: 'image/png',
          documentType: EnrollmentOptions.docLocationQr,
          owner: 'client',
        );

        _setDocState(
          EnrollmentOptions.docLocationQr,
          EnrollmentDocState(
            fileUrl: result['fileUrl']?.toString(),
            fileName: result['fileName']?.toString() ?? 'location_qr.png',
            fileSize: result['fileSize'] is int
                ? result['fileSize'] as int
                : int.tryParse('${result['fileSize']}'),
            mimeType: result['mimeType']?.toString() ?? 'image/png',
            isUploading: false,
          ),
        );
      } catch (e) {
        debugPrint('Location QR generation/upload failed: $e');
      }
    });
  }

  /// Opens a review dialog allowing the user to rotate the image (0, 90, 180,
  /// 270 deg) before finalized upload. Returns null if the user cancels.
  Future<List<int>?> _rotateImageIfNecessary(List<int> bytes) async {
    final rxRotation = 0.obs; // quarter turns
    final list = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);

    final result = await Get.dialog<List<int>?>(
      Dialog(
        backgroundColor: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16, horizontal: 20),
              child: Row(
                children: [
                  Icon(Icons.rotate_right_rounded, color: Color(0xFF00843D)),
                  SizedBox(width: 10),
                  Text(
                    'Review & Rotate',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF073E23)),
                  ),
                ],
              ),
            ),
            Container(
              height: 300,
              width: double.infinity,
              color: const Color(0xFFF8FBF9),
              child: Obx(() => RotatedBox(
                    quarterTurns: rxRotation.value,
                    child: Image.memory(list, fit: BoxFit.contain),
                  )),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  IconButton.filledTonal(
                    onPressed: () => rxRotation.value = (rxRotation.value + 1) % 4,
                    icon: const Icon(Icons.rotate_right_rounded, color: Color(0xFF00843D)),
                    style: IconButton.styleFrom(
                      backgroundColor: const Color(0xFFF0FAF4),
                      foregroundColor: const Color(0xFF00843D),
                    ),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: () => Get.back(result: null),
                    child: const Text('Cancel', style: TextStyle(color: Color(0xFF64748B))),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () async {
                      if (rxRotation.value == 0) {
                        Get.back(result: bytes);
                        return;
                      }
                      Get.dialog(
                        const Center(child: CircularProgressIndicator(color: Color(0xFF00843D))),
                        barrierDismissible: false,
                      );
                      try {
                        final image = img.decodeImage(list);
                        if (image == null) {
                          Get.back();
                          Get.back(result: bytes);
                          return;
                        }
                        // img.copyRotate uses degrees, we have quarter turns clockwise.
                        // Quarter turns 0=0, 1=90, 2=180, 3=270.
                        final rotated = img.copyRotate(image, angle: rxRotation.value * 90);
                        final resultBytes = img.encodeJpg(rotated, quality: 85);
                        Get.back(); // close loader
                        Get.back(result: resultBytes);
                      } catch (e) {
                        Get.back(); // close loader
                        Get.back(result: bytes);
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF00843D),
                      foregroundColor: Colors.white,
                      elevation: 0,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    child: const Text('Upload'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      barrierDismissible: false,
    );
    return result;
  }
}
