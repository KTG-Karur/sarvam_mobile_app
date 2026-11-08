import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:get/get.dart';
import 'package:path_provider_platform_interface/path_provider_platform_interface.dart';
import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:sarvam/services/offline_collection_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakePathProvider extends Fake
    with MockPlatformInterfaceMixin
    implements PathProviderPlatform {
  _FakePathProvider(this.dir);
  final String dir;

  @override
  Future<String?> getApplicationDocumentsPath() async => dir;
}

void main() {
  late Directory tmp;
  late OfflineCollectionService service;

  setUp(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    Get.testMode = true;
    SharedPreferences.setMockInitialValues({});
    tmp = await Directory.systemTemp.createTemp('offline_collection_test');
    PathProviderPlatform.instance = _FakePathProvider(tmp.path);
    service = OfflineCollectionService()..showMessages = false;
  });

  tearDown(() async {
    if (await tmp.exists()) await tmp.delete(recursive: true);
  });

  test('an offline save keeps the meeting photo and the location', () async {
    final photo = Uint8List.fromList([1, 2, 3, 4, 5]);
    final before = service.offlineSaveCounter;

    final saved = await service.saveOfflineCollection(
      type: 'DEMAND',
      payload: {'centerId': 'c1', 'collectionDate': '2026-11-10'},
      title: 'Demand Collection (c1)',
      photoBytes: photo,
      latitude: 12.5,
      longitude: 78.25,
    );
    expect(saved, isTrue);
    expect(service.offlineSaveCounter, before + 1);

    final queue = await service.getPendingCollections();
    expect(queue, hasLength(1));
    final item = queue.single;
    expect(item['type'], 'DEMAND');
    expect(item['latitude'], 12.5);
    expect(item['longitude'], 78.25);

    // The photo is a real file on disk with the bytes we gave it.
    final path = item['photoPath'] as String;
    expect(await File(path).readAsBytes(), photo);
  });

  test('clearing the queue also deletes the saved photos', () async {
    await service.saveOfflineCollection(
      type: 'BULK',
      payload: {'centerId': 'c1', 'collectionDate': '2026-11-10'},
      photoBytes: Uint8List.fromList([9, 9, 9]),
    );
    final path =
        (await service.getPendingCollections()).single['photoPath'] as String;
    expect(await File(path).exists(), isTrue);

    await service.clearPendingCollections();

    expect(await service.getPendingCollections(), isEmpty);
    expect(await File(path).exists(), isFalse);
  });
}
