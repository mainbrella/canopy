use crate::{api, permissions};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Operation {
    Select,
    Insert,
    Update,
    Delete,
}

impl Operation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Select => "select",
            Self::Insert => "insert",
            Self::Update => "update",
            Self::Delete => "delete",
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BrowserKey {
    id: String,
    name: String,
    prefix: String,
    origins: Vec<String>,
    tables: BTreeMap<String, Vec<Operation>>,
    functions: BTreeMap<String, u64>,
}

#[derive(Deserialize)]
struct ListResponse {
    keys: Vec<BrowserKey>,
}

#[derive(Serialize)]
struct GrantRequest<'a> {
    table: &'a str,
    operation: Operation,
}

#[derive(Deserialize)]
struct GrantResponse {
    key: BrowserKey,
}

pub fn list(project_dir: &Path, api_key: &str) -> Result<String, String> {
    list_with_origin(project_dir, api_key, api::API_ORIGIN)
}

fn list_with_origin(project_dir: &Path, api_key: &str, origin: &str) -> Result<String, String> {
    let project_id = api::read_project_id(project_dir)?;
    let endpoint = format!("{origin}/bff/projects/{project_id}/api-keys");
    let response: ListResponse = api::get_json(&api::agent(), &endpoint, api_key)
        .map_err(|error| format!("GET /bff/projects/{project_id}/api-keys failed: {error}"))?;
    Ok(format_keys(&response.keys))
}

pub(crate) fn grant_operation(
    project_dir: &Path,
    api_key: &str,
    table: &str,
    operation: Operation,
    key_id: &str,
) -> Result<String, String> {
    grant_with_origin(
        project_dir,
        api_key,
        table,
        operation,
        key_id,
        api::API_ORIGIN,
    )
}

fn grant_with_origin(
    project_dir: &Path,
    api_key: &str,
    table: &str,
    operation: Operation,
    key_id: &str,
    origin: &str,
) -> Result<String, String> {
    permissions::validate_table(table)?;
    if !api::is_lowercase_uuid(key_id) {
        return Err(format!(
            "invalid browser key ID '{key_id}': expected a lowercase UUID"
        ));
    }
    let project_id = api::read_project_id(project_dir)?;
    let endpoint = format!("{origin}/bff/projects/{project_id}/api-keys/{key_id}");
    let response: GrantResponse = api::patch_json(
        &api::agent(),
        &endpoint,
        api_key,
        &GrantRequest { table, operation },
    )
    .map_err(|error| {
        format!("PATCH /bff/projects/{project_id}/api-keys/{key_id} failed: {error}")
    })?;
    if response.key.id != key_id
        || !response
            .key
            .tables
            .get(table)
            .is_some_and(|operations| operations.contains(&operation))
    {
        return Err(format!(
            "PATCH /bff/projects/{project_id}/api-keys/{key_id} returned a key without the requested {} grant",
            operation.as_str()
        ));
    }
    Ok(format!(
        "Granted {} on {table} to browser key {} ({})",
        operation.as_str(),
        response.key.id,
        response.key.prefix
    ))
}

pub(crate) fn parse_operation(value: &str) -> Option<Operation> {
    match value {
        "select" => Some(Operation::Select),
        "insert" => Some(Operation::Insert),
        "update" => Some(Operation::Update),
        "delete" => Some(Operation::Delete),
        _ => None,
    }
}

fn format_keys(keys: &[BrowserKey]) -> String {
    if keys.is_empty() {
        return "No browser keys.".to_owned();
    }

    let mut output = format!("Browser keys ({})\n", keys.len());
    for key in keys {
        output.push_str(&format!("\n{} ({}) — {}\n", key.name, key.id, key.prefix));
        if key.origins.is_empty() {
            output.push_str("  Origins: none\n");
        } else {
            output.push_str(&format!("  Origins: {}\n", key.origins.join(", ")));
        }
        if key.tables.is_empty() {
            output.push_str("  Table grants: none\n");
        } else {
            output.push_str("  Table grants:\n");
            for (table, operations) in &key.tables {
                let operations = operations
                    .iter()
                    .map(|operation| format!("{operation:?}").to_ascii_lowercase())
                    .collect::<Vec<_>>()
                    .join(", ");
                output.push_str(&format!("    {table}: {operations}\n"));
            }
        }
        if key.functions.is_empty() {
            output.push_str("  Function grants: none\n");
        } else {
            output.push_str("  Function grants:\n");
            for (function, version) in &key.functions {
                output.push_str(&format!("    {function}: version {version}\n"));
            }
        }
    }
    output.trim_end().to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    const PROJECT_ID: &str = "90da3093-84b6-4cd7-a39a-a8afc39403b8";
    const KEY_ID: &str = "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9";

    type Request = (String, String, String);
    type MockServer = (String, thread::JoinHandle<Vec<Request>>);

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "canopy-browser-keys-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(
                path.join("canopy.json"),
                format!(r#"{{"projectId":"{PROJECT_ID}"}}"#),
            )
            .unwrap();
            Self(path)
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn mock_server(responses: Vec<(u16, String, String)>) -> MockServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for (status, extra_headers, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut headers = String::new();
                let mut content_length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length: ")
                    {
                        content_length = value.trim().parse().unwrap();
                    }
                    headers.push_str(&line);
                }
                let mut body_bytes = vec![0; content_length];
                reader.read_exact(&mut body_bytes).unwrap();
                let request_body = String::from_utf8(body_bytes).unwrap();
                let response = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{extra_headers}\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
                requests.push((request_line, headers, request_body));
            }
            requests
        });
        (origin, server)
    }

    fn key_json(id: &str, table_grants: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"web client","prefix":"bff_pk_abcd","origins":["https://example.com"],"tables":{table_grants},"functions":{{"lookup":3}},"created_at":"2026-01-01T00:00:00Z"}}"#
        )
    }

    #[test]
    fn lists_empty_keys_and_displays_key_metadata_without_secrets() {
        let project = TempProject::new();
        let (origin, server) = mock_server(vec![(200, String::new(), r#"{"keys":[]}"#.to_owned())]);
        assert_eq!(
            list_with_origin(&project.0, "test-key", &origin).unwrap(),
            "No browser keys."
        );
        let requests = server.join().unwrap();
        assert!(
            requests[0]
                .0
                .starts_with(&format!("GET /bff/projects/{PROJECT_ID}/api-keys "))
        );
        assert!(
            requests[0]
                .1
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key")
        );

        let key = BrowserKey {
            id: KEY_ID.to_owned(),
            name: "web client with a deliberately long name".to_owned(),
            prefix: "bff_pk_abcd".to_owned(),
            origins: vec!["https://example.com".to_owned()],
            tables: BTreeMap::from([("boards".to_owned(), vec![Operation::Select])]),
            functions: BTreeMap::from([("lookup".to_owned(), 3)]),
        };
        let rendered = format_keys(&[key]);
        assert!(rendered.contains("web client with a deliberately long name"));
        assert!(rendered.contains(KEY_ID));
        assert!(rendered.contains("Origins: https://example.com"));
        assert!(rendered.contains("boards: select"));
        assert!(rendered.contains("lookup: version 3"));
        assert!(!rendered.contains("token"));
    }

    #[test]
    fn patch_adds_select_grant_to_the_requested_key() {
        let project = TempProject::new();
        let response_key = key_json(KEY_ID, r#"{"boards":["select"],"other":["insert"]}"#);
        let (origin, server) = mock_server(vec![(
            200,
            String::new(),
            format!(r#"{{"key":{response_key}}}"#),
        )]);
        let message = grant_with_origin(
            &project.0,
            "test-key",
            "boards",
            Operation::Select,
            KEY_ID,
            &origin,
        )
        .unwrap();
        assert!(message.contains(KEY_ID));
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].0.starts_with(&format!(
            "PATCH /bff/projects/{PROJECT_ID}/api-keys/{KEY_ID} "
        )));
        assert!(
            requests[0]
                .1
                .to_ascii_lowercase()
                .contains("authorization: bearer test-key")
        );
        let body: serde_json::Value = serde_json::from_str(&requests[0].2).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"table":"boards", "operation":"select"})
        );
    }

    #[test]
    fn patch_supports_each_additive_table_operation() {
        for (operation, wire_value) in [
            (Operation::Select, "select"),
            (Operation::Insert, "insert"),
            (Operation::Update, "update"),
            (Operation::Delete, "delete"),
        ] {
            let project = TempProject::new();
            let response_key = key_json(KEY_ID, &format!(r#"{{"messages":["{wire_value}"]}}"#));
            let (origin, server) = mock_server(vec![(
                200,
                String::new(),
                format!(r#"{{"key":{response_key}}}"#),
            )]);
            let result = grant_with_origin(
                &project.0, "test-key", "messages", operation, KEY_ID, &origin,
            )
            .unwrap();
            assert!(result.contains(&format!("Granted {wire_value}")));
            let requests = server.join().unwrap();
            assert!(requests[0].0.starts_with(&format!(
                "PATCH /bff/projects/{PROJECT_ID}/api-keys/{KEY_ID} "
            )));
            let body: serde_json::Value = serde_json::from_str(&requests[0].2).unwrap();
            assert_eq!(body["table"], "messages");
            assert_eq!(body["operation"], wire_value);
        }
    }

    #[test]
    fn rejects_bad_inputs_before_network_and_surfaces_bad_responses() {
        let project = TempProject::new();
        for (table, key_id, expected) in [
            ("sqlite_master", KEY_ID, "invalid table name"),
            ("boards", "../../other", "invalid browser key ID"),
        ] {
            let (origin, server) = mock_server(Vec::new());
            assert!(
                grant_with_origin(&project.0, "key", table, Operation::Select, key_id, &origin,)
                    .unwrap_err()
                    .contains(expected)
            );
            assert!(server.join().unwrap().is_empty());
        }

        let (origin, server) = mock_server(vec![(200, String::new(), "not-json".to_owned())]);
        assert!(
            list_with_origin(&project.0, "key", &origin)
                .unwrap_err()
                .contains("invalid JSON response")
        );
        assert_eq!(server.join().unwrap().len(), 1);

        let (origin, server) = mock_server(vec![(
            404,
            String::new(),
            r#"{"error":"not_found"}"#.to_owned(),
        )]);
        assert!(
            grant_with_origin(
                &project.0,
                "key",
                "boards",
                Operation::Select,
                KEY_ID,
                &origin,
            )
            .unwrap_err()
            .contains("HTTP 404: not_found")
        );
        assert_eq!(server.join().unwrap().len(), 1);

        for (response_id, grants) in [
            (
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                r#"{"boards":["select"]}"#,
            ),
            (KEY_ID, r#"{"other":["select"]}"#),
        ] {
            let key = key_json(response_id, grants);
            let (origin, server) =
                mock_server(vec![(200, String::new(), format!(r#"{{"key":{key}}}"#))]);
            assert!(
                grant_with_origin(
                    &project.0,
                    "key",
                    "boards",
                    Operation::Select,
                    KEY_ID,
                    &origin,
                )
                .unwrap_err()
                .contains("without the requested select grant")
            );
            assert_eq!(server.join().unwrap().len(), 1);
        }

        let key = key_json(KEY_ID, r#"{"messages":["select"]}"#);
        let (origin, server) =
            mock_server(vec![(200, String::new(), format!(r#"{{"key":{key}}}"#))]);
        assert!(
            grant_with_origin(
                &project.0,
                "key",
                "messages",
                Operation::Insert,
                KEY_ID,
                &origin,
            )
            .unwrap_err()
            .contains("without the requested insert grant")
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }
}
