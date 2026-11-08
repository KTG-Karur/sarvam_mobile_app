import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Centralized service to manage offline collection storage & syncing.
///
/// Every collection endpoint on the server (demand, single, bulk, arrear)
/// takes a multipart form with a mandatory meeting `photo` (and optional
/// `latitude` / `longitude`), so a collection saved offline must keep those
/// too. The data goes in SharedPreferences; the photo is written to a file in
/// the app's documents folder (a photo is far too large for preferences) and
/// referenced by `photoPath`. Syncing rebuilds the same form the online submit
/// sends.
class OfflineCollectionService extends GetxService {
  static const String _prefKey = 'offline_collections_queue';
  static const String _photoDirName = 'offline_collections';
  final ApiClient _connect = ApiClient();

  final RxInt pendingCount = 0.obs;
  final RxBool isSyncing = false.obs;

  /// Goes up by one every time a collection is saved offline. A screen that
  /// submits a collection can compare it before and after to know whether the
  /// submission went to the server or was only queued on the phone.
  int offlineSaveCounter = 0;

  /// Whether to show the on-screen messages. Tests switch it off, since there
  /// is no app overlay to show them on.
  @visibleForTesting
  bool showMessages = true;

  @override
  void onInit() {
    super.onInit();
    refreshPendingCount();
  }

  /// Updates the reactive count of pending offline collections.
  Future<int> refreshPendingCount() async {
    try {
      final list = await getPendingCollections();
      pendingCount.value = list.length;
      return list.length;
    } catch (e) {
      debugPrint("Error loading offline collection count: $e");
      pendingCount.value = 0;
      return 0;
    }
  }

  /// Retrieves all pending offline collection entries from local storage.
  Future<List<Map<String, dynamic>>> getPendingCollections() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final jsonString = prefs.getString(_prefKey);
      if (jsonString == null || jsonString.isEmpty) {
        return [];
      }
      final List<dynamic> rawList = jsonDecode(jsonString);
      return rawList.map((e) => Map<String, dynamic>.from(e)).toList();
    } catch (e) {
      debugPrint("Error parsing offline collections: $e");
      return [];
    }
  }

  /// Saves a collection offline when the network is unavailable.
  /// [type] can be 'SINGLE', 'BULK', 'DEMAND', or 'ARREAR'.
  ///
  /// [photoBytes] is the meeting photo the server requires, and [latitude] /
  /// [longitude] the collection's location — both must be kept so the
  /// collection can be sent later exactly as an online one would be.
  Future<bool> saveOfflineCollection({
    required String type,
    required Map<String, dynamic> payload,
    String? title,
    Uint8List? photoBytes,
    double? latitude,
    double? longitude,
  }) async {
    try {
      final pendingList = await getPendingCollections();
      final id = DateTime.now().millisecondsSinceEpoch.toString();

      String? photoPath;
      if (photoBytes != null && photoBytes.isNotEmpty) {
        photoPath = await _writePhoto(id, photoBytes);
      }

      final newItem = {
        'id': id,
        'type': type,
        'title': title ?? '$type Collection',
        'payload': payload,
        'createdAt': DateTime.now().toIso8601String(),
        'status': 'PENDING',
        if (photoPath != null) 'photoPath': photoPath,
        if (latitude != null) 'latitude': latitude,
        if (longitude != null) 'longitude': longitude,
      };

      pendingList.add(newItem);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, jsonEncode(pendingList));
      offlineSaveCounter++;
      await refreshPendingCount();

      // The collection is already saved. Showing the message is only a
      // courtesy, so a failure to show it must never turn into a "save failed".
      try {
        if (showMessages)
          Get.snackbar(
            'Saved Offline 📲',
            'Saved on this phone — will sync when online',
            snackPosition: SnackPosition.BOTTOM,
            backgroundColor: const Color(0xFFFF9800), // Warning Orange
            colorText: Colors.white,
            duration: const Duration(seconds: 4),
            margin: const EdgeInsets.all(12),
            borderRadius: 10,
            icon: const Icon(Icons.wifi_off, color: Colors.white),
          );
      } catch (e) {
        debugPrint('Could not show the offline-saved message: $e');
      }

      return true;
    } catch (e) {
      debugPrint("Failed to save offline collection: $e");
      if (showMessages)
        Get.snackbar(
          'Offline Save Failed',
          'Could not save collection data locally: $e',
          snackPosition: SnackPosition.BOTTOM,
          backgroundColor: Colors.redAccent,
          colorText: Colors.white,
        );
      return false;
    }
  }

  Future<String> _writePhoto(String id, Uint8List bytes) async {
    final base = await getApplicationDocumentsDirectory();
    final dir = Directory('${base.path}/$_photoDirName');
    if (!await dir.exists()) await dir.create(recursive: true);
    final file = File('${dir.path}/$id.jpg');
    await file.writeAsBytes(bytes, flush: true);
    return file.path;
  }

  Future<void> _deletePhoto(dynamic path) async {
    if (path is! String || path.isEmpty) return;
    try {
      final file = File(path);
      if (await file.exists()) await file.delete();
    } catch (_) {}
  }

  /// The form the server expects for [type] — the same fields, in the same
  /// shape, as the online submit of that collection type.
  FormData? _buildForm(
    String type,
    Map<String, dynamic> payload,
    Uint8List photo,
    double? latitude,
    double? longitude,
  ) {
    final collectionDate = '${payload['collectionDate'] ?? ''}';
    String json(dynamic v) => jsonEncode(v ?? <String, dynamic>{});

    final Map<String, dynamic> fields;
    switch (type) {
      case 'DEMAND':
        fields = {
          'centerId': payload['centerId'],
          'collectionDate': collectionDate,
          'collections': json(payload['collections'] ?? []),
          'attendance': json(payload['attendance'] ?? []),
          'denomination': json(payload['denomination']),
        };
      case 'BULK':
        fields = {
          'centerId': payload['centerId'],
          'collectionDate': collectionDate,
          'collectionType': payload['collectionType'],
          'collections': json(payload['collections'] ?? []),
          'denomination': json(payload['denomination']),
        };
      case 'ARREAR':
        fields = {
          'centerId': payload['centerId'],
          'collectionDate': collectionDate,
          'collections': json(payload['collections'] ?? []),
          'attendance': json(payload['attendance']),
          'denomination': json(payload['denomination']),
        };
      case 'SINGLE':
        fields = {
          'clientId': payload['clientId'],
          'loanId': payload['loanId'],
          'collectionType': payload['collectionType'],
          'amount': '${payload['amount']}',
          'loanAdvance': '${payload['loanAdvance']}',
          'paymentMode': 'CASH',
          'collectionDate': collectionDate,
          'remarks': 'Single collection - ${payload['collectionType']}',
          'denomination': json(payload['denomination']),
        };
      default:
        return null;
    }

    return FormData({
      for (final e in fields.entries) e.key: '${e.value}',
      'photo': MultipartFile(
        photo,
        filename: 'meeting_$collectionDate.jpg',
        contentType: 'image/jpeg',
      ),
      if (latitude != null) 'latitude': latitude.toString(),
      if (longitude != null) 'longitude': longitude.toString(),
    });
  }

  String? _errorMessage(dynamic body) {
    if (body is! Map) return null;
    final m = (body['error'] ?? body['message'])?.toString();
    return m == null || m.isEmpty ? null : m;
  }

  /// Sends one queued collection. Returns null on success, otherwise the
  /// reason it could not be sent.
  Future<String?> _syncOne(
    Map<String, dynamic> item,
    String accessToken,
  ) async {
    final type = '${item['type'] ?? 'SINGLE'}';
    final payload = Map<String, dynamic>.from(item['payload'] ?? {});

    // The server rejects a collection without its meeting photo. Items queued
    // before the photo was being kept have none, and can't be sent.
    final photoPath = item['photoPath'];
    if (photoPath is! String || photoPath.isEmpty) {
      return 'Saved without its meeting photo — it cannot be sent. '
          'Please enter this collection again.';
    }
    final photoFile = File(photoPath);
    if (!await photoFile.exists()) {
      return 'The saved meeting photo is missing — it cannot be sent.';
    }

    final form = _buildForm(
      type,
      payload,
      await photoFile.readAsBytes(),
      (item['latitude'] as num?)?.toDouble(),
      (item['longitude'] as num?)?.toDouble(),
    );
    if (form == null) return 'Unknown collection type "$type".';

    final String url;
    switch (type) {
      case 'DEMAND':
        url = Api.demandCollectionUrl;
      case 'BULK':
        url = Api.bulkCollectionUrl;
      case 'ARREAR':
        url = Api.arrearCollectionUrl;
      default:
        url = Api.singleCollectionUrl;
    }

    _connect.timeout = const Duration(seconds: 60);
    final response = await _connect.post(
      url,
      form,
      headers: accessToken.isNotEmpty
          ? {'Authorization': 'Bearer $accessToken'}
          : null,
    );

    if (response.statusCode == 200 || response.statusCode == 201) {
      final body = response.body;
      if (body != null && body['success'] == true) return null;
    }
    if (response.statusCode == null) {
      return 'No connection to the server.';
    }
    return _errorMessage(response.body) ??
        'The server did not accept it (${response.statusCode}).';
  }

  /// Syncs all pending offline collections with the backend server.
  Future<Map<String, dynamic>> syncAllPendingCollections() async {
    if (isSyncing.value) {
      return {'success': false, 'message': 'Sync already in progress'};
    }

    try {
      isSyncing.value = true;
      final pendingList = await getPendingCollections();

      if (pendingList.isEmpty) {
        await refreshPendingCount();
        return {
          'success': true,
          'synced': 0,
          'message': 'No offline collections to sync.',
        };
      }

      int syncedCount = 0;
      int failedCount = 0;
      final List<Map<String, dynamic>> remainingList = [];

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      String? firstError;
      for (final item in pendingList) {
        String? error;
        try {
          error = await _syncOne(item, accessToken);
        } catch (err) {
          debugPrint("Error syncing item ${item['id']}: $err");
          error = 'Could not send it: $err';
        }

        if (error == null) {
          syncedCount++;
          await _deletePhoto(item['photoPath']);
        } else {
          failedCount++;
          firstError ??= error;
          // Keep it in the queue for the next retry, with the reason.
          remainingList.add({...item, 'lastError': error});
        }
      }

      // Save remaining unsynced items back to SharedPreferences
      await prefs.setString(_prefKey, jsonEncode(remainingList));
      await refreshPendingCount();

      final String message = syncedCount > 0
          ? (failedCount > 0
                ? 'Synced $syncedCount offline collection(s); $failedCount '
                          'could not be sent. ${firstError ?? ''}'
                      .trim()
                : 'Successfully synced $syncedCount offline collections!')
          : (firstError ??
                'Failed to sync offline collections. Please check network '
                    'connection.');

      Get.snackbar(
        syncedCount > 0 ? 'Sync Complete 🔄' : 'Sync Failed ⚠️',
        message,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: syncedCount > 0
            ? const Color(0xFF008A3D)
            : Colors.redAccent,
        colorText: Colors.white,
      );

      return {
        'success': syncedCount > 0,
        'synced': syncedCount,
        'failed': failedCount,
        'message': message,
      };
    } catch (e) {
      debugPrint("Error during offline sync: $e");
      return {'success': false, 'message': 'Sync error: $e'};
    } finally {
      isSyncing.value = false;
    }
  }

  /// Clears all offline stored collection items.
  Future<void> clearPendingCollections() async {
    for (final item in await getPendingCollections()) {
      await _deletePhoto(item['photoPath']);
    }
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefKey);
    await refreshPendingCount();
  }
}
