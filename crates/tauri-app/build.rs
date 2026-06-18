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
            // Dev-only authoring notes (e.g. flowerbed/_brief/) stay in source,
            // never shipped. Convention: any sprite subdir starting with '_' is
            // dev-only. No runtime sprite group uses a leading underscore.
            if entry.file_name().to_string_lossy().starts_with('_') {
                continue;
            }
            copy_dir(&from, &to)?;
        } else {
            // Dev-only atlases + source artifacts stay in source; only the
            // shipped mirror is slim. `_spritesheet` = packed atlases,
            // `_source` = image-gen source PNGs (e.g. the 1.4 MB
            // flowerbed_source_imagegen.png), `flowers.png` = the flowerbed
            // master sheet (runtime uses the sliced flower_l*_*.png, not the
            // sheet), `.html` = preview pages.
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            let extension = from.extension().and_then(|ext| ext.to_str()).unwrap_or("");
            if file_name.contains("_spritesheet")
                || file_name.contains("_source")
                || file_name == "flowers.png"
                || extension == "html"
            {
                continue;
            }
            fs::copy(&from, &to)?;
        }
    }

    Ok(())
}
