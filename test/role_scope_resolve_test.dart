import 'package:flutter_test/flutter_test.dart';
import 'package:sarvam/constant/roles.dart';

void main() {
  // Role code + display name pairs as they exist in the web app's Role table.
  final cases = <List<Object>>[
    ['ADMIN', 'Administrator', AppRole.admin],
    ['CAO', 'Chief Administrative Officer', AppRole.headOffice],
    ['AREA_MANAGER', 'Area Manager', AppRole.areaManager],
    ['BRANCH_MANAGER', 'Branch Manager', AppRole.branchManager],
    ['ABM', 'Assistant Branch Manager', AppRole.branchManager],
    ['FDO', 'Field Development Officer', AppRole.fdo],
    ['SFDO', 'Senior Field Development Officer', AppRole.fdo],
    ['HR', 'Human Resources', AppRole.headOffice],
    ['HRM', 'Human Resources Manager', AppRole.headOffice],
    ['CM-HR', 'CM-HR', AppRole.headOffice],
    ['ZH', 'Zonal Head', AppRole.headOffice],
    ['QC', 'Quality Checkers', AppRole.fdo],
    ['CEO', 'CEO', AppRole.headOffice],
    ['COO', 'COO', AppRole.headOffice],
    ['DIVISION_MANAGER', 'Division Manager', AppRole.headOffice],
    ['', '', AppRole.unknown],
  ];

  for (final c in cases) {
    test('${c[0]} / ${c[1]} -> ${c[2]}', () {
      expect(RoleScope.resolve(c[0] as String, c[1] as String), c[2]);
    });
  }
}
