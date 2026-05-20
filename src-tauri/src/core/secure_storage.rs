#[cfg(target_os = "windows")]
mod platform {
    use std::{mem::zeroed, ptr};
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE,
        CRED_TYPE_GENERIC,
    };

    pub fn set_secret(target: &str, value: &str) -> Result<(), String> {
        let mut target_wide = wide_null(target);
        let mut user_wide = wide_null("GilbertCodex");
        let mut blob = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target_wide.as_mut_ptr(),
            Comment: ptr::null_mut(),
            LastWritten: unsafe { zeroed() },
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: ptr::null_mut(),
            TargetAlias: ptr::null_mut(),
            UserName: user_wide.as_mut_ptr(),
        };

        let ok = unsafe { CredWriteW(&credential, 0) };
        if ok == 0 {
            return Err(format!(
                "Windows Credential Manager could not save secure secret `{target}`."
            ));
        }

        Ok(())
    }

    pub fn get_secret(target: &str) -> Result<Option<String>, String> {
        let target_wide = wide_null(target);
        let mut credential: *mut CREDENTIALW = ptr::null_mut();
        let ok = unsafe { CredReadW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };

        if ok == 0 {
            return Ok(None);
        }

        if credential.is_null() {
            return Ok(None);
        }

        let secret = unsafe {
            let credential_ref = &*credential;
            let bytes = std::slice::from_raw_parts(
                credential_ref.CredentialBlob,
                credential_ref.CredentialBlobSize as usize,
            );
            let secret = String::from_utf8(bytes.to_vec()).map_err(|error| {
                format!("Windows Credential Manager returned invalid UTF-8: {error}")
            })?;
            CredFree(credential as *const _);
            secret
        };

        Ok(Some(secret))
    }

    pub fn delete_secret(target: &str) -> Result<(), String> {
        let target_wide = wide_null(target);
        let _ = unsafe { CredDeleteW(target_wide.as_ptr(), CRED_TYPE_GENERIC, 0) };
        Ok(())
    }

    fn wide_null(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::{Command, Stdio};

    const ACCOUNT: &str = "GilbertCodex";

    pub fn set_secret(target: &str, value: &str) -> Result<(), String> {
        let status = Command::new("/usr/bin/security")
            .args([
                "add-generic-password",
                "-a",
                ACCOUNT,
                "-s",
                target,
                "-w",
                value,
                "-U",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .status()
            .map_err(|error| {
                format!("macOS Keychain could not save secure secret `{target}`: {error}")
            })?;

        if !status.success() {
            return Err(format!(
                "macOS Keychain could not save secure secret `{target}`."
            ));
        }

        Ok(())
    }

    pub fn get_secret(target: &str) -> Result<Option<String>, String> {
        let output = Command::new("/usr/bin/security")
            .args(["find-generic-password", "-a", ACCOUNT, "-s", target, "-w"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| {
                format!("macOS Keychain could not read secure secret `{target}`: {error}")
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
            if stderr.contains("could not be found") || output.status.code() == Some(44) {
                return Ok(None);
            }

            return Err(format!(
                "macOS Keychain could not read secure secret `{target}`."
            ));
        }

        let secret = String::from_utf8(output.stdout)
            .map_err(|error| format!("macOS Keychain returned invalid UTF-8: {error}"))?
            .trim_end_matches(&['\r', '\n'][..])
            .to_string();

        Ok(Some(secret))
    }

    pub fn delete_secret(target: &str) -> Result<(), String> {
        let output = Command::new("/usr/bin/security")
            .args(["delete-generic-password", "-a", ACCOUNT, "-s", target])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| {
                format!("macOS Keychain could not delete secure secret `{target}`: {error}")
            })?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).to_ascii_lowercase();
        if stderr.contains("could not be found") || output.status.code() == Some(44) {
            return Ok(());
        }

        Err(format!(
            "macOS Keychain could not delete secure secret `{target}`."
        ))
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    pub fn set_secret(target: &str, _value: &str) -> Result<(), String> {
        Err(format!(
            "OS-backed secure storage is not implemented for this platform yet: {target}"
        ))
    }

    pub fn get_secret(_target: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn delete_secret(_target: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn set_secret(target: &str, value: &str) -> Result<(), String> {
    validate_target(target)?;
    platform::set_secret(target, value)
}

pub fn get_secret(target: &str) -> Result<Option<String>, String> {
    validate_target(target)?;
    platform::get_secret(target)
}

pub fn delete_secret(target: &str) -> Result<(), String> {
    validate_target(target)?;
    platform::delete_secret(target)
}

fn validate_target(target: &str) -> Result<(), String> {
    let target = target.trim();
    if target.is_empty() || target.len() > 240 || target.contains('\0') {
        return Err("Secure storage target is invalid.".to_string());
    }

    Ok(())
}
