import 'dart:async';
import 'dart:io' as io;
import 'dart:ui' as ui;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:image_picker/image_picker.dart';
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
        bytes = await picked.readAsBytes();
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
        bytes = await picked.readAsBytes();
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
      } else {
        final picked = await _picker.pickImage(
          source: ImageSource.camera,
          maxWidth: 1920,
          maxHeight: 1920,
          imageQuality: 80,
        );
        if (picked == null) return;
        bytes = await picked.readAsBytes();
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
}
