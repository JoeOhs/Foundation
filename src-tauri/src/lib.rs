use base64::Engine;

/// Read a file the user picked in the import dialog as text.
/// Decodes UTF-8 (with or without BOM) and falls back to Windows-1252 so
/// old text files don't fail the import.
#[tauri::command]
fn read_file_text(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    let (text, _, had_errors) = encoding_rs::UTF_8.decode(&bytes);
    if !had_errors {
        return Ok(text.into_owned());
    }
    let (text, _, _) = encoding_rs::WINDOWS_1252.decode(&bytes);
    Ok(text.into_owned())
}

/// Read a file as base64 — used for binary formats (e.g. legacy SQLite-based
/// files the user owns) that are parsed on the frontend.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![read_file_text, read_file_base64])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
