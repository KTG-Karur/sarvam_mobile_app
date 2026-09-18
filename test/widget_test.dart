import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:sarvam/main.dart';

void main() {
  testWidgets('shows splash then dashboard', (WidgetTester tester) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(390, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(const MyApp());

    expect(find.text('Sarvam'), findsOneWidget);
    expect(find.text('Charitable Trust'), findsOneWidget);

    await tester.pump(const Duration(milliseconds: 1900));
    await tester.pumpAndSettle();

    expect(find.text('Dashboard'), findsOneWidget);
    expect(find.text('Welcome, Admin'), findsOneWidget);
  });
}
