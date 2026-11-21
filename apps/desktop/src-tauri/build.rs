fn main() {
    // The site's pages call these commands from a remote address: each needs a permission,
    // granted in `capabilities/site.json`.
    let commands = &[
        "list_windows",
        "window_preview",
        "hosting_state",
        "start_hosting",
        "stop_hosting",
        "saved_session",
        "sign_in",
        "sign_out",
        "save_session",
        "input_allowed",
        "restart_app",
        "firewall_allowed",
        "allow_firewall",
        "watch_controllers",
        "motion_controllers",
        "controller_support",
        "install_controller_support",
        "repair_permission",
        "open_privacy_settings",
        "set_bubble_open",
        "show_main_window",
        "update_available",
        "install_update",
    ];
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("the Tauri build step failed");
}
