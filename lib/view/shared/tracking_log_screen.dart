// TEMPORARILY DISABLED: Tracking Log screen. Uncomment to bring it back.
//
// import 'package:flutter/material.dart';
// import 'package:flutter/services.dart';
// import 'package:sarvam/services/tracking_log.dart';
//
// /// Shows [TrackingLog], newest line first, so an employee can copy it and send
// /// it to support after a route comes out incomplete.
// class TrackingLogScreen extends StatefulWidget {
//   const TrackingLogScreen({super.key});
//
//   @override
//   State<TrackingLogScreen> createState() => _TrackingLogScreenState();
// }
//
// class _TrackingLogScreenState extends State<TrackingLogScreen> {
//   List<String>? _lines;
//
//   @override
//   void initState() {
//     super.initState();
//     _load();
//   }
//
//   Future<void> _load() async {
//     final text = await TrackingLog.read();
//     if (!mounted) return;
//     setState(() {
//       _lines = text
//           .split('\n')
//           .where((line) => line.isNotEmpty)
//           .toList()
//           .reversed
//           .toList();
//     });
//   }
//
//   Future<void> _copy() async {
//     final oldestFirst = (_lines ?? []).reversed.join('\n');
//     await Clipboard.setData(ClipboardData(text: oldestFirst));
//     if (!mounted) return;
//     ScaffoldMessenger.of(context).showSnackBar(
//       const SnackBar(content: Text('Tracking log copied')),
//     );
//   }
//
//   @override
//   Widget build(BuildContext context) {
//     final lines = _lines;
//     return Scaffold(
//       appBar: AppBar(
//         title: const Text('Tracking Log'),
//         actions: [
//           IconButton(
//             onPressed: _load,
//             icon: const Icon(Icons.refresh_rounded),
//             tooltip: 'Refresh',
//           ),
//           IconButton(
//             onPressed: _copy,
//             icon: const Icon(Icons.copy_rounded),
//             tooltip: 'Copy',
//           ),
//         ],
//       ),
//       body: lines == null
//           ? const Center(child: CircularProgressIndicator())
//           : lines.isEmpty
//           ? const Center(child: Text('Nothing recorded yet.'))
//           : ListView.builder(
//               padding: const EdgeInsets.all(12),
//               itemCount: lines.length,
//               itemBuilder: (_, i) => Padding(
//                 padding: const EdgeInsets.only(bottom: 4),
//                 child: Text(
//                   lines[i],
//                   style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
//                 ),
//               ),
//             ),
//     );
//   }
// }
