# App-specific keep rules. The MediaPipe/protobuf/Flogger rules come from the engine
# (engine/consumer-rules.pro).

# ONNX Runtime (Settings › Save depth map › AI estimate): its native library creates and reads
# ai.onnxruntime objects by class and field name.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**
