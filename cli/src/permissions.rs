use crate::api;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Access {
    None,
    Own,
    Public,
}

#[derive(Deserialize)]
struct PoliciesResponse {
    policies: Vec<Policy>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    table: String,
    select: Access,
    insert: Access,
    update: Access,
    delete: Access,
    #[serde(deserialize_with = "required_nullable_string")]
    owner_column: Option<String>,
}

fn required_nullable_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdatePolicy<'a> {
    select: Access,
    insert: Access,
    update: Access,
    delete: Access,
    owner_column: &'a Option<String>,
}

#[derive(Deserialize)]
struct UpdateResponse {
    policy: Policy,
}

pub fn run(project_dir: &Path, api_key: &str, table: &str) -> Result<(), String> {
    run_with_origin(project_dir, api_key, table, api::API_ORIGIN)
}

fn run_with_origin(
    project_dir: &Path,
    api_key: &str,
    table: &str,
    origin: &str,
) -> Result<(), String> {
    validate_table(table)?;
    let project_id = api::read_project_id(project_dir)?;
    let endpoint = format!("{origin}/bff/projects/{project_id}/policies");
    let agent = api::agent();
    let current: PoliciesResponse = api::get_json(&agent, &endpoint, api_key)
        .map_err(|error| format!("GET /bff/projects/{project_id}/policies failed: {error}"))?;
    let existing = current.policies.iter().find(|policy| policy.table == table);
    let default_writes = Access::None;
    let (insert, update, delete, owner_column) = match existing {
        Some(policy) => (
            policy.insert,
            policy.update,
            policy.delete,
            policy.owner_column.clone(),
        ),
        None => (default_writes, default_writes, default_writes, None),
    };
    let request = UpdatePolicy {
        select: Access::Public,
        insert,
        update,
        delete,
        owner_column: &owner_column,
    };
    let put_url = format!("{endpoint}/{}", table);
    let response: UpdateResponse =
        api::put_json(&agent, &put_url, api_key, &request).map_err(|error| {
            format!("PUT /bff/projects/{project_id}/policies/{table} failed: {error}")
        })?;
    if response.policy.table != table || response.policy.select != Access::Public {
        return Err(format!(
            "PUT /bff/projects/{project_id}/policies/{table} returned an unexpected policy for '{}' with select={:?}",
            response.policy.table, response.policy.select
        ));
    }
    println!("{table}: Read Everyone");
    Ok(())
}

fn validate_table(table: &str) -> Result<(), String> {
    let bytes = table.as_bytes();
    let valid = !bytes.is_empty()
        && bytes.len() <= 63
        && bytes[0].is_ascii_alphabetic()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
        && !table.to_ascii_lowercase().starts_with("sqlite_");
    if valid {
        Ok(())
    } else {
        Err(format!(
            "invalid table name '{table}': expected 1-63 ASCII letters, digits, or underscores, starting with a letter, and not using the sqlite_ prefix"
        ))
    }
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

    type Request = (String, String, String);
    type MockServer = (String, thread::JoinHandle<Vec<Request>>);

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "canopy-permissions-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            std::fs::write(
                path.join("canopy.json"),
                r#"{"projectId":"90da3093-84b6-4cd7-a39a-a8afc39403b8"}"#,
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

    fn policy(
        table: &str,
        select: &str,
        insert: &str,
        update: &str,
        delete: &str,
        owner: &str,
    ) -> String {
        format!(
            r#"{{"table":"{table}","select":"{select}","insert":"{insert}","update":"{update}","delete":"{delete}","ownerColumn":{owner},"updated_at":"now"}}"#
        )
    }

    #[test]
    fn new_table_gets_public_reads_and_no_write_access() {
        let project = TempProject::new();
        let (origin, server) = mock_server(vec![
            (200, String::new(), r#"{"policies":[]}"#.to_owned()),
            (
                200,
                String::new(),
                format!(
                    r#"{{"policy":{}}}"#,
                    policy("boards", "public", "none", "none", "none", "null")
                ),
            ),
        ]);
        run_with_origin(&project.0, "test-key", "boards", &origin).unwrap();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(
            requests[0]
                .0
                .starts_with("GET /bff/projects/90da3093-84b6-4cd7-a39a-a8afc39403b8/policies ")
        );
        assert!(requests[1].0.starts_with(
            "PUT /bff/projects/90da3093-84b6-4cd7-a39a-a8afc39403b8/policies/boards "
        ));
        for (_, headers, _) in &requests {
            assert!(
                headers
                    .to_ascii_lowercase()
                    .contains("authorization: bearer test-key")
            );
        }
        let put: serde_json::Value = serde_json::from_str(&requests[1].2).unwrap();
        assert_eq!(put["select"], "public");
        assert_eq!(put["insert"], "none");
        assert_eq!(put["update"], "none");
        assert_eq!(put["delete"], "none");
        assert!(put["ownerColumn"].is_null());
    }

    #[test]
    fn preserves_existing_write_and_owner_policy_and_existing_public_is_idempotent() {
        for current_select in ["none", "public"] {
            let project = TempProject::new();
            let current = policy(
                "boards",
                current_select,
                "own",
                "none",
                "own",
                r#""owner_id""#,
            );
            let saved = policy("boards", "public", "own", "none", "own", r#""owner_id""#);
            let (origin, server) = mock_server(vec![
                (200, String::new(), format!(r#"{{"policies":[{current}]}}"#)),
                (200, String::new(), format!(r#"{{"policy":{saved}}}"#)),
            ]);
            run_with_origin(&project.0, "key", "boards", &origin).unwrap();
            let requests = server.join().unwrap();
            let put: serde_json::Value = serde_json::from_str(&requests[1].2).unwrap();
            assert_eq!(put["select"], "public");
            assert_eq!(put["insert"], "own");
            assert_eq!(put["update"], "none");
            assert_eq!(put["delete"], "own");
            assert_eq!(put["ownerColumn"], "owner_id");
        }
    }

    #[test]
    fn rejects_invalid_table_names_before_network() {
        for table in [
            "",
            "1boards",
            "bad-name",
            "sqlite_sequence",
            "SQLite_meta",
            "a".repeat(64).as_str(),
        ] {
            let project = TempProject::new();
            let (origin, server) = mock_server(Vec::new());
            assert!(
                run_with_origin(&project.0, "key", table, &origin)
                    .unwrap_err()
                    .contains("invalid table name")
            );
            assert!(server.join().unwrap().is_empty());
        }
    }

    #[test]
    fn get_errors_and_malformed_or_incomplete_policies_do_not_put() {
        let project = TempProject::new();
        let (origin, server) = mock_server(vec![(
            404,
            String::new(),
            r#"{"error":"project_not_found"}"#.to_owned(),
        )]);
        assert!(
            run_with_origin(&project.0, "key", "boards", &origin)
                .unwrap_err()
                .contains("HTTP 404: project_not_found")
        );
        assert_eq!(server.join().unwrap().len(), 1);

        for body in [
            "invalid-json",
            r#"{"policies":[{"table":"boards","select":"public"}]}"#,
        ] {
            let (origin, server) = mock_server(vec![(200, String::new(), body.to_owned())]);
            assert!(run_with_origin(&project.0, "key", "boards", &origin).is_err());
            assert_eq!(server.join().unwrap().len(), 1);
        }

        let (origin, server) = mock_server(vec![
            (200, String::new(), r#"{"policies":[]}"#.to_owned()),
            (
                404,
                String::new(),
                r#"{"error":"table_not_found"}"#.to_owned(),
            ),
        ]);
        assert!(
            run_with_origin(&project.0, "key", "missing", &origin)
                .unwrap_err()
                .contains("HTTP 404: table_not_found")
        );
        assert_eq!(server.join().unwrap().len(), 2);
    }

    #[test]
    fn rejects_unexpected_saved_policy_response() {
        for (returned_table, returned_select) in [("other", "public"), ("boards", "none")] {
            let project = TempProject::new();
            let saved = policy(
                returned_table,
                returned_select,
                "none",
                "none",
                "none",
                "null",
            );
            let (origin, server) = mock_server(vec![
                (200, String::new(), r#"{"policies":[]}"#.to_owned()),
                (200, String::new(), format!(r#"{{"policy":{saved}}}"#)),
            ]);
            assert!(
                run_with_origin(&project.0, "key", "boards", &origin)
                    .unwrap_err()
                    .contains("returned an unexpected policy")
            );
            assert_eq!(server.join().unwrap().len(), 2);
        }
    }
}
