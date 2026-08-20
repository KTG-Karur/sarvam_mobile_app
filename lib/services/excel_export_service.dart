import 'dart:io';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

class ExcelExportService {
  static Future<void> exportToCsv({
    required String title,
    required List<String> headers,
    required List<List<dynamic>> rows,
  }) async {
    try {
      final String sanitizeTitle = title.replaceAll(RegExp(r'[^\w\s]'), '').replaceAll(' ', '_');
      final StringBuffer csvContent = StringBuffer();

      // Write Header
      csvContent.writeln(headers.join(','));

      // Write Rows
      for (final row in rows) {
        final String line = row.map((cell) => '"${cell.toString().replaceAll('"', '""')}"').join(',');
        csvContent.writeln(line);
      }

      Directory? targetDir;
      if (Platform.isAndroid) {
        final publicDownload = Directory('/storage/emulated/0/Download');
        if (await publicDownload.exists()) {
          targetDir = publicDownload;
        } else {
          targetDir = await getExternalStorageDirectory();
        }
      }
      targetDir ??= await getApplicationDocumentsDirectory();

      final String filePath = '${targetDir.path}/$sanitizeTitle.csv';
      final File file = File(filePath);

      await file.writeAsString(csvContent.toString());

      Get.snackbar(
        'Excel Export Successful',
        'Saved $sanitizeTitle.csv to Download folder:\n$filePath',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFF0D6842),
        colorText: Colors.white,
        duration: const Duration(seconds: 6),
        margin: const EdgeInsets.all(12),
        icon: const Icon(Icons.check_circle_outline_rounded, color: Colors.white, size: 28),
        mainButton: TextButton(
          onPressed: () async {
            try {
              final result = await OpenFilex.open(filePath);
              if (result.type != ResultType.done) {
                Get.snackbar(
                  'Saved in Downloads',
                  'Open "$sanitizeTitle.csv" from your device Download folder.',
                  snackPosition: SnackPosition.BOTTOM,
                  backgroundColor: const Color(0xFF1E3A8A),
                  colorText: Colors.white,
                );
              }
            } catch (e) {
              Get.snackbar(
                'File Saved to Downloads',
                'File path: $filePath\nRe-run app to activate file viewer channel.',
                snackPosition: SnackPosition.BOTTOM,
                backgroundColor: const Color(0xFF0D6842),
                colorText: Colors.white,
              );
            }
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text(
              'OPEN',
              style: TextStyle(
                color: Color(0xFF0D6842),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
      );
    } catch (e) {
      Get.snackbar(
        'Export Failed',
        'Unable to generate Excel CSV export: $e',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: Colors.redAccent,
        colorText: Colors.white,
      );
    }
  }
}
