import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:image_picker/image_picker.dart';

enum DocumentScanType {
  aadhaar,
  panCard,
  voterId,
  ifscCode,
  bankAccount,
  smartCard,
}

class DocumentScannerService {
  static final ImagePicker _picker = ImagePicker();

  /// Launches Camera or Gallery, runs ML Kit Text Recognition on the selected card/document,
  /// and automatically extracts the matching identity / bank / document number.
  static Future<String?> scanDocument({
    required DocumentScanType scanType,
    required ImageSource source,
  }) async {
    TextRecognizer? textRecognizer;
    try {
      final XFile? pickedFile = await _picker.pickImage(
        source: source,
        maxWidth: 1920,
        maxHeight: 1920,
        imageQuality: 85,
      );

      if (pickedFile == null) return null;

      final inputImage = InputImage.fromFilePath(pickedFile.path);
      textRecognizer = TextRecognizer(script: TextRecognitionScript.latin);
      final RecognizedText recognizedText = await textRecognizer.processImage(inputImage);

      final String fullText = recognizedText.text;
      debugPrint('ML Kit OCR Recognized Text:\n$fullText');

      final extractedValue = _extractValueFromText(fullText, scanType);

      if (extractedValue != null && extractedValue.isNotEmpty) {
        return extractedValue;
      } else {
        Get.snackbar(
          'OCR Notice',
          'Could not automatically detect a clear number from the image. Please verify or enter manually.',
          backgroundColor: Colors.orange,
          colorText: Colors.white,
          duration: const Duration(seconds: 4),
        );
        return null;
      }
    } catch (e) {
      debugPrint('Error scanning document with ML Kit: $e');
      Get.snackbar(
        'Scan Error',
        'Failed to scan document image: $e',
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
      return null;
    } finally {
      await textRecognizer?.close();
    }
  }

  static String? _extractValueFromText(String text, DocumentScanType scanType) {
    final cleanText = text.replaceAll('\r', '\n');

    switch (scanType) {
      case DocumentScanType.aadhaar:
        // 12-digit Aadhaar number format: XXXX XXXX XXXX or XXXXXXXXXXXX (starts with 2-9)
        final aadhaarRegex = RegExp(r'\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b');
        final match = aadhaarRegex.firstMatch(cleanText);
        if (match != null) {
          return match.group(0)!.replaceAll(' ', '');
        }
        // Fallback: search for any sequence of 12 digits
        final digits12 = RegExp(r'\b\d{12}\b');
        final match12 = digits12.firstMatch(cleanText.replaceAll(' ', ''));
        return match12?.group(0);

      case DocumentScanType.panCard:
        // PAN format: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)
        final panRegex = RegExp(r'\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b');
        final match = panRegex.firstMatch(cleanText.toUpperCase());
        return match?.group(0);

      case DocumentScanType.voterId:
        // Voter ID format: 3 letters, 7 digits (e.g. ABC1234567)
        final voterRegex = RegExp(r'\b[A-Z]{3}[0-9]{7}\b');
        final match = voterRegex.firstMatch(cleanText.toUpperCase());
        if (match != null) return match.group(0);
        // Fallback: 10 character alphanumeric starting with letters
        final voterFallback = RegExp(r'\b[A-Z]{2,4}[0-9]{6,8}\b');
        final matchFb = voterFallback.firstMatch(cleanText.toUpperCase());
        return matchFb?.group(0);

      case DocumentScanType.ifscCode:
        // IFSC format: 4 letters, '0', 6 alphanumeric characters (e.g. SBIN0001234)
        final ifscRegex = RegExp(r'\b[A-Z]{4}0[A-Z0-9]{6}\b');
        final match = ifscRegex.firstMatch(cleanText.toUpperCase());
        return match?.group(0);

      case DocumentScanType.bankAccount:
        // Bank Account Number format: 9 to 18 digits
        final bankRegex = RegExp(r'\b\d{9,18}\b');
        final matches = bankRegex.allMatches(cleanText);
        for (final m in matches) {
          final val = m.group(0)!;
          // Filter out obvious 12-digit Aadhaar numbers if present
          if (val.length == 12 && val.startsWith(RegExp(r'[2-9]'))) continue;
          return val;
        }
        return null;

      case DocumentScanType.smartCard:
        // Smart card / Ration card: 10-20 digits or alphanumeric code
        final smartRegex = RegExp(r'\b\d{10,20}\b');
        final match = smartRegex.firstMatch(cleanText);
        return match?.group(0);
    }
  }
}
