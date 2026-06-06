use std::fs;
use std::path::Path;

fn main() {
    sync_web_assets();
    tauri_build::build();
}

fn sync_web_assets() {
    let source = Path::new("../../assets");
    let destination = Path::new("../../web/assets");
    println!("cargo:rerun-if-changed={}", source.display());

    if !source.exists() {
        return;
    }

    if let Err(err) = copy_dir(source, destination) {
        panic!(
            "failed to sync {} to {}: {err}",
            source.display(),
            destination.display()
        );
    }
}

fn copy_dir(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        fs::remove_dir_all(destination)?;
    }
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = destination.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            // Dev-only atlases stay in source; only the shipped mirror is slim.
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            let extension = from.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if file_name.contains("_spritesheet") || extension == "html" {
                continue;
            }
            fs::copy(&from, &to)?;
        }
    }

    Ok(())
}
