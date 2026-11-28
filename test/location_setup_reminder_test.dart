import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:sarvam/services/app_permission_service.dart';

void main() {
  String? problem({
    bool serviceEnabled = true,
    LocationPermission permission = LocationPermission.always,
    bool precise = true,
  }) => AppPermissionService.locationProblem(
    serviceEnabled: serviceEnabled,
    permission: permission,
    precise: precise,
  );

  test('a complete setup needs no reminder', () {
    expect(problem(), isNull);
  });

  test('location switched off is reported first', () {
    expect(
      problem(serviceEnabled: false, permission: LocationPermission.denied),
      contains('turned off'),
    );
  });

  test('anything short of always asks for "Allow all the time"', () {
    for (final permission in [
      LocationPermission.whileInUse,
      LocationPermission.denied,
      LocationPermission.deniedForever,
    ]) {
      expect(problem(permission: permission), contains('Allow all the time'));
    }
  });

  test('approximate location asks for precise', () {
    expect(problem(precise: false), contains('precise'));
  });
}
