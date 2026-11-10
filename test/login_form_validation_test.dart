import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// The Login screen's Form validates "on user interaction". Once the user
/// touches ANY field of such a form, Flutter validates ALL of them. So the
/// Company dropdown must not be a form field, or choosing a company would
/// immediately flag the empty Employee ID and Password as required.
Widget _form({required bool dropdownIsFormField}) {
  const items = [
    DropdownMenuItem(value: 'Sarvam', child: Text('Sarvam')),
    DropdownMenuItem(value: 'GCPL', child: Text('GCPL')),
  ];
  return MaterialApp(
    home: Scaffold(
      body: StatefulBuilder(
        builder: (context, setState) {
          String company = 'Sarvam';
          return Form(
            autovalidateMode: AutovalidateMode.onUserInteraction,
            child: Column(
              children: [
                if (dropdownIsFormField)
                  DropdownButtonFormField<String>(
                    key: const ValueKey('company'),
                    initialValue: company,
                    items: items,
                    onChanged: (v) {},
                  )
                else
                  InputDecorator(
                    decoration: const InputDecoration(),
                    child: DropdownButtonHideUnderline(
                      child: DropdownButton<String>(
                        key: const ValueKey('company'),
                        value: company,
                        items: items,
                        onChanged: (v) => setState(() => company = v!),
                      ),
                    ),
                  ),
                TextFormField(
                  validator: (v) =>
                      (v == null || v.isEmpty) ? 'Employee ID is required' : null,
                ),
                TextFormField(
                  validator: (v) =>
                      (v == null || v.isEmpty) ? 'Password is required' : null,
                ),
              ],
            ),
          );
        },
      ),
    ),
  );
}

Future<void> _pickGcpl(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('company')));
  await tester.pumpAndSettle();
  await tester.tap(find.text('GCPL').last);
  await tester.pumpAndSettle();
}

void main() {
  perFieldTests();

  testWidgets('a plain dropdown does not trigger the required errors', (
    tester,
  ) async {
    await tester.pumpWidget(_form(dropdownIsFormField: false));
    await _pickGcpl(tester);

    expect(find.text('Employee ID is required'), findsNothing);
    expect(find.text('Password is required'), findsNothing);
  });

  testWidgets('a form-field dropdown DOES trigger them (the bug)', (
    tester,
  ) async {
    await tester.pumpWidget(_form(dropdownIsFormField: true));
    await _pickGcpl(tester);

    expect(find.text('Employee ID is required'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
  });
}

/// The Login screen's final setup: the form itself does not auto-validate;
/// each text field checks only itself once the user has touched it.
Widget _perFieldForm(GlobalKey<FormState> key) => MaterialApp(
  home: Scaffold(
    body: Form(
      key: key,
      child: Column(
        children: [
          TextFormField(
            key: const ValueKey('id'),
            autovalidateMode: AutovalidateMode.onUserInteraction,
            validator: (v) =>
                (v == null || v.isEmpty) ? 'Employee ID is required' : null,
          ),
          TextFormField(
            key: const ValueKey('pw'),
            autovalidateMode: AutovalidateMode.onUserInteraction,
            validator: (v) =>
                (v == null || v.isEmpty) ? 'Password is required' : null,
          ),
        ],
      ),
    ),
  ),
);

void perFieldTests() {
  testWidgets('typing in Employee ID does not flag the empty Password', (
    tester,
  ) async {
    await tester.pumpWidget(_perFieldForm(GlobalKey<FormState>()));
    await tester.enterText(find.byKey(const ValueKey('id')), 'E1');
    await tester.pumpAndSettle();

    expect(find.text('Password is required'), findsNothing);
    expect(find.text('Employee ID is required'), findsNothing);
  });

  testWidgets('clearing a field you typed in flags just that field', (
    tester,
  ) async {
    await tester.pumpWidget(_perFieldForm(GlobalKey<FormState>()));
    await tester.enterText(find.byKey(const ValueKey('id')), 'E1');
    await tester.enterText(find.byKey(const ValueKey('id')), '');
    await tester.pumpAndSettle();

    expect(find.text('Employee ID is required'), findsOneWidget);
    expect(find.text('Password is required'), findsNothing);
  });

  testWidgets('tapping Login with both empty flags both', (tester) async {
    final key = GlobalKey<FormState>();
    await tester.pumpWidget(_perFieldForm(key));

    final valid = key.currentState!.validate();
    await tester.pumpAndSettle();

    expect(valid, isFalse);
    expect(find.text('Employee ID is required'), findsOneWidget);
    expect(find.text('Password is required'), findsOneWidget);
  });
}
