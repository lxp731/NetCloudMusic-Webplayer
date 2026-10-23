fn main() {
    // Register the custom invoke commands in the ACL manifest so remote URLs
    // (the web player and its login hops) can call them. Without this, Tauri 2
    // rejects remote invocations with "not allowed. Plugin not found".
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "media_state",
                "page_event",
                "page_probe",
                "shell_retry",
                "shell_info",
            ]),
        ),
    )
    .expect("failed to run tauri-build with app manifest");
}
