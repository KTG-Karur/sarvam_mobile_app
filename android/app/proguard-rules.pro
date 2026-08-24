# Flutter ProGuard Rules

# ML Kit and Play Services keep rules to prevent R8/AAPT missing resource errors
-dontwarn com.google.mlkit.**
-dontwarn com.google.android.gms.**
-dontwarn androidx.**
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.** { *; }
