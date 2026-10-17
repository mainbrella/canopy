use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;

pub const API_ORIGIN: &str = "https://api.mainbrella.com";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConfig {
    project_id: String,
}

#[derive(Deserialize)]
struct ApiError {
    error: Option<String>,
}

pub fn read_project_id(project_dir: &Path) -> Result<String, String> {
    let path = project_dir.join("canopy.json");
    let contents = std::fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let config: ProjectConfig = serde_json::from_str(&contents)
        .map_err(|error| format!("invalid {}: {error}", path.display()))?;
    if !is_lowercase_uuid(&config.project_id) {
        return Err(format!(
            "invalid projectId in {}: expected a lowercase UUID",
            path.display()
        ));
    }
    Ok(config.project_id)
}

pub fn is_lowercase_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|&index| bytes[index] == b'-')
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        })
}

pub fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into()
}

pub fn get_json<T: for<'de> Deserialize<'de>>(
    agent: &ureq::Agent,
    url: &str,
    api_key: &str,
) -> Result<T, String> {
    let response = agent
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .call()
        .map_err(|error| error.to_string())?;
    decode_response(response)
}

pub fn post_json<T: for<'de> Deserialize<'de>, B: Serialize>(
    agent: &ureq::Agent,
    url: &str,
    api_key: &str,
    body: &B,
) -> Result<T, String> {
    send_json(agent, "POST", url, api_key, body)
}

pub fn put_json<T: for<'de> Deserialize<'de>, B: Serialize>(
    agent: &ureq::Agent,
    url: &str,
    api_key: &str,
    body: &B,
) -> Result<T, String> {
    send_json(agent, "PUT", url, api_key, body)
}

pub fn patch_json<T: for<'de> Deserialize<'de>, B: Serialize>(
    agent: &ureq::Agent,
    url: &str,
    api_key: &str,
    body: &B,
) -> Result<T, String> {
    send_json(agent, "PATCH", url, api_key, body)
}

fn send_json<T: for<'de> Deserialize<'de>, B: Serialize>(
    agent: &ureq::Agent,
    method: &str,
    url: &str,
    api_key: &str,
    body: &B,
) -> Result<T, String> {
    let body = serde_json::to_string(body).map_err(|error| error.to_string())?;
    let request = match method {
        "PUT" => agent.put(url),
        "PATCH" => agent.patch(url),
        "POST" => agent.post(url),
        _ => return Err(format!("unsupported HTTP method: {method}")),
    }
    .header("Authorization", format!("Bearer {api_key}"))
    .header("Accept", "application/json")
    .header("Content-Type", "application/json");
    let response = request.send(body).map_err(|error| error.to_string())?;
    decode_response(response)
}

fn decode_response<T: for<'de> Deserialize<'de>>(
    mut response: ureq::http::Response<ureq::Body>,
) -> Result<T, String> {
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .read_to_string()
        .map_err(|error| format!("HTTP {status}, unable to read response: {error}"))?;
    if !(200..300).contains(&status) {
        let detail = serde_json::from_str::<ApiError>(&body)
            .ok()
            .and_then(|error| error.error)
            .unwrap_or_else(|| body.trim().to_owned());
        return Err(if detail.is_empty() {
            format!("HTTP {status}")
        } else {
            format!("HTTP {status}: {detail}")
        });
    }
    serde_json::from_str(&body).map_err(|error| format!("invalid JSON response: {error}"))
}
