# App-specific keep rules. The MediaPipe/protobuf/Flogger rules come from the engine
# (engine/consumer-rules.pro).

# ONNX Runtime (Settings › Save depth map › AI estimate): its native library creates and reads
# ai.onnxruntime objects by class and field name.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**

# ARCore (Settings › Calibrate dual-pixel distances): its native code calls back into com.google.ar.core by name.
-keep class com.google.ar.core.** { *; }
-dontwarn com.google.ar.core.**
