#[cfg(all(
    not(debug_assertions),
    target_os = "windows",
    not(feature = "offline-dictation")
))]
compile_error!(
    "Windows release builds must enable offline dictation. Build with --features offline-dictation-gpu, offline-dictation-cuda, or offline-dictation."
);

#[cfg(not(feature = "offline-dictation"))]
mod stub {
    use serde::{Deserialize, Serialize};

    #[derive(Default)]
    pub struct DictationState;

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStatusResponse {
        pub can_fallback: bool,
        pub accelerator: String,
        pub gpu_available: bool,
        pub gpu_device_id: Option<i32>,
        pub gpu_device_name: Option<String>,
        pub engine: String,
        pub message: String,
        pub model: String,
        pub model_available: bool,
        pub model_loaded: bool,
        pub model_path: Option<String>,
        pub recording_duration_ms: Option<u64>,
        pub sample_rate: Option<u32>,
        pub state: String,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStopResponse {
        pub duration_ms: u64,
        pub status: DictationStatusResponse,
        pub transcript: String,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStopRequest {
        pub dictionary: Option<String>,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationAudioLevelResponse {
        pub level: f32,
        pub peak: f32,
        pub recording_duration_ms: Option<u64>,
        pub sample_rate: Option<u32>,
        pub state: String,
    }

    #[tauri::command]
    pub fn dictation_status(
        _app: tauri::AppHandle,
        _state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        Ok(unavailable_status())
    }

    #[tauri::command]
    pub async fn dictation_prepare(
        _app: tauri::AppHandle,
        _state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        Ok(unavailable_status())
    }

    #[tauri::command]
    pub async fn dictation_start(
        _app: tauri::AppHandle,
        _state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        Ok(unavailable_status())
    }

    #[tauri::command]
    pub async fn dictation_stop(
        _app: tauri::AppHandle,
        _state: tauri::State<'_, DictationState>,
        request: Option<DictationStopRequest>,
    ) -> Result<DictationStopResponse, String> {
        let _dictionary = request
            .as_ref()
            .and_then(|request| request.dictionary.as_deref());

        Ok(DictationStopResponse {
            duration_ms: 0,
            status: unavailable_status(),
            transcript: String::new(),
        })
    }

    #[tauri::command]
    pub fn dictation_cancel(
        _app: tauri::AppHandle,
        _state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        Ok(unavailable_status())
    }

    #[tauri::command]
    pub fn dictation_audio_level(
        _state: tauri::State<'_, DictationState>,
    ) -> Result<DictationAudioLevelResponse, String> {
        Ok(DictationAudioLevelResponse {
            level: 0.0,
            peak: 0.0,
            recording_duration_ms: None,
            sample_rate: None,
            state: "missingModel".to_string(),
        })
    }

    fn unavailable_status() -> DictationStatusResponse {
        DictationStatusResponse {
            can_fallback: true,
            accelerator: "cpu".to_string(),
            gpu_available: false,
            gpu_device_id: None,
            gpu_device_name: None,
            engine: "local-whisper".to_string(),
            message: "Offline Whisper dictation is not compiled into this build. Build with the `offline-dictation` Cargo feature and run scripts/prepare-whisper-model.ps1 for release packaging.".to_string(),
            model: "Whisper base.en".to_string(),
            model_available: false,
            model_loaded: false,
            model_path: None,
            recording_duration_ms: None,
            sample_rate: None,
            state: "missingModel".to_string(),
        }
    }
}

#[cfg(not(feature = "offline-dictation"))]
pub use stub::*;

#[cfg(feature = "offline-dictation")]
mod native {
    use cpal::{
        traits::{DeviceTrait, HostTrait, StreamTrait},
        SampleFormat, Stream,
    };
    use serde::{Deserialize, Serialize};
    use std::{
        env,
        path::{Path, PathBuf},
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };
    use tauri::{path::BaseDirectory, AppHandle, Manager};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    const DICTATION_MODEL_NAME: &str = "Whisper base.en";
    const DICTATION_MODEL_FILE: &str = "ggml-base.en.bin";
    const DICTATION_MODEL_RESOURCE: &str = "models/whisper/ggml-base.en.bin";
    const DICTATION_TARGET_SAMPLE_RATE: u32 = 16_000;
    const DICTATION_ACCELERATOR_ENV: &str = "GILBERT_CODEX_DICTATION_ACCELERATOR";
    const DICTATION_BEAM_SIZE: i32 = 5;
    const DICTATION_STOP_TAIL_CAPTURE_MS: u64 = 180;
    const DICTATION_PROMPT_MAX_PHRASES: usize = 80;
    const DICTATION_PROMPT_MAX_CHARS: usize = 900;
    const GPU_RETRY_INTERVAL: Duration = Duration::from_secs(20);

    #[derive(Default)]
    pub struct DictationState {
        runtime: Mutex<DictationRuntime>,
    }

    #[derive(Default)]
    struct DictationRuntime {
        acceleration: DictationAcceleration,
        context: Option<Arc<WhisperContext>>,
        gpu_device_id: Option<i32>,
        gpu_device_name: Option<String>,
        last_acceleration_probe: Option<Instant>,
        last_error: Option<String>,
        lifecycle: DictationLifecycle,
        recording: Option<RecordingSession>,
    }

    struct RecordingSession {
        samples: Arc<Mutex<Vec<f32>>>,
        sample_rate: u32,
        started_at: Instant,
        stream: Stream,
    }

    #[allow(dead_code)]
    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
    enum DictationLifecycle {
        #[default]
        Idle,
        Warming,
        Ready,
        Recording,
        Transcribing,
        Blocked,
        Error,
        MissingModel,
    }

    impl DictationLifecycle {
        fn as_str(self) -> &'static str {
            match self {
                DictationLifecycle::Idle => "idle",
                DictationLifecycle::Warming => "warming",
                DictationLifecycle::Ready => "ready",
                DictationLifecycle::Recording => "recording",
                DictationLifecycle::Transcribing => "transcribing",
                DictationLifecycle::Blocked => "blocked",
                DictationLifecycle::Error => "error",
                DictationLifecycle::MissingModel => "missingModel",
            }
        }
    }

    #[allow(dead_code)]
    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
    enum DictationAcceleration {
        #[default]
        Cpu,
        Cuda,
        Vulkan,
        CpuFallback,
    }

    impl DictationAcceleration {
        fn as_str(self) -> &'static str {
            match self {
                DictationAcceleration::Cpu => "cpu",
                DictationAcceleration::Cuda => "nvidia-cuda",
                DictationAcceleration::Vulkan => "vulkan-gpu",
                DictationAcceleration::CpuFallback => "cpu-fallback",
            }
        }

        fn gpu_available(self) -> bool {
            matches!(
                self,
                DictationAcceleration::Cuda | DictationAcceleration::Vulkan
            )
        }
    }

    #[allow(dead_code)]
    #[derive(Clone, Debug, Eq, PartialEq)]
    enum DictationAccelerationTarget {
        Cpu,
        Cuda { device_id: i32, device_name: String },
        Vulkan { device_id: i32, device_name: String },
    }

    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
    enum DictationAccelerationPreference {
        #[default]
        Cpu,
        AutoGpu,
        Cuda,
        Vulkan,
    }

    struct LoadedWhisperContext {
        acceleration: DictationAcceleration,
        context: WhisperContext,
        gpu_device_id: Option<i32>,
        gpu_device_name: Option<String>,
    }

    #[derive(Clone, Debug)]
    struct DictationModelPath {
        exists: bool,
        path: Option<PathBuf>,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStatusResponse {
        pub can_fallback: bool,
        pub accelerator: String,
        pub gpu_available: bool,
        pub gpu_device_id: Option<i32>,
        pub gpu_device_name: Option<String>,
        pub engine: String,
        pub message: String,
        pub model: String,
        pub model_available: bool,
        pub model_loaded: bool,
        pub model_path: Option<String>,
        pub recording_duration_ms: Option<u64>,
        pub sample_rate: Option<u32>,
        pub state: String,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStopResponse {
        pub duration_ms: u64,
        pub status: DictationStatusResponse,
        pub transcript: String,
    }

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationStopRequest {
        pub dictionary: Option<String>,
    }

    #[derive(Clone, Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct DictationAudioLevelResponse {
        pub level: f32,
        pub peak: f32,
        pub recording_duration_ms: Option<u64>,
        pub sample_rate: Option<u32>,
        pub state: String,
    }

    #[tauri::command]
    pub fn dictation_status(
        app: AppHandle,
        state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        Ok(current_status(&app, &state))
    }

    #[tauri::command]
    pub async fn dictation_prepare(
        app: AppHandle,
        state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        ensure_model_loaded(&app, &state).await
    }

    #[tauri::command]
    pub async fn dictation_start(
        app: AppHandle,
        state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        let model_path = resolve_dictation_model_path(&app);
        if !model_path.exists {
            let mut runtime = lock_runtime(&state)?;
            runtime.lifecycle = DictationLifecycle::MissingModel;
            runtime.last_error = Some(missing_model_message());
            return Ok(status_from_runtime(&app, &runtime));
        }

        {
            let runtime = lock_runtime(&state)?;
            if runtime.recording.is_some() {
                return Ok(status_from_runtime(&app, &runtime));
            }
            if runtime.lifecycle == DictationLifecycle::Transcribing {
                return Ok(status_from_runtime(&app, &runtime));
            }
        }

        match start_recording_session() {
            Ok(session) => {
                let mut runtime = lock_runtime(&state)?;
                runtime.last_error = None;
                runtime.lifecycle = DictationLifecycle::Recording;
                runtime.recording = Some(session);
                Ok(status_from_runtime(&app, &runtime))
            }
            Err(error) => {
                let lifecycle = if is_permission_like_error(&error) {
                    DictationLifecycle::Blocked
                } else {
                    DictationLifecycle::Error
                };
                let mut runtime = lock_runtime(&state)?;
                runtime.last_error = Some(error);
                runtime.lifecycle = lifecycle;
                Ok(status_from_runtime(&app, &runtime))
            }
        }
    }

    #[tauri::command]
    pub async fn dictation_stop(
        app: AppHandle,
        state: tauri::State<'_, DictationState>,
        request: Option<DictationStopRequest>,
    ) -> Result<DictationStopResponse, String> {
        let initial_prompt = build_dictation_initial_prompt(
            request
                .as_ref()
                .and_then(|request| request.dictionary.as_deref()),
        );
        let (context, session) = {
            let mut runtime = lock_runtime(&state)?;
            let Some(session) = runtime.recording.take() else {
                return Ok(DictationStopResponse {
                    duration_ms: 0,
                    status: status_from_runtime(&app, &runtime),
                    transcript: String::new(),
                });
            };
            let context = runtime.context.clone();
            runtime.lifecycle = DictationLifecycle::Transcribing;
            runtime.last_error = None;
            (context, session)
        };

        tokio::time::sleep(Duration::from_millis(DICTATION_STOP_TAIL_CAPTURE_MS)).await;
        drop(session.stream);
        let duration_ms = session.started_at.elapsed().as_millis() as u64;
        let captured_samples = {
            let samples = session
                .samples
                .lock()
                .map_err(|_| "Could not read captured microphone audio.".to_string())?;
            samples.clone()
        };
        let audio = resample_linear_to_16khz(&captured_samples, session.sample_rate);
        let context = match context {
            Some(context) => context,
            None => {
                let model_path = resolve_dictation_model_path(&app);
                let Some(path) = model_path.path.clone().filter(|_| model_path.exists) else {
                    let mut runtime = lock_runtime(&state)?;
                    runtime.lifecycle = DictationLifecycle::MissingModel;
                    runtime.last_error = Some(missing_model_message());
                    return Ok(DictationStopResponse {
                        duration_ms,
                        status: status_from_runtime(&app, &runtime),
                        transcript: String::new(),
                    });
                };

                let target = preferred_acceleration_target();
                match tauri::async_runtime::spawn_blocking(move || {
                    load_whisper_context(&path, target)
                })
                .await
                {
                    Ok(Ok(loaded_context)) => {
                        let context = Arc::new(loaded_context.context);
                        let mut runtime = lock_runtime(&state)?;
                        runtime.acceleration = loaded_context.acceleration;
                        runtime.context = Some(context.clone());
                        runtime.gpu_device_id = loaded_context.gpu_device_id;
                        runtime.gpu_device_name = loaded_context.gpu_device_name;
                        runtime.last_acceleration_probe = Some(Instant::now());
                        runtime.last_error = None;
                        context
                    }
                    Ok(Err(error)) => {
                        let mut runtime = lock_runtime(&state)?;
                        runtime.lifecycle = DictationLifecycle::Error;
                        runtime.last_error = Some(error);
                        return Ok(DictationStopResponse {
                            duration_ms,
                            status: status_from_runtime(&app, &runtime),
                            transcript: String::new(),
                        });
                    }
                    Err(error) => {
                        let mut runtime = lock_runtime(&state)?;
                        runtime.lifecycle = DictationLifecycle::Error;
                        runtime.last_error =
                            Some(format!("Offline dictation worker stopped: {error}"));
                        return Ok(DictationStopResponse {
                            duration_ms,
                            status: status_from_runtime(&app, &runtime),
                            transcript: String::new(),
                        });
                    }
                }
            }
        };

        let transcript_result = tauri::async_runtime::spawn_blocking(move || {
            transcribe_samples(context, audio, initial_prompt)
        })
        .await;
        let transcript = match transcript_result {
            Ok(Ok(text)) => text,
            Ok(Err(error)) => {
                let mut runtime = lock_runtime(&state)?;
                runtime.lifecycle = DictationLifecycle::Error;
                runtime.last_error = Some(error);
                return Ok(DictationStopResponse {
                    duration_ms,
                    status: status_from_runtime(&app, &runtime),
                    transcript: String::new(),
                });
            }
            Err(error) => {
                let mut runtime = lock_runtime(&state)?;
                runtime.lifecycle = DictationLifecycle::Error;
                runtime.last_error = Some(format!("Offline dictation worker stopped: {error}"));
                return Ok(DictationStopResponse {
                    duration_ms,
                    status: status_from_runtime(&app, &runtime),
                    transcript: String::new(),
                });
            }
        };

        let mut runtime = lock_runtime(&state)?;
        runtime.lifecycle = DictationLifecycle::Ready;
        runtime.last_error = None;
        Ok(DictationStopResponse {
            duration_ms,
            status: status_from_runtime(&app, &runtime),
            transcript,
        })
    }

    #[tauri::command]
    pub fn dictation_cancel(
        app: AppHandle,
        state: tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        let mut runtime = lock_runtime(&state)?;
        runtime.recording.take();
        runtime.lifecycle = if runtime.context.is_some() {
            DictationLifecycle::Ready
        } else {
            DictationLifecycle::Idle
        };
        runtime.last_error = None;
        Ok(status_from_runtime(&app, &runtime))
    }

    #[tauri::command]
    pub fn dictation_audio_level(
        state: tauri::State<'_, DictationState>,
    ) -> Result<DictationAudioLevelResponse, String> {
        let runtime = lock_runtime(&state)?;
        let Some(recording) = runtime.recording.as_ref() else {
            return Ok(DictationAudioLevelResponse {
                level: 0.0,
                peak: 0.0,
                recording_duration_ms: None,
                sample_rate: None,
                state: runtime.lifecycle.as_str().to_string(),
            });
        };

        let samples = recording
            .samples
            .lock()
            .map_err(|_| "Could not read microphone audio level.".to_string())?;
        let (level, peak) = calculate_audio_level(&samples, recording.sample_rate);

        Ok(DictationAudioLevelResponse {
            level,
            peak,
            recording_duration_ms: Some(recording.started_at.elapsed().as_millis() as u64),
            sample_rate: Some(recording.sample_rate),
            state: DictationLifecycle::Recording.as_str().to_string(),
        })
    }

    async fn ensure_model_loaded(
        app: &AppHandle,
        state: &tauri::State<'_, DictationState>,
    ) -> Result<DictationStatusResponse, String> {
        {
            let runtime = lock_runtime(state)?;
            if matches!(
                runtime.lifecycle,
                DictationLifecycle::Warming
                    | DictationLifecycle::Recording
                    | DictationLifecycle::Transcribing
            ) {
                return Ok(status_from_runtime(app, &runtime));
            }
        }

        let model_path = resolve_dictation_model_path(app);
        let Some(path) = model_path.path.clone().filter(|_| model_path.exists) else {
            let mut runtime = lock_runtime(state)?;
            runtime.lifecycle = DictationLifecycle::MissingModel;
            runtime.last_error = Some(missing_model_message());
            return Ok(status_from_runtime(app, &runtime));
        };

        let target = preferred_acceleration_target();
        {
            let mut runtime = lock_runtime(state)?;
            if matches!(
                runtime.lifecycle,
                DictationLifecycle::Recording | DictationLifecycle::Transcribing
            ) {
                return Ok(status_from_runtime(app, &runtime));
            }
            if runtime.context.is_some() && !should_reload_context(&runtime, &target) {
                if target == DictationAccelerationTarget::Cpu
                    && runtime.acceleration == DictationAcceleration::CpuFallback
                {
                    runtime.acceleration = DictationAcceleration::Cpu;
                    runtime.gpu_device_id = None;
                    runtime.gpu_device_name = None;
                }
                return Ok(status_from_runtime(app, &runtime));
            }

            runtime.lifecycle = DictationLifecycle::Warming;
            runtime.last_error = None;
            runtime.last_acceleration_probe = Some(Instant::now());
        }

        let load_result =
            tauri::async_runtime::spawn_blocking(move || load_whisper_context(&path, target)).await;
        match load_result {
            Ok(Ok(loaded_context)) => {
                let mut runtime = lock_runtime(state)?;
                runtime.acceleration = loaded_context.acceleration;
                runtime.context = Some(Arc::new(loaded_context.context));
                runtime.gpu_device_id = loaded_context.gpu_device_id;
                runtime.gpu_device_name = loaded_context.gpu_device_name;
                runtime.last_acceleration_probe = Some(Instant::now());
                if runtime.lifecycle == DictationLifecycle::Warming {
                    runtime.lifecycle = DictationLifecycle::Ready;
                }
                runtime.last_error = None;
                Ok(status_from_runtime(app, &runtime))
            }
            Ok(Err(error)) => {
                let mut runtime = lock_runtime(state)?;
                if runtime.lifecycle == DictationLifecycle::Warming {
                    runtime.lifecycle = DictationLifecycle::Error;
                    runtime.last_error = Some(error);
                }
                Ok(status_from_runtime(app, &runtime))
            }
            Err(error) => {
                let mut runtime = lock_runtime(state)?;
                if runtime.lifecycle == DictationLifecycle::Warming {
                    runtime.lifecycle = DictationLifecycle::Error;
                    runtime.last_error = Some(format!("Offline dictation worker stopped: {error}"));
                }
                Ok(status_from_runtime(app, &runtime))
            }
        }
    }

    fn load_whisper_context(
        path: &Path,
        target: DictationAccelerationTarget,
    ) -> Result<LoadedWhisperContext, String> {
        let path_text = path
            .to_str()
            .ok_or_else(|| "Offline dictation model path contains invalid UTF-8.".to_string())?;

        match &target {
            DictationAccelerationTarget::Cuda {
                device_id,
                device_name,
            } => {
                let mut gpu_params = WhisperContextParameters::default();
                gpu_params.use_gpu(true).gpu_device(*device_id);
                if let Ok(context) = WhisperContext::new_with_params(path_text, gpu_params) {
                    return Ok(LoadedWhisperContext {
                        acceleration: DictationAcceleration::Cuda,
                        context,
                        gpu_device_id: Some(*device_id),
                        gpu_device_name: Some(device_name.clone()),
                    });
                }
            }
            DictationAccelerationTarget::Vulkan {
                device_id,
                device_name,
            } => {
                let mut gpu_params = WhisperContextParameters::default();
                gpu_params.use_gpu(true).gpu_device(*device_id);
                if let Ok(context) = WhisperContext::new_with_params(path_text, gpu_params) {
                    return Ok(LoadedWhisperContext {
                        acceleration: DictationAcceleration::Vulkan,
                        context,
                        gpu_device_id: Some(*device_id),
                        gpu_device_name: Some(device_name.clone()),
                    });
                }
            }
            DictationAccelerationTarget::Cpu => {}
        }

        let mut cpu_params = WhisperContextParameters::default();
        cpu_params.use_gpu(false);
        WhisperContext::new_with_params(path_text, cpu_params)
            .map(|context| LoadedWhisperContext {
                acceleration: match target {
                    DictationAccelerationTarget::Cpu => DictationAcceleration::Cpu,
                    DictationAccelerationTarget::Cuda { .. }
                    | DictationAccelerationTarget::Vulkan { .. } => {
                        DictationAcceleration::CpuFallback
                    }
                },
                context,
                gpu_device_id: None,
                gpu_device_name: None,
            })
            .map_err(|error| format!("Could not load offline dictation model: {error}"))
    }

    fn preferred_acceleration_target() -> DictationAccelerationTarget {
        match parse_acceleration_preference(env::var(DICTATION_ACCELERATOR_ENV).ok().as_deref()) {
            DictationAccelerationPreference::Cpu => return DictationAccelerationTarget::Cpu,
            DictationAccelerationPreference::Cuda => {
                #[cfg(feature = "offline-dictation-cuda")]
                {
                    return DictationAccelerationTarget::Cuda {
                        device_id: 0,
                        device_name: "NVIDIA CUDA device 0".to_string(),
                    };
                }
            }
            DictationAccelerationPreference::Vulkan | DictationAccelerationPreference::AutoGpu => {
                #[cfg(feature = "offline-dictation-vulkan")]
                {
                    if let Some(device) = preferred_vulkan_device() {
                        return DictationAccelerationTarget::Vulkan {
                            device_id: device.id,
                            device_name: device.name,
                        };
                    }
                }

                #[cfg(all(
                    feature = "offline-dictation-cuda",
                    not(feature = "offline-dictation-vulkan")
                ))]
                {
                    return DictationAccelerationTarget::Cuda {
                        device_id: 0,
                        device_name: "NVIDIA CUDA device 0".to_string(),
                    };
                }
            }
        }

        DictationAccelerationTarget::Cpu
    }

    fn parse_acceleration_preference(value: Option<&str>) -> DictationAccelerationPreference {
        match value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("auto") | Some("gpu") => DictationAccelerationPreference::AutoGpu,
            Some("cuda") | Some("nvidia") | Some("nvidia-cuda") => {
                DictationAccelerationPreference::Cuda
            }
            Some("vulkan") | Some("vulkan-gpu") => DictationAccelerationPreference::Vulkan,
            _ => DictationAccelerationPreference::Cpu,
        }
    }

    #[cfg(feature = "offline-dictation-vulkan")]
    fn preferred_vulkan_device() -> Option<whisper_rs::vulkan::VkDeviceInfo> {
        let mut devices = whisper_rs::vulkan::list_devices();
        devices.sort_by(|left, right| {
            vulkan_device_rank(right)
                .cmp(&vulkan_device_rank(left))
                .then_with(|| left.id.cmp(&right.id))
        });
        devices.into_iter().next()
    }

    #[cfg(feature = "offline-dictation-vulkan")]
    fn vulkan_device_rank(device: &whisper_rs::vulkan::VkDeviceInfo) -> (u8, usize) {
        (vulkan_device_name_priority(&device.name), device.vram.total)
    }

    #[allow(dead_code)]
    fn vulkan_device_name_priority(name: &str) -> u8 {
        let normalized = name.to_lowercase();
        if normalized.contains("nvidia")
            || normalized.contains("geforce")
            || normalized.contains("rtx")
            || normalized.contains("quadro")
            || normalized.contains("amd")
            || normalized.contains("radeon")
            || normalized.contains("arc")
        {
            3
        } else if normalized.contains("intel") {
            2
        } else {
            1
        }
    }

    fn should_reload_context(
        runtime: &DictationRuntime,
        target: &DictationAccelerationTarget,
    ) -> bool {
        if runtime.context.is_none() {
            return true;
        }

        let gpu_retry_allowed = runtime
            .last_acceleration_probe
            .map(|probe| probe.elapsed() >= GPU_RETRY_INTERVAL)
            .unwrap_or(true);

        match target {
            DictationAccelerationTarget::Cpu => !matches!(
                runtime.acceleration,
                DictationAcceleration::Cpu | DictationAcceleration::CpuFallback
            ),
            DictationAccelerationTarget::Cuda {
                device_id,
                device_name,
            } => {
                if runtime.acceleration == DictationAcceleration::Cuda
                    && runtime.gpu_device_id == Some(*device_id)
                    && runtime.gpu_device_name.as_deref() == Some(device_name.as_str())
                {
                    return false;
                }

                gpu_retry_allowed
            }
            DictationAccelerationTarget::Vulkan {
                device_id,
                device_name,
            } => {
                if runtime.acceleration == DictationAcceleration::Vulkan
                    && runtime.gpu_device_id == Some(*device_id)
                    && runtime.gpu_device_name.as_deref() == Some(device_name.as_str())
                {
                    return false;
                }

                gpu_retry_allowed
            }
        }
    }

    fn transcribe_samples(
        context: Arc<WhisperContext>,
        audio: Vec<f32>,
        initial_prompt: Option<String>,
    ) -> Result<String, String> {
        if audio.len() < (DICTATION_TARGET_SAMPLE_RATE as usize / 5) {
            return Ok(String::new());
        }

        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: DICTATION_BEAM_SIZE,
            patience: -1.0,
        });
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(true);
        params.set_suppress_blank(true);
        params.set_suppress_nst(true);
        params.set_temperature(0.0);
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        params.set_no_speech_thold(0.6);
        params.set_n_threads(recommended_decode_threads());
        if let Some(initial_prompt) = initial_prompt.as_deref() {
            params.set_initial_prompt(initial_prompt);
        }

        let mut whisper_state = context
            .create_state()
            .map_err(|error| format!("Could not create offline dictation state: {error}"))?;
        whisper_state
            .full(params, &audio)
            .map_err(|error| format!("Offline dictation failed: {error}"))?;

        Ok(whisper_state
            .as_iter()
            .map(|segment| segment.to_string())
            .collect::<Vec<_>>()
            .join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "))
    }

    fn build_dictation_initial_prompt(dictionary: Option<&str>) -> Option<String> {
        let phrases = dictionary?
            .lines()
            .map(sanitize_dictation_prompt_phrase)
            .filter(|phrase| !phrase.is_empty())
            .take(DICTATION_PROMPT_MAX_PHRASES)
            .collect::<Vec<_>>();

        if phrases.is_empty() {
            return None;
        }

        let mut prompt = format!("Vocabulary: {}.", phrases.join(", "));
        if prompt.len() > DICTATION_PROMPT_MAX_CHARS {
            truncate_string_at_char_boundary(&mut prompt, DICTATION_PROMPT_MAX_CHARS);
            prompt = prompt
                .trim_end_matches(|character: char| {
                    character.is_whitespace() || character == ',' || character == '.'
                })
                .to_string();
            prompt.push('.');
        }

        Some(prompt)
    }

    fn sanitize_dictation_prompt_phrase(phrase: &str) -> String {
        phrase
            .chars()
            .filter(|character| *character != '\0')
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn truncate_string_at_char_boundary(text: &mut String, max_len: usize) {
        if text.len() <= max_len {
            return;
        }

        let boundary = text
            .char_indices()
            .map(|(index, _)| index)
            .take_while(|index| *index <= max_len)
            .last()
            .unwrap_or(0);
        text.truncate(boundary);
    }

    fn recommended_decode_threads() -> i32 {
        let available = std::thread::available_parallelism()
            .map(|threads| threads.get())
            .unwrap_or(4);
        available.saturating_sub(1).clamp(2, 8) as i32
    }

    fn start_recording_session() -> Result<RecordingSession, String> {
        let host = cpal::default_host();
        let device = host
            .default_input_device()
            .ok_or_else(|| "No microphone input device was found.".to_string())?;
        let supported_config = device
            .default_input_config()
            .map_err(|error| format!("Could not open the default microphone: {error}"))?;
        let sample_format = supported_config.sample_format();
        let config = supported_config.config();
        let sample_rate = config.sample_rate;
        let channels = usize::from(config.channels.max(1));
        let samples = Arc::new(Mutex::new(Vec::<f32>::new()));
        let error_log = Arc::new(Mutex::new(None::<String>));

        let stream = match sample_format {
            SampleFormat::F32 => {
                build_input_stream_f32(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::F64 => {
                build_input_stream_f64(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::I8 => {
                build_input_stream_i8(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::I16 => {
                build_input_stream_i16(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::I32 => {
                build_input_stream_i32(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::U8 => {
                build_input_stream_u8(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::U16 => {
                build_input_stream_u16(&device, &config, channels, &samples, &error_log)
            }
            SampleFormat::U32 => {
                build_input_stream_u32(&device, &config, channels, &samples, &error_log)
            }
            other => Err(format!(
                "Microphone sample format `{other}` is not supported yet."
            )),
        }?;

        stream
            .play()
            .map_err(|error| format!("Could not start microphone capture: {error}"))?;

        Ok(RecordingSession {
            samples,
            sample_rate,
            started_at: Instant::now(),
            stream,
        })
    }

    macro_rules! build_input_stream {
        ($name:ident, $sample_type:ty, $convert:expr) => {
            fn $name(
                device: &cpal::Device,
                config: &cpal::StreamConfig,
                channels: usize,
                samples: &Arc<Mutex<Vec<f32>>>,
                error_log: &Arc<Mutex<Option<String>>>,
            ) -> Result<Stream, String> {
                let samples = Arc::clone(samples);
                let error_log = Arc::clone(error_log);
                let convert = $convert;
                device
                    .build_input_stream(
                        config,
                        move |data: &[$sample_type], _info: &cpal::InputCallbackInfo| {
                            push_mono_samples(data, channels, &samples, convert);
                        },
                        move |error| {
                            if let Ok(mut last_error) = error_log.lock() {
                                *last_error = Some(error.to_string());
                            }
                        },
                        None,
                    )
                    .map_err(|error| format!("Could not build microphone capture stream: {error}"))
            }
        };
    }

    build_input_stream!(build_input_stream_f32, f32, |sample: f32| sample
        .clamp(-1.0, 1.0));
    build_input_stream!(build_input_stream_f64, f64, |sample: f64| (sample as f32)
        .clamp(-1.0, 1.0));
    build_input_stream!(build_input_stream_i8, i8, |sample: i8| sample as f32
        / i8::MAX as f32);
    build_input_stream!(build_input_stream_i16, i16, |sample: i16| sample as f32
        / i16::MAX as f32);
    build_input_stream!(build_input_stream_i32, i32, |sample: i32| sample as f32
        / i32::MAX as f32);
    build_input_stream!(build_input_stream_u8, u8, |sample: u8| (sample as f32
        - 128.0)
        / 128.0);
    build_input_stream!(build_input_stream_u16, u16, |sample: u16| (sample as f32
        - 32_768.0)
        / 32_768.0);
    build_input_stream!(build_input_stream_u32, u32, |sample: u32| {
        (sample as f32 - 2_147_483_648.0) / 2_147_483_648.0
    });

    fn push_mono_samples<T>(
        input: &[T],
        channels: usize,
        samples: &Arc<Mutex<Vec<f32>>>,
        convert: impl Fn(T) -> f32 + Copy,
    ) where
        T: Copy,
    {
        if input.is_empty() {
            return;
        }

        let mut mono = Vec::with_capacity(input.len() / channels.max(1));
        for frame in input.chunks(channels.max(1)) {
            let summed = frame
                .iter()
                .copied()
                .map(convert)
                .fold(0.0_f32, |total, sample| total + sample);
            mono.push((summed / frame.len().max(1) as f32).clamp(-1.0, 1.0));
        }

        if let Ok(mut captured) = samples.lock() {
            captured.extend(mono);
        }
    }

    fn resample_linear_to_16khz(samples: &[f32], source_rate: u32) -> Vec<f32> {
        resample_linear(samples, source_rate, DICTATION_TARGET_SAMPLE_RATE)
    }

    fn calculate_audio_level(samples: &[f32], sample_rate: u32) -> (f32, f32) {
        if samples.is_empty() {
            return (0.0, 0.0);
        }

        let window_size = ((sample_rate as usize) / 24).clamp(256, 4096);
        let start = samples.len().saturating_sub(window_size);
        let window = &samples[start..];
        if window.is_empty() {
            return (0.0, 0.0);
        }

        let mut peak = 0.0_f32;
        let mut sum_squares = 0.0_f32;
        for sample in window {
            let absolute = sample.abs().clamp(0.0, 1.0);
            peak = peak.max(absolute);
            sum_squares += absolute * absolute;
        }

        let rms = (sum_squares / window.len() as f32).sqrt();
        let level = ((rms * 7.5) + (peak * 0.35)).sqrt().clamp(0.0, 1.0);
        (level, peak)
    }

    fn resample_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
        if samples.is_empty() || source_rate == 0 || target_rate == 0 {
            return Vec::new();
        }

        if source_rate == target_rate {
            return samples.to_vec();
        }

        let ratio = source_rate as f64 / target_rate as f64;
        let target_len = ((samples.len() as f64) / ratio).ceil().max(1.0) as usize;
        let mut output = Vec::with_capacity(target_len);

        for index in 0..target_len {
            let source_position = index as f64 * ratio;
            let left_index = source_position.floor() as usize;
            let right_index = (left_index + 1).min(samples.len() - 1);
            let fraction = (source_position - left_index as f64) as f32;
            let left = samples[left_index];
            let right = samples[right_index];
            output.push(left + (right - left) * fraction);
        }

        output
    }

    fn current_status(
        app: &AppHandle,
        state: &tauri::State<'_, DictationState>,
    ) -> DictationStatusResponse {
        match lock_runtime(state) {
            Ok(runtime) => status_from_runtime(app, &runtime),
            Err(error) => error_status(error),
        }
    }

    fn status_from_runtime(app: &AppHandle, runtime: &DictationRuntime) -> DictationStatusResponse {
        let model_path = resolve_dictation_model_path(app);
        let model_loaded = runtime.context.is_some();
        let mut lifecycle = runtime.lifecycle;

        if !model_loaded && !model_path.exists && !matches!(lifecycle, DictationLifecycle::Warming)
        {
            lifecycle = DictationLifecycle::MissingModel;
        } else if model_loaded
            && matches!(
                lifecycle,
                DictationLifecycle::Idle | DictationLifecycle::MissingModel
            )
        {
            lifecycle = DictationLifecycle::Ready;
        }

        let recording_duration_ms = runtime
            .recording
            .as_ref()
            .map(|recording| recording.started_at.elapsed().as_millis() as u64);
        let sample_rate = runtime
            .recording
            .as_ref()
            .map(|recording| recording.sample_rate);
        let message = status_message(lifecycle, runtime.last_error.as_deref());

        DictationStatusResponse {
            can_fallback: matches!(
                lifecycle,
                DictationLifecycle::MissingModel
                    | DictationLifecycle::Error
                    | DictationLifecycle::Idle
            ),
            accelerator: runtime.acceleration.as_str().to_string(),
            gpu_available: runtime.acceleration.gpu_available(),
            gpu_device_id: runtime.gpu_device_id,
            gpu_device_name: runtime.gpu_device_name.clone(),
            engine: "local-whisper".to_string(),
            message,
            model: DICTATION_MODEL_NAME.to_string(),
            model_available: model_path.exists,
            model_loaded,
            model_path: model_path.path.map(|path| path.display().to_string()),
            recording_duration_ms,
            sample_rate,
            state: lifecycle.as_str().to_string(),
        }
    }

    fn status_message(lifecycle: DictationLifecycle, last_error: Option<&str>) -> String {
        match lifecycle {
            DictationLifecycle::Idle => "Offline dictation is idle.".to_string(),
            DictationLifecycle::Warming => "Warming offline Whisper dictation.".to_string(),
            DictationLifecycle::Ready => "Offline Whisper dictation is ready.".to_string(),
            DictationLifecycle::Recording => "Recording locally.".to_string(),
            DictationLifecycle::Transcribing => "Transcribing locally with Whisper.".to_string(),
            DictationLifecycle::Blocked => last_error
                .unwrap_or("Microphone permission is blocked.")
                .to_string(),
            DictationLifecycle::Error => last_error
                .unwrap_or("Offline dictation could not complete.")
                .to_string(),
            DictationLifecycle::MissingModel => missing_model_message(),
        }
    }

    fn error_status(message: String) -> DictationStatusResponse {
        DictationStatusResponse {
            can_fallback: true,
            accelerator: "cpu".to_string(),
            gpu_available: false,
            gpu_device_id: None,
            gpu_device_name: None,
            engine: "local-whisper".to_string(),
            message,
            model: DICTATION_MODEL_NAME.to_string(),
            model_available: false,
            model_loaded: false,
            model_path: None,
            recording_duration_ms: None,
            sample_rate: None,
            state: DictationLifecycle::Error.as_str().to_string(),
        }
    }

    fn resolve_dictation_model_path(app: &AppHandle) -> DictationModelPath {
        let resource_path = app
            .path()
            .resolve(DICTATION_MODEL_RESOURCE, BaseDirectory::Resource)
            .ok();
        if let Some(path) = resource_path.as_ref().filter(|path| path.exists()) {
            return DictationModelPath {
                exists: true,
                path: Some(path.clone()),
            };
        }

        let source_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("resources")
            .join("models")
            .join("whisper")
            .join(DICTATION_MODEL_FILE);

        if source_path.exists() {
            return DictationModelPath {
                exists: true,
                path: Some(source_path),
            };
        }

        DictationModelPath {
            exists: false,
            path: resource_path.or(Some(source_path)),
        }
    }

    fn missing_model_message() -> String {
        "Offline dictation model is missing. Run scripts/prepare-whisper-model.ps1 before building a release; desktop dictation will stay native instead of silently using browser speech.".to_string()
    }

    fn is_permission_like_error(error: &str) -> bool {
        let normalized = error.to_lowercase();
        normalized.contains("permission")
            || normalized.contains("denied")
            || normalized.contains("access")
            || normalized.contains("unauthorized")
    }

    fn lock_runtime<'a>(
        state: &'a tauri::State<'_, DictationState>,
    ) -> Result<std::sync::MutexGuard<'a, DictationRuntime>, String> {
        state
            .runtime
            .lock()
            .map_err(|_| "Offline dictation state is unavailable.".to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::{
            build_dictation_initial_prompt, is_permission_like_error,
            parse_acceleration_preference, push_mono_samples, recommended_decode_threads,
            resample_linear, vulkan_device_name_priority, DictationAccelerationPreference,
        };
        use std::sync::{Arc, Mutex};

        #[test]
        fn resampler_keeps_samples_when_rates_match() {
            let input = vec![0.0, 0.5, -0.5, 1.0];
            assert_eq!(resample_linear(&input, 16_000, 16_000), input);
        }

        #[test]
        fn resampler_downsamples_to_target_length() {
            let input = vec![0.0_f32; 48_000];
            let output = resample_linear(&input, 48_000, 16_000);
            assert_eq!(output.len(), 16_000);
        }

        #[test]
        fn mono_capture_averages_interleaved_channels() {
            let samples = Arc::new(Mutex::new(Vec::new()));
            push_mono_samples(&[1.0_f32, -1.0, 0.5, 0.25], 2, &samples, |sample| sample);

            let captured = samples.lock().unwrap();
            assert_eq!(&captured[..], &[0.0, 0.375]);
        }

        #[test]
        fn permission_errors_are_classified_as_blocked() {
            assert!(is_permission_like_error(
                "Access denied by the operating system"
            ));
            assert!(is_permission_like_error("microphone permission was denied"));
            assert!(!is_permission_like_error("No input device was found"));
        }

        #[test]
        fn decode_threads_use_more_than_single_thread() {
            assert!(recommended_decode_threads() >= 2);
            assert!(recommended_decode_threads() <= 8);
        }

        #[test]
        fn vulkan_device_names_prefer_real_gpu_drivers() {
            assert!(vulkan_device_name_priority("NVIDIA GeForce RTX 4080") > 2);
            assert!(vulkan_device_name_priority("AMD Radeon RX 7900") > 2);
            assert!(vulkan_device_name_priority("Intel(R) Arc(TM) Graphics") > 2);
            assert_eq!(vulkan_device_name_priority("Intel(R) Graphics"), 2);
        }

        #[test]
        fn dictation_acceleration_is_cpu_by_default() {
            assert_eq!(
                parse_acceleration_preference(None),
                DictationAccelerationPreference::Cpu
            );
            assert_eq!(
                parse_acceleration_preference(Some("")),
                DictationAccelerationPreference::Cpu
            );
            assert_eq!(
                parse_acceleration_preference(Some("vulkan")),
                DictationAccelerationPreference::Vulkan
            );
            assert_eq!(
                parse_acceleration_preference(Some("gpu")),
                DictationAccelerationPreference::AutoGpu
            );
        }

        #[test]
        fn dictation_initial_prompt_uses_dictionary_phrases() {
            assert_eq!(
                build_dictation_initial_prompt(Some(" Codex \nGilbertCodex\n\nWe need to "))
                    .as_deref(),
                Some("Vocabulary: Codex, GilbertCodex, We need to.")
            );
            assert_eq!(build_dictation_initial_prompt(Some(" \n\t ")), None);
        }

        #[test]
        fn dictation_initial_prompt_removes_nul_bytes() {
            assert_eq!(
                build_dictation_initial_prompt(Some("Gilbert\0Codex")).as_deref(),
                Some("Vocabulary: GilbertCodex.")
            );
        }

        #[test]
        fn dictation_initial_prompt_truncates_on_character_boundary() {
            let prompt =
                build_dictation_initial_prompt(Some(&"\u{1f600}".repeat(1_000))).expect("prompt");
            assert!(prompt.ends_with('.'));
            assert!(prompt.len() <= super::DICTATION_PROMPT_MAX_CHARS + 1);
        }
    }
}

#[cfg(feature = "offline-dictation")]
pub use native::*;
