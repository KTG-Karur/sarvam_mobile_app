# Face attendance — backend contract (server confirm half)

The mobile app now does real on-device face recognition (MobileFaceNet, 128/192/512-d
L2-normalised embeddings) and a local cosine gate **before** it calls the server.
The server is still the authority on the attendance decision and must re-verify
the embedding against its own stored template. Base URL: `http://localhost:3320`.

## Common rules

* Auth: `Authorization: Bearer <accessToken>` on every call.
* Embeddings are JSON arrays of floats, already L2-normalised (‖v‖ ≈ 1).
* Reject any request whose `modelVersion` != the version the template was
  enrolled with, or whose `embeddingVersion` (vector length) does not match the
  stored template. Respond `409` with `{ "message": "Face model changed — please re-register your face." }`.
* Match metric: **cosine similarity** = dot product (vectors are unit length).
* Calibrate `SERVER_COSINE_THRESHOLD` on a labelled set. Start at **0.62**;
  the app uses the same default (`FaceBiometricService.deviceCosineThreshold`).
* Store multiple enrolled samples per user (5 poses) — match = `max` cosine
  over all samples.

## POST `/api/auth/face/register`

Body (from `FaceBiometricService.encryptTemplatePayload`):

```jsonc
{
  "encryptedTemplate": "<base64(json)>",   // signed copy, for audit
  "hmacSignature": "<hex>",                // HMAC-SHA256, key = Sarvam_MFI_Biometric_SecKey_2026
  "algorithm": "HMAC-SHA256",
  "vectorSize": 192,
  "featureVector": [ ... ],                // averaged master template (L2-normalised)
  "embeddings": [ [ ... ], [ ... ], ... ], // the 5 per-pose samples
  "modelName": "MobileFaceNet",
  "modelVersion": "mobilefacenet-tflite-v1",
  "embeddingVersion": "192d",
  "livenessVerified": true,
  "qualityScore": 99.0,
  "capturedAt": "2026-09-02T12:16:00.000Z",
  "photoBase64": "<jpeg>"                  // optional, for the verify dialog avatar
}
```

Server:
1. Verify `hmacSignature` over `base64decode(encryptedTemplate)`.
2. Persist per user: `embeddings[]`, `featureVector`, `modelName`,
   `modelVersion`, `embeddingVersion`, `photoBase64`, `capturedAt`.
3. Replace any previous template for that user (re-enrol overwrites).

Response `200`: `{ "message": "...", "templateId": "..." }`.

## POST `/api/auth/face/verify`

Body (from `FaceBiometricService.verifyFace`):

```jsonc
{
  "type": "PUNCH_IN" | "PUNCH_OUT",
  "featureVector": [ ... ],   // live probe embedding, L2-normalised
  "modelName": "MobileFaceNet",
  "modelVersion": "mobilefacenet-tflite-v1",
  "embeddingVersion": "192d",
  "deviceCosine": 0.83,       // score the device gate already computed
  "latitude": 11.0, "longitude": 77.0,
  "deviceId": "..."
}
```

Server:
1. Load the user's enrolled template. If none → `409`
   `{ "message": "Face not enrolled. Please register your face." }`.
2. Reject `modelVersion` / `embeddingVersion` mismatch (see Common rules).
3. `score = max(cosine(probe, s) for s in enrolled.embeddings)`.
4. `matched = score >= SERVER_COSINE_THRESHOLD`.
5. If `matched`, record attendance for `type` (idempotent per day; ignore a
   duplicate PUNCH_IN, require a prior PUNCH_IN for PUNCH_OUT).
6. Always log `deviceCosine`, server `score`, `matched`, lat/long, deviceId.

Response `200`:

```jsonc
{
  "message": "Face verified successfully.",
  "data": {
    "matched": true,
    "scorePercent": 83.1,          // score * 100
    "type": "PUNCH_IN",
    "recordedAt": "2026-09-02T12:16:04.000Z"
  }
}
```

On no-match respond `200` with `data.matched=false` and `scorePercent` set, or
`409`/`400` with `message`. The app treats any non-matched / error response as a
failed punch (fail closed).

## GET `/api/auth/face/attendance-status`

Response `data`: `{ enrolled, present, punchedIn, punchedOut, status,
isWorkingDay, faceAttendanceAllowed, faceTrainingAllowed, accessMessage }`
— already consumed by `FaceBiometricService.fetchServerAttendanceInfo`.
`enrolled=false` here makes the app drop its local template and force re-enrol.
