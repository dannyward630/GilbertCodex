# Offline Whisper Dictation Model

Last updated: May 25, 2026 for the v0.8.2 build.

Gilbert Codex looks for `ggml-base.en.bin` in this folder when building or running offline dictation from source.

Run this from the repository root before making a release build:

```bash
npm run dictation:model
```

The Windows installer and Windows release scripts run this preparation step automatically and build Tauri with the GPU-backed offline dictation feature enabled. macOS and Linux release jobs also run the shared model preparation hook so the verified model resource is available to the bundle.

The model file is intentionally not committed because it is large. The release bundle includes whatever verified files are present in this folder through Tauri resources.
