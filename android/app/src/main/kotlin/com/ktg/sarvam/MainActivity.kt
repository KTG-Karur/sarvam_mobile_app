package com.ktg.sarvam

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

// local_auth's biometric prompt requires a FragmentActivity host.
class MainActivity : FlutterFragmentActivity() {
    private val channelName = "com.ktg.sarvam/tracking_permissions"
    private val notificationRequestCode = 8420
    private val cameraRequestCode = 8421
    private var pendingResult: MethodChannel.Result? = null
    private var pendingCameraResult: MethodChannel.Result? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "requestBatteryOptimizationExemption" -> {
                        requestBatteryOptimizationExemption()
                        result.success(true)
                    }
                    "requestNotificationPermission" -> requestNotificationPermission(result)
                    "requestCameraPermission" -> requestCameraPermission(result)
                    else -> result.notImplemented()
                }
            }
    }

    private fun requestCameraPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        ) {
            result.success(true)
        } else {
            pendingCameraResult = result
            requestPermissions(arrayOf(Manifest.permission.CAMERA), cameraRequestCode)
        }
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
                ) {
            result.success(true)
        } else {
            pendingResult = result
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                notificationRequestCode,
            )
        }
    }

    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val powerManager = getSystemService(PowerManager::class.java)
        if (powerManager.isIgnoringBatteryOptimizations(packageName)) return
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } catch (_: Exception) {
            // Device/OEM settings can reject this intent; the foreground
            // service still starts and users can allow it from Settings.
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == notificationRequestCode) {
            pendingResult?.success(
                grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED,
            )
            pendingResult = null
        } else if (requestCode == cameraRequestCode) {
            pendingCameraResult?.success(
                grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED,
            )
            pendingCameraResult = null
        }
    }
}
