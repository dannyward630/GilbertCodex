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

#[cfg(not(target_os = "windows"))]
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
