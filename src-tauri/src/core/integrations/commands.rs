use std::path::PathBuf;

use super::{catalog, credentials, github, imports};
use crate::core::app::commands::get_rey30_data_folder_path;

#[tauri::command]
pub async fn rey30_skill_pack_status<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<super::skill_pack::PackStatus, String> {
    let data = get_rey30_data_folder_path(app_handle);
    tokio::task::spawn_blocking(move || super::skill_pack::status(&data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rey30_skill_pack_install<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<super::skill_pack::PackStatus, String> {
    let data = get_rey30_data_folder_path(app_handle);
    tokio::task::spawn_blocking(move || super::skill_pack::install(&data))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_resources_scan<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    project_path: Option<String>,
    path: Option<String>,
) -> Result<imports::ImportPlan, String> {
    let data = get_rey30_data_folder_path(app_handle);
    let home = dirs::home_dir();
    tokio::task::spawn_blocking(move || {
        imports::scan(
            data,
            home,
            project_path
                .filter(|p| !p.trim().is_empty())
                .map(PathBuf::from),
            path.filter(|p| !p.trim().is_empty()).map(PathBuf::from),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn import_resources_commit<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    plan_id: String,
    candidate_ids: Vec<String>,
) -> Result<imports::ImportReceipt, String> {
    imports::commit(
        &plan_id,
        &candidate_ids,
        &get_rey30_data_folder_path(app_handle),
    )
    .await
}

#[tauri::command]
pub async fn import_resources_github_status() -> Result<github::GithubStatus, String> {
    github::status().await
}

#[tauri::command]
pub async fn mcp_catalog_list(
    search: Option<String>,
    cursor: Option<String>,
) -> Result<catalog::CatalogPage, String> {
    catalog::list(search.as_deref(), cursor.as_deref()).await
}

#[tauri::command]
pub async fn mcp_catalog_review<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    version: String,
    parameters: Option<std::collections::BTreeMap<String, String>>,
) -> Result<catalog::CatalogReview, String> {
    catalog::review(
        get_rey30_data_folder_path(app_handle),
        &name,
        &version,
        parameters.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn mcp_catalog_configure<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    name: String,
    values: Vec<credentials::CredentialValue>,
) -> Result<(), String> {
    imports::configure_catalog_credentials(&get_rey30_data_folder_path(app_handle), &name, values)
        .await
}

#[tauri::command]
pub async fn import_resources_github_login() -> Result<github::GithubLogin, String> {
    github::login().await
}

#[tauri::command]
pub async fn import_resources_github_poll(
    session_id: String,
) -> Result<github::GithubLogin, String> {
    github::poll(&session_id).await
}

#[tauri::command]
pub async fn import_resources_github_cancel(session_id: String) -> Result<(), String> {
    github::cancel(&session_id).await
}

#[tauri::command]
pub async fn import_resources_github_repos(page: u32) -> Result<github::RepoPage, String> {
    github::repos(page).await
}

#[tauri::command]
pub async fn import_resources_github_scan<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    repository: String,
) -> Result<imports::ImportPlan, String> {
    let data = get_rey30_data_folder_path(app_handle);
    let cache = data.join("integration-cache");
    imports::secure_dir(&cache)?;
    let snapshot = github::snapshot(&repository, &cache).await?;
    tokio::task::spawn_blocking(move || {
        imports::scan_repository(data, &snapshot.root, &snapshot.repository, &snapshot.sha)
    })
    .await
    .map_err(|e| e.to_string())?
}
