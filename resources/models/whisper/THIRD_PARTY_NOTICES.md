# Third-Party Notices: Offline Dictation

Gilbert Codex offline dictation uses OpenAI Whisper model weights through the `whisper.cpp` GGML model format and the `whisper-rs` Rust bindings.

- OpenAI Whisper code and model weights: MIT License, https://github.com/openai/whisper
- whisper.cpp model conversion/runtime: MIT License, https://github.com/ggml-org/whisper.cpp
- whisper-rs bindings: https://docs.rs/crate/whisper-rs/latest

The default bundled model is `ggml-base.en.bin`, downloaded from the `ggerganov/whisper.cpp` Hugging Face model repository listed by the upstream `whisper.cpp` model documentation. The preparation script verifies the pinned SHA1 before the file is used for release packaging.
