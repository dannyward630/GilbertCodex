use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(not(windows))]
use std::ffi::OsString;

pub fn configure_native_path(command: &mut Command) -> &mut Command {
    #[cfg(not(windows))]
    command.env("PATH", native_runtime_path());

    command
}

pub fn resolve_native_executable(program: &str) -> PathBuf {
    let path = Path::new(program);
    if path.is_absolute() || path.components().count() > 1 {
        return expand_home_path(path.to_path_buf());
    }

    find_native_executable(program).unwrap_or_else(|| PathBuf::from(program))
}

pub fn native_runtime_path_dirs() -> Vec<PathBuf> {
    native_runtime_path_dirs_for_home(home_dir_for_path_expansion())
}

pub fn native_runtime_path_dirs_for_home(home: Option<PathBuf>) -> Vec<PathBuf> {
    let dirs: Vec<PathBuf> = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect())
        .unwrap_or_default();

    #[cfg(windows)]
    {
        let _ = home;
        return dedupe_paths(dirs);
    }

    #[cfg(target_os = "macos")]
    {
        let mut dirs = dirs;
        dirs.extend(common_macos_runtime_dirs(home));
        return dedupe_paths(dirs);
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        let mut dirs = dirs;
        dirs.extend(common_linux_runtime_dirs(home));
        return dedupe_paths(dirs);
    }
}

pub fn expand_home_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    let Some(home) = home_dir_for_path_expansion() else {
        return path;
    };

    if value == "~" {
        return home;
    }

    if let Some(rest) = value
        .strip_prefix("~/")
        .or_else(|| value.strip_prefix("~\\"))
    {
        return home.join(rest);
    }

    path
}

#[cfg(not(windows))]
fn native_runtime_path() -> OsString {
    env::join_paths(native_runtime_path_dirs())
        .unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default())
}

fn find_native_executable(program: &str) -> Option<PathBuf> {
    native_runtime_path_dirs()
        .into_iter()
        .map(|dir| dir.join(program))
        .find(|candidate| is_executable_file(candidate))
}

fn is_executable_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;

        return path
            .metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false);
    }

    #[cfg(windows)]
    {
        true
    }
}

fn home_dir_for_path_expansion() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();

    for path in paths {
        if path.as_os_str().is_empty() || deduped.iter().any(|existing| existing == &path) {
            continue;
        }

        deduped.push(path);
    }

    deduped
}

#[cfg(any(test, not(windows)))]
fn common_unix_runtime_dirs(home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Some(home) = home {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("bin"));
        dirs.push(home.join(".cargo").join("bin"));
        dirs.push(home.join(".npm-global").join("bin"));
        dirs.push(home.join(".yarn").join("bin"));
        dirs.push(home.join(".volta").join("bin"));
        dirs.push(home.join(".asdf").join("shims"));
        dirs.push(home.join(".bun").join("bin"));
        dirs.push(
            home.join(".local")
                .join("share")
                .join("flatpak")
                .join("exports")
                .join("bin"),
        );
        dirs.extend(nvm_node_bin_dirs(&home));
    }

    dirs
}

#[cfg(any(test, target_os = "macos"))]
pub fn common_macos_runtime_dirs(home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = common_unix_runtime_dirs(home);

    dirs.push(PathBuf::from("/opt/homebrew/bin"));
    dirs.push(PathBuf::from("/opt/homebrew/sbin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/usr/local/sbin"));
    dirs.push(PathBuf::from("/opt/local/bin"));
    dirs.push(PathBuf::from(
        "/Applications/Docker.app/Contents/Resources/bin",
    ));
    dirs.push(PathBuf::from("/usr/bin"));
    dirs.push(PathBuf::from("/bin"));
    dirs.push(PathBuf::from("/usr/sbin"));
    dirs.push(PathBuf::from("/sbin"));

    dirs
}

#[cfg(any(test, all(not(windows), not(target_os = "macos"))))]
pub fn common_linux_runtime_dirs(home: Option<PathBuf>) -> Vec<PathBuf> {
    let mut dirs = common_unix_runtime_dirs(home);

    dirs.push(PathBuf::from("/usr/local/sbin"));
    dirs.push(PathBuf::from("/usr/local/bin"));
    dirs.push(PathBuf::from("/usr/sbin"));
    dirs.push(PathBuf::from("/usr/bin"));
    dirs.push(PathBuf::from("/sbin"));
    dirs.push(PathBuf::from("/bin"));
    dirs.push(PathBuf::from("/snap/bin"));
    dirs.push(PathBuf::from("/var/lib/flatpak/exports/bin"));

    dirs
}

#[cfg(any(test, not(windows)))]
fn nvm_node_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let versions_dir = home.join(".nvm").join("versions").join("node");
    let Ok(entries) = std::fs::read_dir(versions_dir) else {
        return Vec::new();
    };

    let mut dirs = entries
        .flatten()
        .map(|entry| entry.path().join("bin"))
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.reverse();
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn macos_runtime_dirs_cover_gui_app_tool_locations() {
        let home = PathBuf::from("/Users/gilbert");
        let dirs = common_macos_runtime_dirs(Some(home.clone()));

        assert!(dirs.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
        assert!(dirs.contains(&PathBuf::from(
            "/Applications/Docker.app/Contents/Resources/bin"
        )));
        assert!(dirs.contains(&home.join(".yarn").join("bin")));
        assert!(dirs.contains(&home.join(".volta").join("bin")));
        assert!(dirs.contains(&home.join(".asdf").join("shims")));
    }

    #[test]
    fn linux_runtime_dirs_cover_desktop_app_tool_locations() {
        let home = PathBuf::from("/home/gilbert");
        let dirs = common_linux_runtime_dirs(Some(home.clone()));

        assert!(dirs.contains(&PathBuf::from("/usr/local/bin")));
        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        assert!(dirs.contains(&PathBuf::from("/snap/bin")));
        assert!(dirs.contains(&home.join(".local").join("bin")));
        assert!(dirs.contains(
            &home
                .join(".local")
                .join("share")
                .join("flatpak")
                .join("exports")
                .join("bin")
        ));
    }

    #[test]
    fn runtime_dirs_include_installed_nvm_node_bins() {
        let home = env::temp_dir().join(format!(
            "gilbert-codex-native-path-nvm-{}",
            uuid::Uuid::new_v4()
        ));
        let node_20_bin = home
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v20.19.0")
            .join("bin");
        let node_24_bin = home
            .join(".nvm")
            .join("versions")
            .join("node")
            .join("v24.2.0")
            .join("bin");
        fs::create_dir_all(&node_20_bin).expect("create fake Node 20 nvm bin");
        fs::create_dir_all(&node_24_bin).expect("create fake Node 24 nvm bin");

        let mut dirs = common_macos_runtime_dirs(Some(home.clone()));
        dirs.extend(common_linux_runtime_dirs(Some(home.clone())));

        assert!(dirs.contains(&node_20_bin));
        assert!(dirs.contains(&node_24_bin));
        let _ = fs::remove_dir_all(home);
    }
}
