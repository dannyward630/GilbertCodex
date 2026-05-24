# Offline Whisper Dictation Model

Gilbert Codex looks for `ggml-base.en.bin` in this folder when building or running offline dictation from source.

Run this from the repository root before making a release build:

```bash
npm run dictation:model
```

The Windows installer and release scripts run this preparation step automatically and build Tauri with the `offline-dictation` Cargo feature enabled.

The model file is intentionally not committed because it is large. The release bundle includes whatever verified files are present in this folder through Tauri resources.
