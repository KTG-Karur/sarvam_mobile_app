# Face recognition model

Place the on-device face-recognition model here as:

    assets/models/mobilefacenet.tflite

Requirements (auto-detected at load time):

| Property | Value |
|----------|-------|
| Format   | TensorFlow Lite (`.tflite`) |
| Input    | `1 x S x S x 3` float32, RGB, `(pixel - 127.5) / 128` (S is normally 112) |
| Output   | `1 x N` face embedding (N = 128 / 192 / 512) |

Recommended: **MobileFaceNet** (≈5 MB, 192-d) — e.g. the `MobileFaceNet.tflite`
from `sirius-ai/MobileFaceNet_TF`, or any of the widely mirrored
`mobilefacenet.tflite` files used by Flutter face-auth samples.

Until this file exists, `FaceRecognitionEngine.isReady` is `false` and the app
**refuses** face verification / enrolment instead of accepting anyone
(fail-closed). See `lib/services/face_recognition_engine.dart`.

If you change the model or its preprocessing, bump
`FaceRecognitionEngine.modelVersion` so previously enrolled templates
(client and server) are rejected and users re-enrol.

This file only exists so the `assets/models/` entry in `pubspec.yaml`
resolves during builds; it is safe to keep alongside the model.
