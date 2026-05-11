//! Local computer filesystem commands.
//!
//! This module backs the desktop workspace picker, file index, Git status,
//! text reads/writes, and delete operations used by the model tool runtime.

use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap, VecDeque},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DEFAULT_DIRECTORY_LIMIT: usize = 600;
const DEFAULT_INDEX_LIMIT: usize = 12_000;
const DEFAULT_INDEX_DEPTH: usize = 16;
const EMBEDDING_DIMS: usize = 64;
const MAX_PREVIEW_BYTES: usize = 8 * 1024;
const MAX_READ_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_INDEX_PREVIEW_BYTES: usize = 4 * 1024;
const MAX_TEXT_INDEX_FILE_BYTES: u64 = 1_500_000;
const MAX_GIT_UNTRACKED_FILES_FOR_STATS: usize = 200;
const MAX_GIT_UNTRACKED_FILE_BYTES: u64 = 1024 * 1024;
const MAX_GIT_DIFF_PREVIEW_FILES: usize = 80;
const MAX_GIT_UNTRACKED_DIFF_BYTES: u64 = 96 * 1024;
const INDEX_PROGRESS_EVENT: &str = "computer-file-index-progress";
const INDEX_PROGRESS_INTERVAL_MS: u64 = 150;
const INDEX_PROGRESS_ENTRY_INTERVAL: usize = 250;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const SKIPPED_INDEX_DIRECTORY_NAMES: &[&str] = &[
    ".cache",
    ".dart_tool",
    ".expo",
    ".git",
    ".gradle",
    ".hg",
    ".idea",
    ".next",
    ".nuxt",
    ".parcel-cache",
    ".pytest_cache",
    ".svn",
    ".turbo",
    ".venv",
    ".vite",
    ".vscode",
    "__pycache__",
    "build",
    "coverage",
    "deriveddata",
    "dist",
    "env",
    "node_modules",
    "pods",
    "target",
    "venv",
];

/// Shared in-memory file index state for the active desktop process.
#[derive(Clone)]
pub struct ComputerFileIndexState {
    active_request_id: Arc<AtomicU64>,
    index: Arc<Mutex<ComputerFileIndex>>,
}

impl Default for ComputerFileIndexState {
    fn default() -> Self {
        Self {
            active_request_id: Arc::new(AtomicU64::new(0)),
            index: Arc::new(Mutex::new(ComputerFileIndex::default())),
        }
    }
}

#[derive(Default)]
struct ComputerFileIndex {
    built_at: Option<u64>,
    entries: Vec<IndexedComputerFile>,
    roots: Vec<String>,
    scanned_directories: usize,
    skipped_entries: usize,
    truncated: bool,
}

#[derive(Clone)]
struct IndexedComputerFile {
    embedding: Vec<f32>,
    extension: Option<String>,
    kind: ComputerFileKind,
    modified_at: Option<u64>,
    name: String,
    path: String,
    preview: Option<String>,
    size: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerFileKind {
    Directory,
    File,
    Symlink,
    Other,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDrive {
    pub available: bool,
    pub kind: String,
    pub label: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryEntry {
    pub extension: Option<String>,
    pub kind: ComputerFileKind,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub size: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryListing {
    pub entries: Vec<ComputerDirectoryEntry>,
    pub inaccessible_entries: usize,
    pub limited: bool,
    pub parent_path: Option<String>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDirectoryRequest {
    pub limit: Option<usize>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerIndexRequest {
    pub max_depth: Option<usize>,
    pub max_files: Option<usize>,
    pub request_id: Option<u64>,
    pub roots: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerFileIndexSummary {
    pub built_at: Option<u64>,
    pub entry_count: usize,
    pub roots: Vec<String>,
    pub scanned_directories: usize,
    pub skipped_entries: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerFileIndexProgress {
    pub current_path: Option<String>,
    pub done: bool,
    pub entry_count: usize,
    pub request_id: u64,
    pub roots: Vec<String>,
    pub scanned_directories: usize,
    pub skipped_entries: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitStatusRequest {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitCommitRequest {
    pub message: String,
    pub path: String,
    pub stage_all: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitCreateBranchRequest {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitPushRequest {
    pub path: String,
    pub remote: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitActionResult {
    pub message: String,
    pub output: Option<String>,
    pub status: ComputerGitStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitChangedFile {
    pub additions: usize,
    pub deletions: usize,
    pub diff_preview: Option<Vec<ComputerGitDiffLine>>,
    pub diff_truncated: bool,
    pub old_path: Option<String>,
    pub path: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitDiffLine {
    pub content: String,
    pub kind: String,
    pub new_line: Option<usize>,
    pub old_line: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerGitStatus {
    pub additions: usize,
    pub ahead: usize,
    pub available: bool,
    pub behind: usize,
    pub branch: Option<String>,
    pub changed_files: usize,
    pub clean: bool,
    pub deletions: usize,
    pub error: Option<String>,
    pub files: Vec<ComputerGitChangedFile>,
    pub github_owner: Option<String>,
    pub github_repo: Option<String>,
    pub head_sha: Option<String>,
    pub remote_url: Option<String>,
    pub repository_root: Option<String>,
    pub upstream: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSearchRequest {
    pub limit: Option<usize>,
    pub query: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerSearchResult {
    pub extension: Option<String>,
    pub kind: ComputerFileKind,
    pub line: Option<usize>,
    pub match_kind: String,
    pub matches: Vec<String>,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub preview: Option<String>,
    pub score: f32,
    pub size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileRequest {
    pub max_bytes: Option<usize>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFileRequest {
    pub content: String,
    pub create_parent_dirs: Option<bool>,
    pub overwrite: Option<bool>,
    pub path: String,
    pub roots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDeleteFileRequest {
    pub path: String,
    pub roots: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerReadFileResult {
    pub content: String,
    pub extension: Option<String>,
    pub modified_at: Option<u64>,
    pub name: String,
    pub path: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerWriteFileResult {
    pub bytes_written: usize,
    pub created: bool,
    pub modified_at: Option<u64>,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerDeleteFileResult {
    pub bytes_deleted: u64,
    pub deleted: bool,
    pub path: String,
}

/// Returns the user's default workspace path when the host can determine one.
#[tauri::command]
pub fn computer_get_default_workspace() -> Option<String> {
    default_user_workspace_directory().map(path_to_string)
}

/// Lists host drives or root folders for workspace selection.
#[tauri::command]
pub fn computer_list_drives() -> Vec<ComputerDrive> {
    list_system_roots()
}

/// Opens the native folder picker and returns the selected path.
#[tauri::command]
pub async fn computer_pick_folder(start_path: Option<String>) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || pick_folder_blocking(start_path))
        .await
        .map_err(|error| format!("The folder picker stopped unexpectedly: {}", error))?
}

fn pick_folder_blocking(start_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Choose a folder for Gilbert Codex");

    if let Some(start_path) = start_path {
        let start = normalize_input_path(&start_path);

        if start.is_dir() {
            dialog = dialog.set_directory(start);
        }
    }

    Ok(dialog.pick_folder().map(path_to_string))
}

/// Lists a single directory with a capped number of entries.
#[tauri::command]
pub fn computer_list_directory(
    request: ComputerDirectoryRequest,
) -> Result<ComputerDirectoryListing, String> {
    let path = normalize_input_path(&request.path);
    let limit = request
        .limit
        .unwrap_or(DEFAULT_DIRECTORY_LIMIT)
        .clamp(1, 2_000);
    let mut entries = Vec::new();
    let mut inaccessible_entries = 0usize;
    let mut limited = false;
    let read_dir = fs::read_dir(&path)
        .map_err(|error| format!("Could not open {}: {}", path_to_string(&path), error))?;

    for entry_result in read_dir {
        if entries.len() >= limit {
            limited = true;
            break;
        }

        match entry_result {
            Ok(entry) => match create_directory_entry(entry.path()) {
                Some(entry) => entries.push(entry),
                None => inaccessible_entries += 1,
            },
            Err(_) => inaccessible_entries += 1,
        }
    }

    entries.sort_by(|left, right| {
        let left_rank = kind_sort_rank(&left.kind);
        let right_rank = kind_sort_rank(&right.kind);
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    Ok(ComputerDirectoryListing {
        entries,
        inaccessible_entries,
        limited,
        parent_path: path.parent().map(path_to_string),
        path: path_to_string(&path),
    })
}

/// Builds a capped searchable file index and emits progress events.
#[tauri::command]
pub async fn computer_build_file_index(
    app: tauri::AppHandle,
    state: tauri::State<'_, ComputerFileIndexState>,
    request: ComputerIndexRequest,
) -> Result<ComputerFileIndexSummary, String> {
    let state = state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || build_file_index_blocking(app, state, request))
        .await
        .map_err(|error| format!("The file index worker stopped unexpectedly: {}", error))?
}

fn build_file_index_blocking(
    app: tauri::AppHandle,
    state: ComputerFileIndexState,
    request: ComputerIndexRequest,
) -> Result<ComputerFileIndexSummary, String> {
    let max_files = request
        .max_files
        .unwrap_or(DEFAULT_INDEX_LIMIT)
        .clamp(1, 100_000);
    let max_depth = request
        .max_depth
        .unwrap_or(DEFAULT_INDEX_DEPTH)
        .clamp(1, 128);
    let request_id = request.request_id.unwrap_or_else(now_millis);
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose at least one folder or drive before indexing.".to_string());
    }

    state.active_request_id.store(request_id, Ordering::SeqCst);

    let mut next_index = ComputerFileIndex {
        roots: roots.iter().map(path_to_string).collect(),
        ..ComputerFileIndex::default()
    };
    let mut queue: VecDeque<(PathBuf, usize)> =
        roots.into_iter().map(|root| (root, 0usize)).collect();
    let mut last_progress_emit = Instant::now();

    emit_file_index_progress(&app, request_id, &next_index, None, false);

    'scan: while let Some((directory, depth)) = queue.pop_front() {
        if state.active_request_id.load(Ordering::SeqCst) != request_id {
            return Err("Indexing was replaced by a newer request.".to_string());
        }

        next_index.scanned_directories += 1;

        let read_dir = match fs::read_dir(&directory) {
            Ok(read_dir) => read_dir,
            Err(_) => {
                next_index.skipped_entries += 1;
                continue;
            }
        };

        for entry_result in read_dir {
            if next_index.entries.len() >= max_files {
                next_index.truncated = true;
                break 'scan;
            }

            let entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    next_index.skipped_entries += 1;
                    continue;
                }
            };
            let path = entry.path();
            let metadata = match fs::symlink_metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    next_index.skipped_entries += 1;
                    continue;
                }
            };
            let kind = file_kind_from_metadata(&metadata);
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| path_to_string(&path));
            let extension = file_extension(&path);
            if should_skip_index_entry(&name, &kind) {
                next_index.skipped_entries += 1;
                continue;
            }

            let preview = if matches!(kind, ComputerFileKind::File)
                && should_index_text_preview(&path, metadata.len())
            {
                read_text_preview(&path, MAX_INDEX_PREVIEW_BYTES)
            } else {
                None
            };
            let embedding_text = format!(
                "{}\n{}\n{}\n{}",
                name,
                path_to_string(&path),
                extension.clone().unwrap_or_default(),
                preview.clone().unwrap_or_default()
            );

            if matches!(kind, ComputerFileKind::Directory) && depth < max_depth {
                queue.push_back((path.clone(), depth + 1));
            }

            next_index.entries.push(IndexedComputerFile {
                embedding: create_embedding(&embedding_text),
                extension,
                kind,
                modified_at: modified_millis(&metadata),
                name,
                path: path_to_string(&path),
                preview,
                size: if metadata.is_file() {
                    Some(metadata.len())
                } else {
                    None
                },
            });

            if should_emit_file_index_progress(&last_progress_emit, next_index.entries.len()) {
                emit_file_index_progress(
                    &app,
                    request_id,
                    &next_index,
                    Some(path_to_string(&path)),
                    false,
                );
                last_progress_emit = Instant::now();
            }
        }
    }

    next_index.built_at = Some(now_millis());
    let summary = next_index.summary();

    if state.active_request_id.load(Ordering::SeqCst) != request_id {
        return Err("Indexing was replaced by a newer request.".to_string());
    }

    let mut index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    *index = next_index;
    emit_file_index_progress_from_summary(&app, request_id, &summary, None, true);

    Ok(summary)
}

/// Returns the last completed file-index summary.
#[tauri::command]
pub fn computer_get_file_index_summary(
    state: tauri::State<'_, ComputerFileIndexState>,
) -> Result<ComputerFileIndexSummary, String> {
    let index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    Ok(index.summary())
}

/// Reads Git status signals for a workspace root.
#[tauri::command]
pub async fn computer_get_git_status(
    request: ComputerGitStatusRequest,
) -> Result<ComputerGitStatus, String> {
    tauri::async_runtime::spawn_blocking(move || get_git_status_blocking(request))
        .await
        .map_err(|error| format!("The Git status worker stopped unexpectedly: {}", error))?
}

/// Stages and commits local Git changes for a workspace root.
#[tauri::command]
pub async fn computer_git_commit(
    request: ComputerGitCommitRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_commit_blocking(request))
        .await
        .map_err(|error| format!("The Git commit worker stopped unexpectedly: {}", error))?
}

/// Creates and switches to a new local Git branch for a workspace root.
#[tauri::command]
pub async fn computer_git_create_branch(
    request: ComputerGitCreateBranchRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_create_branch_blocking(request))
        .await
        .map_err(|error| format!("The Git branch worker stopped unexpectedly: {}", error))?
}

/// Pushes the current local Git branch, setting upstream when needed.
#[tauri::command]
pub async fn computer_git_push(
    request: ComputerGitPushRequest,
) -> Result<ComputerGitActionResult, String> {
    tauri::async_runtime::spawn_blocking(move || git_push_blocking(request))
        .await
        .map_err(|error| format!("The Git push worker stopped unexpectedly: {}", error))?
}

fn get_git_status_blocking(request: ComputerGitStatusRequest) -> Result<ComputerGitStatus, String> {
    let path = normalize_input_path(&request.path);

    if !path.exists() {
        return Ok(create_unavailable_git_status(Some(format!(
            "{} does not exist.",
            path_to_string(&path)
        ))));
    }

    let repository_path = match find_git_repository_root(&path) {
        Some(root) => root,
        None => return Ok(create_unavailable_git_status(None)),
    };
    let head_sha = run_git(&repository_path, &["rev-parse", "--short", "HEAD"])
        .ok()
        .filter(|value| !value.is_empty());
    let branch = run_git(&repository_path, &["branch", "--show-current"])
        .ok()
        .filter(|value| !value.is_empty())
        .or_else(|| head_sha.as_ref().map(|sha| format!("detached {}", sha)));
    let upstream = run_git(
        &repository_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .filter(|value| !value.is_empty());
    let (behind, ahead) = if upstream.is_some() {
        get_git_ahead_behind(&repository_path).unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    let remote_url = run_git(&repository_path, &["remote", "get-url", "origin"])
        .ok()
        .filter(|value| !value.is_empty());
    let (github_owner, github_repo) = remote_url
        .as_deref()
        .and_then(parse_github_remote_url)
        .unwrap_or((None, None));
    let status_output = match run_git(&repository_path, &["status", "--porcelain=v1"]) {
        Ok(output) => output,
        Err(error) => return Ok(create_unavailable_git_status(Some(error))),
    };
    let changed_files = status_output
        .lines()
        .filter(|line| !line.trim().is_empty())
        .count();
    let tracked_stats = parse_git_numstat_entries(
        &run_git(&repository_path, &["diff", "--numstat", "HEAD"]).unwrap_or_default(),
    );
    let tracked_additions = tracked_stats
        .iter()
        .map(|(_path, additions, _deletions)| *additions)
        .sum::<usize>();
    let deletions = tracked_stats
        .iter()
        .map(|(_path, _additions, deletions)| *deletions)
        .sum::<usize>();
    let untracked_output = run_git(
        &repository_path,
        &["ls-files", "--others", "--exclude-standard", "-z"],
    )
    .unwrap_or_default();
    let untracked_additions_by_path =
        count_untracked_git_additions_by_path(&repository_path, &untracked_output);
    let untracked_additions = untracked_additions_by_path.values().sum::<usize>();
    let additions = tracked_additions + untracked_additions;
    let diff_previews = build_git_diff_previews(&repository_path, &status_output);
    let files = parse_git_changed_files(
        &status_output,
        &tracked_stats,
        &untracked_additions_by_path,
        &diff_previews,
    );
    let repository_root = path_to_string(&repository_path);

    Ok(ComputerGitStatus {
        additions,
        ahead,
        available: true,
        behind,
        branch,
        changed_files,
        clean: changed_files == 0,
        deletions,
        error: None,
        files,
        github_owner,
        github_repo,
        head_sha,
        remote_url,
        repository_root: Some(repository_root),
        upstream,
    })
}

fn git_commit_blocking(
    request: ComputerGitCommitRequest,
) -> Result<ComputerGitActionResult, String> {
    let message = request.message.trim().to_string();

    if message.is_empty() {
        return Err("Enter a commit message before committing.".to_string());
    }

    let repository_path = resolve_git_repository_path(&request.path)?;

    if request.stage_all.unwrap_or(true) {
        run_git(&repository_path, &["add", "-A"])?;
    }

    let output = run_git(&repository_path, &["commit", "-m", &message])?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitActionResult {
        message: "Committed local changes.".to_string(),
        output: optional_git_output(output),
        status,
    })
}

fn git_create_branch_blocking(
    request: ComputerGitCreateBranchRequest,
) -> Result<ComputerGitActionResult, String> {
    let branch_name = request.name.trim().to_string();
    let repository_path = resolve_git_repository_path(&request.path)?;

    validate_git_branch_name(&repository_path, &branch_name)?;

    let output = run_git(&repository_path, &["switch", "-c", &branch_name])?;
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitActionResult {
        message: format!("Created and switched to {}.", branch_name),
        output: optional_git_output(output),
        status,
    })
}

fn git_push_blocking(request: ComputerGitPushRequest) -> Result<ComputerGitActionResult, String> {
    let repository_path = resolve_git_repository_path(&request.path)?;
    let branch = run_git(&repository_path, &["branch", "--show-current"])?
        .trim()
        .to_string();

    if branch.is_empty() {
        return Err(
            "Cannot push while HEAD is detached. Create or switch to a branch first.".to_string(),
        );
    }

    let remote = request
        .remote
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("origin")
        .to_string();

    validate_git_remote_name(&remote)?;

    let upstream = run_git(
        &repository_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok()
    .filter(|value| !value.trim().is_empty());
    let output = if upstream.is_some() {
        run_git(&repository_path, &["push"])?
    } else {
        run_git(
            &repository_path,
            &["push", "--set-upstream", &remote, &branch],
        )?
    };
    let status = get_git_status_blocking(ComputerGitStatusRequest {
        path: path_to_string(&repository_path),
    })?;

    Ok(ComputerGitActionResult {
        message: format!("Pushed {}.", branch),
        output: optional_git_output(output),
        status,
    })
}

/// Searches the active file index using path, preview text, and local embeddings.
#[tauri::command]
pub fn computer_search_file_index(
    state: tauri::State<'_, ComputerFileIndexState>,
    request: ComputerSearchRequest,
) -> Result<Vec<ComputerSearchResult>, String> {
    let query = request.query.trim();

    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = request.limit.unwrap_or(24).clamp(1, 100);
    let query_embedding = create_embedding(query);
    let query_lower = query.to_lowercase();
    let query_tokens = tokenize_search_query(query);
    let index = state
        .index
        .lock()
        .map_err(|_| "The file index is busy. Try again in a moment.".to_string())?;
    let mut results = index
        .entries
        .iter()
        .filter_map(|entry| {
            let scored = score_entry(entry, &query_embedding, &query_lower, &query_tokens);

            if scored.score <= 0.0 {
                return None;
            }

            Some(ComputerSearchResult {
                extension: entry.extension.clone(),
                kind: entry.kind.clone(),
                line: scored.line,
                match_kind: scored.match_kind,
                matches: scored.matches,
                modified_at: entry.modified_at,
                name: entry.name.clone(),
                path: entry.path.clone(),
                preview: scored.preview.or_else(|| entry.preview.clone()),
                score: scored.score,
                size: entry.size,
            })
        })
        .collect::<Vec<_>>();

    results.sort_by(|left, right| right.score.total_cmp(&left.score));
    results.truncate(limit);

    Ok(results)
}

/// Reads one text file with a byte cap to keep UI/tool results responsive.
#[tauri::command]
pub fn computer_read_text_file(
    request: ComputerReadFileRequest,
) -> Result<ComputerReadFileResult, String> {
    let path = normalize_input_path(&request.path);
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;

    if !metadata.is_file() {
        return Err("Choose a text file, not a folder.".to_string());
    }

    let max_bytes = request
        .max_bytes
        .unwrap_or(MAX_PREVIEW_BYTES)
        .clamp(1, MAX_READ_FILE_BYTES);
    let mut file = File::open(&path)
        .map_err(|error| format!("Could not open {}: {}", path_to_string(&path), error))?;
    let mut buffer = vec![0u8; max_bytes.saturating_add(1)];
    let bytes_read = file
        .read(&mut buffer)
        .map_err(|error| format!("Could not read {}: {}", path_to_string(&path), error))?;
    let truncated = bytes_read > max_bytes || metadata.len() > max_bytes as u64;
    buffer.truncate(bytes_read.min(max_bytes));

    if buffer.iter().any(|byte| *byte == 0) {
        return Err("This file looks binary, so Gilbert did not load it as text.".to_string());
    }

    Ok(ComputerReadFileResult {
        content: String::from_utf8_lossy(&buffer).to_string(),
        extension: file_extension(&path),
        modified_at: modified_millis(&metadata),
        name: path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(&path)),
        path: path_to_string(&path),
        size: metadata.len(),
        truncated,
    })
}

/// Writes one text file after checking it stays inside enabled roots.
#[tauri::command]
pub fn computer_write_text_file(
    request: ComputerWriteFileRequest,
) -> Result<ComputerWriteFileResult, String> {
    let path = normalize_input_path(&request.path);
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before writing files.".to_string());
    }

    if has_parent_dir_component(&path) {
        return Err("Refusing to write through a path that contains '..'.".to_string());
    }

    if !path_is_inside_roots(&path, &roots) {
        return Err(
            "Writes are only allowed inside the selected or current workspace folder.".to_string(),
        );
    }

    let created = !path.exists();

    if !created {
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

        if !metadata.is_file() {
            return Err("Choose a file path, not a folder.".to_string());
        }

        if request.overwrite == Some(false) {
            return Err("That file already exists and overwrite is disabled.".to_string());
        }
    }

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if request.create_parent_dirs.unwrap_or(false) {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Could not create {}: {}", path_to_string(parent), error)
                })?;
            } else {
                return Err(format!(
                    "Parent folder does not exist: {}",
                    path_to_string(parent)
                ));
            }
        }
    }

    fs::write(&path, request.content.as_bytes())
        .map_err(|error| format!("Could not write {}: {}", path_to_string(&path), error))?;

    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "Could not inspect written file {}: {}",
            path_to_string(&path),
            error
        )
    })?;

    Ok(ComputerWriteFileResult {
        bytes_written: request.content.len(),
        created,
        modified_at: modified_millis(&metadata),
        path: path_to_string(&path),
    })
}

/// Deletes one file after checking it stays inside enabled roots.
#[tauri::command]
pub fn computer_delete_file(
    request: ComputerDeleteFileRequest,
) -> Result<ComputerDeleteFileResult, String> {
    let path = normalize_input_path(&request.path);
    let roots = normalize_roots(request.roots);

    if roots.is_empty() {
        return Err("Choose a folder workspace before deleting files.".to_string());
    }

    if has_parent_dir_component(&path) {
        return Err("Refusing to delete through a path that contains '..'.".to_string());
    }

    if !path_is_inside_roots(&path, &roots) {
        return Err(
            "Deletes are only allowed inside the selected or current workspace folder.".to_string(),
        );
    }

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Could not inspect {}: {}", path_to_string(&path), error))?;

    if !metadata.is_file() {
        return Err("delete_file only removes files, not folders.".to_string());
    }

    let bytes_deleted = metadata.len();

    fs::remove_file(&path)
        .map_err(|error| format!("Could not delete {}: {}", path_to_string(&path), error))?;

    Ok(ComputerDeleteFileResult {
        bytes_deleted,
        deleted: true,
        path: path_to_string(&path),
    })
}

impl ComputerFileIndex {
    fn summary(&self) -> ComputerFileIndexSummary {
        ComputerFileIndexSummary {
            built_at: self.built_at,
            entry_count: self.entries.len(),
            roots: self.roots.clone(),
            scanned_directories: self.scanned_directories,
            skipped_entries: self.skipped_entries,
            truncated: self.truncated,
        }
    }
}

fn should_emit_file_index_progress(last_emit: &Instant, entry_count: usize) -> bool {
    entry_count % INDEX_PROGRESS_ENTRY_INTERVAL == 0
        || last_emit.elapsed() >= Duration::from_millis(INDEX_PROGRESS_INTERVAL_MS)
}

fn emit_file_index_progress(
    app: &tauri::AppHandle,
    request_id: u64,
    index: &ComputerFileIndex,
    current_path: Option<String>,
    done: bool,
) {
    emit_file_index_progress_from_summary(app, request_id, &index.summary(), current_path, done);
}

fn emit_file_index_progress_from_summary(
    app: &tauri::AppHandle,
    request_id: u64,
    summary: &ComputerFileIndexSummary,
    current_path: Option<String>,
    done: bool,
) {
    let progress = ComputerFileIndexProgress {
        current_path,
        done,
        entry_count: summary.entry_count,
        request_id,
        roots: summary.roots.clone(),
        scanned_directories: summary.scanned_directories,
        skipped_entries: summary.skipped_entries,
        truncated: summary.truncated,
    };

    let _ = app.emit(INDEX_PROGRESS_EVENT, progress);
}

fn list_system_roots() -> Vec<ComputerDrive> {
    #[cfg(windows)]
    {
        let mut drives = Vec::new();

        for letter in b'A'..=b'Z' {
            let name = format!("{}:", letter as char);
            let path = format!("{}\\", name);
            let root = Path::new(&path);

            if root.exists() {
                drives.push(ComputerDrive {
                    available: fs::read_dir(root).is_ok(),
                    kind: "drive".to_string(),
                    label: format!("{} drive", name),
                    name,
                    path,
                });
            }
        }

        return drives;
    }

    #[cfg(not(windows))]
    {
        let mut roots = vec![ComputerDrive {
            available: fs::read_dir("/").is_ok(),
            kind: "root".to_string(),
            label: "Filesystem root".to_string(),
            name: "/".to_string(),
            path: "/".to_string(),
        }];

        if let Some(home) = std::env::var_os("HOME") {
            let home_path = PathBuf::from(home);

            if home_path.exists() {
                roots.push(ComputerDrive {
                    available: fs::read_dir(&home_path).is_ok(),
                    kind: "home".to_string(),
                    label: "Home".to_string(),
                    name: "Home".to_string(),
                    path: path_to_string(&home_path),
                });
            }
        }

        roots
    }
}

fn default_user_workspace_directory() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)?;
    let documents = home.join("Documents");

    if documents.is_dir() {
        return Some(documents);
    }

    if home.is_dir() {
        return Some(home);
    }

    std::env::current_dir().ok()
}

fn normalize_roots(roots: Vec<String>) -> Vec<PathBuf> {
    roots
        .into_iter()
        .map(|root| normalize_input_path(&root))
        .filter(|root| root.exists())
        .collect()
}

fn normalize_input_path(path: &str) -> PathBuf {
    let trimmed = path.trim();

    #[cfg(windows)]
    {
        if trimmed.len() == 2 && trimmed.ends_with(':') {
            return PathBuf::from(format!("{}\\", trimmed));
        }
    }

    PathBuf::from(trimmed)
}

fn has_parent_dir_component(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
}

fn path_is_inside_roots(path: &Path, roots: &[PathBuf]) -> bool {
    let compare_path = existing_path_for_compare(path);

    roots.iter().any(|root| {
        let compare_root = existing_path_for_compare(root);
        compare_path.starts_with(compare_root)
    })
}

fn existing_path_for_compare(path: &Path) -> PathBuf {
    if let Ok(canonical) = fs::canonicalize(path) {
        return canonical;
    }

    let mut current = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    };

    loop {
        if let Ok(canonical) = fs::canonicalize(&current) {
            return canonical;
        }

        if !current.pop() {
            break;
        }
    }

    path.to_path_buf()
}

fn create_directory_entry(path: PathBuf) -> Option<ComputerDirectoryEntry> {
    let metadata = fs::symlink_metadata(&path).ok()?;
    let name = path.file_name()?.to_string_lossy().to_string();
    let kind = file_kind_from_metadata(&metadata);

    Some(ComputerDirectoryEntry {
        extension: file_extension(&path),
        kind,
        modified_at: modified_millis(&metadata),
        name,
        path: path_to_string(&path),
        size: if metadata.is_file() {
            Some(metadata.len())
        } else {
            None
        },
    })
}

fn file_kind_from_metadata(metadata: &fs::Metadata) -> ComputerFileKind {
    let file_type = metadata.file_type();

    if file_type.is_symlink() {
        ComputerFileKind::Symlink
    } else if metadata.is_dir() {
        ComputerFileKind::Directory
    } else if metadata.is_file() {
        ComputerFileKind::File
    } else {
        ComputerFileKind::Other
    }
}

fn kind_sort_rank(kind: &ComputerFileKind) -> u8 {
    match kind {
        ComputerFileKind::Directory => 0,
        ComputerFileKind::File => 1,
        ComputerFileKind::Symlink => 2,
        ComputerFileKind::Other => 3,
    }
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
        .filter(|extension| !extension.is_empty())
}

fn should_skip_index_entry(name: &str, kind: &ComputerFileKind) -> bool {
    if !matches!(kind, ComputerFileKind::Directory) {
        return false;
    }

    let normalized_name = name.to_ascii_lowercase();
    SKIPPED_INDEX_DIRECTORY_NAMES
        .iter()
        .any(|skipped_name| *skipped_name == normalized_name)
}

fn should_index_text_preview(path: &Path, size: u64) -> bool {
    if size > MAX_TEXT_INDEX_FILE_BYTES {
        return false;
    }

    matches!(
        file_extension(path).as_deref(),
        Some(
            "bat"
                | "astro"
                | "c"
                | "cmd"
                | "cpp"
                | "cs"
                | "css"
                | "csv"
                | "dart"
                | "go"
                | "graphql"
                | "gradle"
                | "h"
                | "html"
                | "java"
                | "js"
                | "json"
                | "jsx"
                | "kt"
                | "kts"
                | "log"
                | "lua"
                | "md"
                | "ps1"
                | "php"
                | "py"
                | "rb"
                | "rs"
                | "scss"
                | "sh"
                | "sql"
                | "svelte"
                | "swift"
                | "toml"
                | "ts"
                | "tsx"
                | "vue"
                | "txt"
                | "xml"
                | "yaml"
                | "yml"
        )
    )
}

fn read_text_preview(path: &Path, max_bytes: usize) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let mut buffer = vec![0u8; max_bytes];
    let bytes_read = file.read(&mut buffer).ok()?;
    buffer.truncate(bytes_read);

    if buffer.iter().any(|byte| *byte == 0) {
        return None;
    }

    let preview = String::from_utf8_lossy(&buffer)
        .lines()
        .take(32)
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = preview.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn create_embedding(text: &str) -> Vec<f32> {
    let mut vector = vec![0f32; EMBEDDING_DIMS];
    let mut token = String::new();

    for character in text.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            token.push(character.to_ascii_lowercase());
        } else {
            push_embedding_token(&mut vector, &token);
            token.clear();
        }
    }

    push_embedding_token(&mut vector, &token);
    normalize_vector(&mut vector);
    vector
}

fn push_embedding_token(vector: &mut [f32], token: &str) {
    if token.len() < 2 {
        return;
    }

    let mut hasher = DefaultHasher::new();
    token.hash(&mut hasher);
    let hash = hasher.finish();
    let index = (hash as usize) % vector.len();
    let weight = if token.len() > 18 { 1.35 } else { 1.0 };
    vector[index] += weight;
}

fn normalize_vector(vector: &mut [f32]) {
    let length = vector.iter().map(|value| value * value).sum::<f32>().sqrt();

    if length <= f32::EPSILON {
        return;
    }

    for value in vector {
        *value /= length;
    }
}

#[derive(Debug)]
struct SearchScore {
    line: Option<usize>,
    match_kind: String,
    matches: Vec<String>,
    preview: Option<String>,
    score: f32,
}

fn tokenize_search_query(value: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for character in value.chars() {
        if character.is_alphanumeric() || character == '_' || character == '-' {
            current.push(character.to_ascii_lowercase());
        } else {
            push_search_token(&mut tokens, &current);
            current.clear();
        }
    }

    push_search_token(&mut tokens, &current);
    tokens
}

fn push_search_token(tokens: &mut Vec<String>, token: &str) {
    let cleaned = token.trim_matches(|character: char| character == '_' || character == '-');

    if cleaned.len() < 2 {
        return;
    }

    if !tokens.iter().any(|existing| existing == cleaned) {
        tokens.push(cleaned.to_string());
    }

    for part in cleaned.split(['_', '-']) {
        if part.len() > 1 && !tokens.iter().any(|existing| existing == part) {
            tokens.push(part.to_string());
        }
    }
}

fn score_entry(
    entry: &IndexedComputerFile,
    query_embedding: &[f32],
    query_lower: &str,
    query_tokens: &[String],
) -> SearchScore {
    let semantic_score = entry
        .embedding
        .iter()
        .zip(query_embedding)
        .map(|(left, right)| left * right)
        .sum::<f32>();
    let path_lower = entry.path.to_lowercase();
    let name_lower = entry.name.to_lowercase();
    let extension_lower = entry.extension.clone().unwrap_or_default();
    let preview_lower = entry.preview.as_deref().unwrap_or_default().to_lowercase();
    let mut matches = Vec::new();
    let mut name_score = 0f32;
    let mut path_score = 0f32;
    let mut content_score = 0f32;

    if !query_lower.is_empty() && name_lower == query_lower {
        name_score += 8.0;
        push_match(&mut matches, query_lower);
    } else if !query_lower.is_empty() && name_lower.contains(query_lower) {
        name_score += 5.0;
        push_match(&mut matches, query_lower);
    }

    if !query_lower.is_empty() && path_lower.contains(query_lower) {
        path_score += 2.5;
        push_match(&mut matches, query_lower);
    }

    if !query_lower.is_empty() && preview_lower.contains(query_lower) {
        content_score += 1.4;
        push_match(&mut matches, query_lower);
    }

    for token in query_tokens {
        if name_lower.contains(token) {
            name_score += 1.6;
            push_match(&mut matches, token);
        }

        if path_lower.contains(token) {
            path_score += 0.85;
            push_match(&mut matches, token);
        }

        if extension_lower == *token {
            path_score += 0.45;
            push_match(&mut matches, token);
        }

        if preview_lower.contains(token) {
            content_score += 0.35;
            push_match(&mut matches, token);
        }
    }

    let snippet = find_preview_snippet(
        entry.preview.as_deref().unwrap_or_default(),
        query_lower,
        query_tokens,
    );

    if snippet.preview.is_some() {
        content_score += 0.8;
        for item in &snippet.matches {
            push_match(&mut matches, item);
        }
    }

    let strongest_lexical = name_score.max(path_score).max(content_score);
    let match_kind = if name_score > 0.0 && name_score >= path_score && name_score >= content_score
    {
        "name"
    } else if path_score > 0.0 && path_score >= content_score {
        "path"
    } else if content_score > 0.0 {
        "content"
    } else if semantic_score > 0.0 {
        "semantic"
    } else {
        "semantic"
    };

    SearchScore {
        line: snippet.line,
        match_kind: match_kind.to_string(),
        matches,
        preview: snippet.preview,
        score: strongest_lexical
            + content_score / query_tokens.len().max(1) as f32
            + semantic_score * 0.75,
    }
}

#[derive(Default)]
struct SearchSnippet {
    line: Option<usize>,
    matches: Vec<String>,
    preview: Option<String>,
}

fn find_preview_snippet(
    content: &str,
    query_lower: &str,
    query_tokens: &[String],
) -> SearchSnippet {
    if content.is_empty() {
        return SearchSnippet::default();
    }

    for (index, line) in content.lines().enumerate() {
        let line_lower = line.to_lowercase();
        let mut matches = Vec::new();

        if !query_lower.is_empty() && line_lower.contains(query_lower) {
            push_match(&mut matches, query_lower);
        }

        for token in query_tokens {
            if line_lower.contains(token) {
                push_match(&mut matches, token);
            }
        }

        if !matches.is_empty() {
            return SearchSnippet {
                line: Some(index + 1),
                matches,
                preview: Some(trim_search_preview(line)),
            };
        }
    }

    SearchSnippet::default()
}

fn trim_search_preview(line: &str) -> String {
    let trimmed = line.trim();

    if trimmed.chars().count() <= 420 {
        return trimmed.to_string();
    }

    trimmed.chars().take(420).collect()
}

fn push_match(matches: &mut Vec<String>, value: &str) {
    let cleaned = value.trim().to_ascii_lowercase();

    if cleaned.is_empty() || matches.len() >= 10 || matches.iter().any(|item| item == &cleaned) {
        return;
    }

    matches.push(cleaned);
}

fn modified_millis(metadata: &fs::Metadata) -> Option<u64> {
    metadata.modified().ok().and_then(system_time_millis)
}

fn now_millis() -> u64 {
    system_time_millis(SystemTime::now()).unwrap_or_default()
}

fn system_time_millis(time: SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
}

fn create_unavailable_git_status(error: Option<String>) -> ComputerGitStatus {
    ComputerGitStatus {
        additions: 0,
        ahead: 0,
        available: false,
        behind: 0,
        branch: None,
        changed_files: 0,
        clean: true,
        deletions: 0,
        error,
        files: Vec::new(),
        github_owner: None,
        github_repo: None,
        head_sha: None,
        remote_url: None,
        repository_root: None,
        upstream: None,
    }
}

fn resolve_git_repository_path(input_path: &str) -> Result<PathBuf, String> {
    let path = normalize_input_path(input_path);

    if !path.exists() {
        return Err(format!("{} does not exist.", path_to_string(&path)));
    }

    find_git_repository_root(&path)
        .ok_or_else(|| "This folder is not inside a Git repository.".to_string())
}

fn find_git_repository_root(path: &Path) -> Option<PathBuf> {
    let mut current = if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()?.to_path_buf()
    };

    loop {
        if current.join(".git").exists() {
            return Some(current);
        }

        if !current.pop() {
            return None;
        }
    }
}

fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|error| format!("Could not run git: {}", error))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };

        return Err(if detail.is_empty() {
            "Git did not return status for this folder.".to_string()
        } else {
            detail
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn validate_git_branch_name(repository_path: &Path, branch_name: &str) -> Result<(), String> {
    if branch_name.is_empty() {
        return Err("Enter a branch name before creating a branch.".to_string());
    }

    if branch_name.starts_with('-')
        || branch_name
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("Branch names cannot start with '-' or contain whitespace.".to_string());
    }

    run_git(
        repository_path,
        &["check-ref-format", "--branch", branch_name],
    )
    .map(|_| ())
    .map_err(|_| "Enter a valid Git branch name.".to_string())
}

fn validate_git_remote_name(remote: &str) -> Result<(), String> {
    if remote.is_empty()
        || remote.starts_with('-')
        || remote
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("Enter a valid Git remote name.".to_string());
    }

    Ok(())
}

fn optional_git_output(output: String) -> Option<String> {
    let trimmed = output.trim();

    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Clone)]
struct GitDiffPreview {
    lines: Vec<ComputerGitDiffLine>,
    truncated: bool,
}

fn get_git_ahead_behind(repository_path: &Path) -> Option<(usize, usize)> {
    let output = run_git(
        repository_path,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    )
    .ok()?;
    let mut parts = output.split_whitespace();
    let behind = parts.next()?.parse::<usize>().ok()?;
    let ahead = parts.next()?.parse::<usize>().ok()?;

    Some((behind, ahead))
}

fn build_git_diff_previews(
    repository_path: &Path,
    status_output: &str,
) -> HashMap<String, GitDiffPreview> {
    let diff_output = run_git(
        repository_path,
        &[
            "diff",
            "--unified=4",
            "--no-ext-diff",
            "--no-color",
            "HEAD",
            "--",
        ],
    )
    .unwrap_or_default();
    let mut previews = parse_tracked_git_diff_previews(&diff_output);

    for line in status_output.lines() {
        if previews.len() >= MAX_GIT_DIFF_PREVIEW_FILES {
            break;
        }

        let trimmed = line.trim_end();

        if trimmed.len() < 4 {
            continue;
        }

        let Some(status) = trimmed.get(0..2).map(str::trim) else {
            continue;
        };

        if status != "??" {
            continue;
        }

        let Some(raw_path) = trimmed.get(3..).map(str::trim) else {
            continue;
        };
        let (_old_path, path) = split_git_status_path(raw_path);
        let key = git_status_path_key(&path);

        if previews.contains_key(&key) {
            continue;
        }

        if let Some(preview) = create_untracked_git_diff_preview(repository_path, &path) {
            previews.insert(key, preview);
        }
    }

    previews
}

fn parse_tracked_git_diff_previews(output: &str) -> HashMap<String, GitDiffPreview> {
    let mut previews = HashMap::<String, GitDiffPreview>::new();
    let mut current_key: Option<String> = None;
    let mut pending_old_path: Option<String> = None;
    let mut old_line = 0usize;
    let mut new_line = 0usize;

    for line in output.lines() {
        if line.starts_with("diff --git ") {
            if previews.len() >= MAX_GIT_DIFF_PREVIEW_FILES {
                break;
            }

            current_key = None;
            pending_old_path = None;
            old_line = 0;
            new_line = 0;
            continue;
        }

        if let Some(raw_path) = line.strip_prefix("--- ") {
            pending_old_path = parse_git_diff_marker_path(raw_path);
            continue;
        }

        if let Some(raw_path) = line.strip_prefix("+++ ") {
            let path = parse_git_diff_marker_path(raw_path).or_else(|| pending_old_path.clone());

            if let Some(path) = path {
                let key = git_status_path_key(&path);
                previews
                    .entry(key.clone())
                    .or_insert_with(|| GitDiffPreview {
                        lines: Vec::new(),
                        truncated: false,
                    });
                current_key = Some(key);
            }

            continue;
        }

        let Some(key) = current_key.as_ref() else {
            continue;
        };

        if line.starts_with("@@") {
            if let Some((next_old_line, next_new_line)) = parse_git_diff_hunk_header(line) {
                old_line = next_old_line;
                new_line = next_new_line;
            }

            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(line),
                    kind: "hunk".to_string(),
                    new_line: None,
                    old_line: None,
                },
            );
            continue;
        }

        if line.starts_with("\\ ") {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(line),
                    kind: "meta".to_string(),
                    new_line: None,
                    old_line: None,
                },
            );
            continue;
        }

        if let Some(content) = line.strip_prefix('+') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "add".to_string(),
                    new_line: Some(new_line),
                    old_line: None,
                },
            );
            new_line = new_line.saturating_add(1);
            continue;
        }

        if let Some(content) = line.strip_prefix('-') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "remove".to_string(),
                    new_line: None,
                    old_line: Some(old_line),
                },
            );
            old_line = old_line.saturating_add(1);
            continue;
        }

        if let Some(content) = line.strip_prefix(' ') {
            push_git_diff_preview_line(
                &mut previews,
                key,
                ComputerGitDiffLine {
                    content: truncate_git_diff_line(content),
                    kind: "context".to_string(),
                    new_line: Some(new_line),
                    old_line: Some(old_line),
                },
            );
            old_line = old_line.saturating_add(1);
            new_line = new_line.saturating_add(1);
        }
    }

    previews
}

fn create_untracked_git_diff_preview(
    repository_path: &Path,
    relative_path: &str,
) -> Option<GitDiffPreview> {
    let path = repository_path.join(relative_path);
    let metadata = fs::metadata(&path).ok()?;

    if !metadata.is_file() || metadata.len() > MAX_GIT_UNTRACKED_DIFF_BYTES {
        return None;
    }

    let bytes = fs::read(&path).ok()?;

    if bytes.is_empty() || bytes.contains(&0) {
        return None;
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    let truncated = false;

    for (index, line) in text.lines().enumerate() {
        lines.push(ComputerGitDiffLine {
            content: truncate_git_diff_line(line),
            kind: "add".to_string(),
            new_line: Some(index + 1),
            old_line: None,
        });
    }

    if lines.is_empty() {
        None
    } else {
        Some(GitDiffPreview { lines, truncated })
    }
}

fn push_git_diff_preview_line(
    previews: &mut HashMap<String, GitDiffPreview>,
    key: &str,
    line: ComputerGitDiffLine,
) {
    let Some(preview) = previews.get_mut(key) else {
        return;
    };

    preview.lines.push(line);
}

fn parse_git_diff_marker_path(raw_path: &str) -> Option<String> {
    let cleaned = clean_git_path(raw_path);

    if cleaned == "/dev/null" {
        return None;
    }

    if let Some(path) = cleaned.strip_prefix("a/") {
        Some(path.to_string())
    } else if let Some(path) = cleaned.strip_prefix("b/") {
        Some(path.to_string())
    } else {
        Some(cleaned)
    }
}

fn parse_git_diff_hunk_header(line: &str) -> Option<(usize, usize)> {
    let mut parts = line.split_whitespace();
    parts.next()?;
    let old_part = parts.next()?;
    let new_part = parts.next()?;

    Some((
        parse_git_diff_hunk_start(old_part)?,
        parse_git_diff_hunk_start(new_part)?,
    ))
}

fn parse_git_diff_hunk_start(part: &str) -> Option<usize> {
    part.trim_start_matches(|character| character == '-' || character == '+')
        .split(',')
        .next()?
        .parse::<usize>()
        .ok()
}

fn truncate_git_diff_line(line: &str) -> String {
    line.to_string()
}

fn parse_git_numstat_entries(output: &str) -> Vec<(String, usize, usize)> {
    output
        .lines()
        .filter_map(|line| {
            let mut columns = line.split('\t');
            let additions = columns.next()?.parse::<usize>().unwrap_or(0);
            let deletions = columns.next()?.parse::<usize>().unwrap_or(0);
            let path = columns.next()?.trim();

            if path.is_empty() {
                None
            } else {
                Some((clean_git_path(path), additions, deletions))
            }
        })
        .collect()
}

fn count_untracked_git_additions_by_path(
    repository_path: &Path,
    output: &str,
) -> HashMap<String, usize> {
    output
        .split('\0')
        .filter(|path| !path.trim().is_empty())
        .take(MAX_GIT_UNTRACKED_FILES_FOR_STATS)
        .map(|path| {
            (
                git_status_path_key(path),
                count_text_file_lines(&repository_path.join(path)),
            )
        })
        .collect()
}

fn parse_git_changed_files(
    status_output: &str,
    tracked_stats: &[(String, usize, usize)],
    untracked_additions_by_path: &HashMap<String, usize>,
    diff_previews: &HashMap<String, GitDiffPreview>,
) -> Vec<ComputerGitChangedFile> {
    let tracked_stats_by_path = tracked_stats
        .iter()
        .map(|(path, additions, deletions)| (git_status_path_key(path), (*additions, *deletions)))
        .collect::<HashMap<_, _>>();

    status_output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_end();

            if trimmed.len() < 4 {
                return None;
            }

            let status = trimmed.get(0..2)?.trim().to_string();
            let raw_path = trimmed.get(3..)?.trim();
            let (old_path, path) = split_git_status_path(raw_path);
            let key = git_status_path_key(&path);
            let (additions, deletions) = if status == "??" {
                (*untracked_additions_by_path.get(&key).unwrap_or(&0), 0)
            } else {
                tracked_stats_by_path.get(&key).copied().unwrap_or((0, 0))
            };
            let diff_preview = diff_previews.get(&key);

            Some(ComputerGitChangedFile {
                additions,
                deletions,
                diff_preview: diff_preview.map(|preview| preview.lines.clone()),
                diff_truncated: diff_preview
                    .map(|preview| preview.truncated)
                    .unwrap_or(false),
                old_path,
                path,
                status,
            })
        })
        .collect()
}

fn split_git_status_path(raw_path: &str) -> (Option<String>, String) {
    if let Some((old_path, path)) = raw_path.split_once(" -> ") {
        return (Some(clean_git_path(old_path)), clean_git_path(path));
    }

    (None, clean_git_path(raw_path))
}

fn clean_git_path(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace("\\\"", "\"")
        .replace("\\\\", "\\")
}

fn git_status_path_key(path: &str) -> String {
    clean_git_path(path).replace('\\', "/")
}

fn count_text_file_lines(path: &Path) -> usize {
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };

    if !metadata.is_file() || metadata.len() > MAX_GIT_UNTRACKED_FILE_BYTES {
        return 0;
    }

    let Ok(bytes) = fs::read(path) else {
        return 0;
    };

    if bytes.is_empty() || bytes.contains(&0) {
        return 0;
    }

    let newline_count = bytes.iter().filter(|byte| **byte == b'\n').count();

    if bytes.ends_with(b"\n") {
        newline_count
    } else {
        newline_count + 1
    }
}

fn parse_github_remote_url(remote_url: &str) -> Option<(Option<String>, Option<String>)> {
    let trimmed = remote_url.trim().trim_end_matches(".git");
    let path = if let Some(rest) = trimmed.strip_prefix("https://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("http://github.com/") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("ssh://git@github.com/") {
        rest
    } else {
        return None;
    };
    let mut parts = path.split('/');
    let owner = parts
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let repo = parts
        .next()
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    if owner.is_none() || repo.is_none() {
        return None;
    }

    Some((owner, repo))
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}
