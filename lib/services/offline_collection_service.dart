import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sarvam/constant/api.dart';
import 'package:sarvam/services/api_client.dart';

/// Centralized service to manage offline collection storage & syncing.
class OfflineCollectionService extends GetxService {
  static const String _prefKey = 'offline_collections_queue';
  final ApiClient _connect = ApiClient();

  final RxInt pendingCount = 0.obs;
  final RxBool isSyncing = false.obs;

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

  /// Saves a collection payload offline when network is unavailable.
  /// [type] can be 'SINGLE', 'BULK', 'DEMAND', or 'ARREAR'.
  Future<bool> saveOfflineCollection({
    required String type,
    required Map<String, dynamic> payload,
    String? title,
  }) async {
    try {
      final pendingList = await getPendingCollections();

      final newItem = {
        'id': DateTime.now().millisecondsSinceEpoch.toString(),
        'type': type,
        'title': title ?? '$type Collection',
        'payload': payload,
        'createdAt': DateTime.now().toIso8601String(),
        'status': 'PENDING',
      };

      pendingList.add(newItem);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefKey, jsonEncode(pendingList));
      await refreshPendingCount();

      Get.snackbar(
        'Saved Offline 📲',
        'No internet detected. Collection saved locally and queued for auto-sync.',
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor: const Color(0xFFFF9800), // Warning Orange
        colorText: Colors.white,
        duration: const Duration(seconds: 4),
        margin: const EdgeInsets.all(12),
        borderRadius: 10,
        icon: const Icon(Icons.wifi_off, color: Colors.white),
      );

      return true;
    } catch (e) {
      debugPrint("Failed to save offline collection: $e");
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
        return {'success': true, 'synced': 0, 'message': 'No offline collections to sync.'};
      }

      int syncedCount = 0;
      int failedCount = 0;
      final List<Map<String, dynamic>> remainingList = [];

      final prefs = await SharedPreferences.getInstance();
      final accessToken = prefs.getString('accessToken') ?? '';

      for (final item in pendingList) {
        final String type = item['type'] ?? 'SINGLE';
        final Map<String, dynamic> payload =
            Map<String, dynamic>.from(item['payload'] ?? {});

        bool success = false;

        try {
          if (type == 'SINGLE') {
            final response = await _connect.post(
              Api.singleCollectionUrl,
              payload,
              headers: accessToken.isNotEmpty
                  ? {'Authorization': 'Bearer $accessToken'}
                  : null,
            );
            if (response.statusCode == 200 || response.statusCode == 201) {
              final body = response.body;
              if (body != null && body['success'] == true) {
                success = true;
              }
            }
          } else if (type == 'BULK') {
            final response = await _connect.post(
              Api.bulkCollectionUrl,
              payload,
              headers: {
                'Authorization': 'Bearer $accessToken',
                'Content-Type': 'application/json',
              },
            );
            if (response.statusCode == 200 || response.statusCode == 201) {
              final body = response.body;
              if (body != null && body['success'] == true) {
                success = true;
              }
            }
          } else if (type == 'DEMAND') {
            final response = await _connect.post(
              Api.demandCollectionUrl,
              payload,
              headers: {'Authorization': 'Bearer $accessToken'},
            );
            if (response.statusCode == 200 || response.statusCode == 201) {
              final body = response.body;
              if (body != null && body['success'] == true) {
                success = true;
              }
            }
          } else if (type == 'ARREAR') {
            final response = await _connect.post(
              Api.arrearCollectionUrl,
              payload,
              headers: {
                'Authorization': 'Bearer $accessToken',
                'Content-Type': 'application/json',
              },
            );
            if (response.statusCode == 200 || response.statusCode == 201) {
              final body = response.body;
              if (body != null && body['success'] == true) {
                success = true;
              }
            }
          }
        } catch (err) {
          debugPrint("Error syncing item ${item['id']}: $err");
          success = false;
        }

        if (success) {
          syncedCount++;
        } else {
          failedCount++;
          remainingList.add(item); // Keep in queue for next retry
        }
      }

      // Save remaining unsynced items back to SharedPreferences
      await prefs.setString(_prefKey, jsonEncode(remainingList));
      await refreshPendingCount();

      final String message = syncedCount > 0
          ? 'Successfully synced $syncedCount offline collections!'
          : 'Failed to sync offline collections. Please check network connection.';

      Get.snackbar(
        syncedCount > 0 ? 'Sync Complete 🔄' : 'Sync Failed ⚠️',
        message,
        snackPosition: SnackPosition.BOTTOM,
        backgroundColor:
            syncedCount > 0 ? const Color(0xFF008A3D) : Colors.redAccent,
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
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_prefKey);
    await refreshPendingCount();
  }
}
