import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/constant/page_access.dart';
import 'package:sarvam/constant/roles.dart';

void main() {
  const page = PagePaths.memberIndividual;
  const builtIn = [AppRole.branchManager, AppRole.areaManager];

  bool can(
    AppRole role, {
    PageAction action = PageAction.view,
    Map<String, Map<String, bool>>? perms,
  }) => PageAccess.canFor(
    role: role,
    page: page,
    action: action,
    builtInRoles: builtIn,
    pagePermissions: perms,
  );

  test('admin always allowed', () {
    expect(can(AppRole.admin, action: PageAction.approve), isTrue);
  });

  test('built-in role allowed without any grant', () {
    expect(can(AppRole.branchManager, action: PageAction.edit), isTrue);
  });

  test('fdo denied when nothing is configured', () {
    expect(can(AppRole.fdo), isFalse);
  });

  test('fdo denied when the page is not granted', () {
    expect(can(AppRole.fdo, perms: {'/other': {'view': true}}), isFalse);
  });

  test('fdo allowed to view with a view grant, but not to edit', () {
    final perms = {page: {'view': true}};
    expect(can(AppRole.fdo, perms: perms), isTrue);
    expect(can(AppRole.fdo, action: PageAction.edit, perms: perms), isFalse);
  });

  test('action grant without view is ignored', () {
    final perms = {page: {'view': false, 'edit': true}};
    expect(can(AppRole.fdo, action: PageAction.edit, perms: perms), isFalse);
  });

  test('fdo with view + edit can edit', () {
    final perms = {page: {'view': true, 'edit': true}};
    expect(can(AppRole.fdo, action: PageAction.edit, perms: perms), isTrue);
  });

  group('canWriteFor', () {
    bool write(AppRole role, Map<String, Map<String, bool>>? perms) =>
        PageAccess.canWriteFor(
          role: role,
          page: page,
          builtInRoles: builtIn,
          pagePermissions: perms,
        );

    test('admin and built-in roles can write', () {
      expect(write(AppRole.admin, null), isTrue);
      expect(write(AppRole.branchManager, null), isTrue);
    });

    test('fdo with view only cannot write', () {
      expect(write(AppRole.fdo, {page: {'view': true}}), isFalse);
    });

    test('fdo with view + add or edit can write', () {
      expect(write(AppRole.fdo, {page: {'view': true, 'add': true}}), isTrue);
      expect(write(AppRole.fdo, {page: {'view': true, 'edit': true}}), isTrue);
    });

    test('write grant without view cannot write', () {
      expect(write(AppRole.fdo, {page: {'view': false, 'edit': true}}), isFalse);
    });
  });
}
