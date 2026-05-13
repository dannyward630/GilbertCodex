use std::{fs, path::Path};

pub fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

pub fn delete_legacy_file(path: impl AsRef<Path>, label: &str) -> Result<(), String> {
    delete_legacy_file_inner(path.as_ref(), label, false)
}

pub fn delete_legacy_file_and_empty_parent(
    path: impl AsRef<Path>,
    label: &str,
) -> Result<(), String> {
    delete_legacy_file_inner(path.as_ref(), label, true)
}

fn delete_legacy_file_inner(
    path: &Path,
    label: &str,
    remove_empty_parent: bool,
) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(path).map_err(|error| {
        format!(
            "Could not remove the old {label} at {}: {error}",
            path_to_string(path)
        )
    })?;

    if remove_empty_parent {
        if let Some(parent) = path.parent() {
            let is_empty = fs::read_dir(parent)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);

            if is_empty {
                let _ = fs::remove_dir(parent);
            }
        }
    }

    Ok(())
}
