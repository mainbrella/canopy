use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

const API_ORIGIN: &str = "https://api.mainbrella.com";
const CONFIG_FILE: &str = "canopy.json";
const MIGRATIONS_DIR: &str = "migrations";
const MAX_SQL_BYTES: usize = 32_768;
const MAX_SAFE_SEQUENCE: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectConfig {
    project_id: String,
}

#[derive(Deserialize)]
struct MigrationLedger {
    migrations: Vec<LedgerEntry>,
}

#[derive(Deserialize)]
struct LedgerEntry {
    sequence: u64,
}

#[derive(Serialize)]
struct ApplyRequest<'a> {
    sequence: u64,
    name: &'a str,
    sql: &'a str,
}

#[derive(Deserialize)]
struct ApplyResponse {
    applied: bool,
}

#[derive(Deserialize)]
struct ApiError {
    error: Option<String>,
}

struct LocalMigration {
    sequence: u64,
    name: String,
    path: PathBuf,
    sql: String,
}

pub fn run(project_dir: &Path, api_key: &str) -> Result<(), String> {
    run_with_origin(project_dir, api_key, API_ORIGIN)
}

fn run_with_origin(project_dir: &Path, api_key: &str, origin: &str) -> Result<(), String> {
    let project_id = read_project_id(project_dir)?;
    let migrations = read_migrations(project_dir)?;
    let endpoint = format!("{origin}/bff/projects/{project_id}/migrations");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(0)
        .http_status_as_error(false)
        .build()
        .into();

    let ledger: MigrationLedger = get_json(&agent, &endpoint, api_key)
        .map_err(|error| format!("GET /bff/projects/{project_id}/migrations failed: {error}"))?;
    let latest = ledger
        .migrations
        .iter()
        .map(|entry| entry.sequence)
        .max()
        .unwrap_or(0);
    if latest > MAX_SAFE_SEQUENCE {
        return Err(format!(
            "server migration sequence {latest} exceeds the supported safe integer limit"
        ));
    }
    let pending: Vec<_> = migrations
        .into_iter()
        .filter(|migration| migration.sequence > latest)
        .collect();

    let mut expected = latest
        .checked_add(1)
        .ok_or_else(|| "migration sequence has reached the numeric limit".to_owned())?;
    for migration in &pending {
        if migration.sequence != expected {
            return Err(format!(
                "migration sequence gap: expected {expected}, found {} ({})",
                migration.sequence,
                migration.path.display()
            ));
        }
        expected = expected
            .checked_add(1)
            .ok_or_else(|| "migration sequence has reached the numeric limit".to_owned())?;
        if migration.sql.trim().is_empty() {
            return Err(format!("{} is empty", migration.path.display()));
        }
        if migration.sql.len() > MAX_SQL_BYTES {
            return Err(format!(
                "{} exceeds the {MAX_SQL_BYTES}-byte SQL limit",
                migration.path.display()
            ));
        }
    }

    if pending.is_empty() {
        println!("Migrations are up to date (latest sequence {latest}).");
        return Ok(());
    }

    for migration in pending {
        let body = ApplyRequest {
            sequence: migration.sequence,
            name: &migration.name,
            sql: &migration.sql,
        };
        let response: ApplyResponse =
            post_json(&agent, &endpoint, api_key, &body).map_err(|error| {
                format!(
                    "{}: POST migration failed: {error}",
                    migration.path.display()
                )
            })?;
        if response.applied {
            println!("Applied {}", migration.path.display());
        } else {
            println!("Already applied {}", migration.path.display());
        }
    }
    Ok(())
}

fn read_project_id(project_dir: &Path) -> Result<String, String> {
    let path = project_dir.join(CONFIG_FILE);
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let config: ProjectConfig = serde_json::from_str(&contents)
        .map_err(|error| format!("invalid {}: {error}", path.display()))?;
    if !is_uuid(&config.project_id) {
        return Err(format!(
            "invalid projectId in {}: expected a lowercase UUID",
            path.display()
        ));
    }
    Ok(config.project_id)
}

fn is_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|&index| bytes[index] == b'-')
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        })
}

fn read_migrations(project_dir: &Path) -> Result<Vec<LocalMigration>, String> {
    let directory = project_dir.join(MIGRATIONS_DIR);
    let entries = fs::read_dir(&directory).map_err(|error| {
        format!(
            "cannot read migrations directory {}: {error}",
            directory.display()
        )
    })?;
    let mut migrations = Vec::new();
    let mut sequences = HashSet::new();
    let mut names = HashSet::new();

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("cannot read an entry in {}: {error}", directory.display()))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("cannot inspect {}: {error}", path.display()))?;
        if !file_type.is_file() || path.extension().and_then(|value| value.to_str()) != Some("sql")
        {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                format!(
                    "invalid migration filename: {} is not valid UTF-8",
                    path.display()
                )
            })?;
        let (sequence, name) = parse_filename(filename)
            .ok_or_else(|| format!("invalid migration filename: {filename}"))?;
        if !sequences.insert(sequence) {
            return Err(format!(
                "duplicate migration sequence {sequence} in {filename}"
            ));
        }
        if !names.insert(name.to_owned()) {
            return Err(format!("duplicate migration name '{name}' in {filename}"));
        }
        let sql = fs::read_to_string(&path)
            .map_err(|error| format!("cannot read migration {}: {error}", path.display()))?;
        migrations.push(LocalMigration {
            sequence,
            name: name.to_owned(),
            path,
            sql,
        });
    }
    migrations.sort_by_key(|migration| migration.sequence);
    Ok(migrations)
}

fn parse_filename(filename: &str) -> Option<(u64, &str)> {
    let stem = filename.strip_suffix(".sql")?;
    let (sequence, name) = stem.split_once('_')?;
    if sequence.is_empty() || !sequence.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let sequence = sequence.parse::<u64>().ok()?;
    if sequence == 0 || sequence > MAX_SAFE_SEQUENCE || !valid_name(name) {
        return None;
    }
    Some((sequence, name))
}

fn valid_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 63
        && bytes[0].is_ascii_alphabetic()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
}

fn get_json<T: for<'de> Deserialize<'de>>(
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

fn post_json<T: for<'de> Deserialize<'de>, B: Serialize>(
    agent: &ureq::Agent,
    url: &str,
    api_key: &str,
    body: &B,
) -> Result<T, String> {
    let body = serde_json::to_string(body).map_err(|error| error.to_string())?;
    let response = agent
        .post(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .send(body)
        .map_err(|error| error.to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    type RecordedRequest = (String, String, String);
    type MockServer = (String, thread::JoinHandle<Vec<RecordedRequest>>);

    struct TempProject(PathBuf);

    impl TempProject {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "canopy-migrate-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("migrations")).unwrap();
            fs::write(
                path.join(CONFIG_FILE),
                r#"{"projectId":"90da3093-84b6-4cd7-a39a-a8afc39403b8"}"#,
            )
            .unwrap();
            Self(path)
        }

        fn migration(&self, filename: &str, sql: &str) {
            fs::write(self.0.join(MIGRATIONS_DIR).join(filename), sql).unwrap();
        }
    }

    impl Drop for TempProject {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn mock_server(responses: Vec<(u16, String)>) -> MockServer {
        mock_server_with_headers(
            responses
                .into_iter()
                .map(|(status, body)| (status, String::new(), body))
                .collect(),
        )
    }

    fn mock_server_with_headers(responses: Vec<(u16, String, String)>) -> MockServer {
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

    fn ledger(sequences: &[u64]) -> String {
        let migrations: Vec<_> = sequences
            .iter()
            .map(|sequence| format!(r#"{{"sequence":{sequence}}}"#))
            .collect();
        format!(r#"{{"migrations":[{}]}}"#, migrations.join(","))
    }

    #[test]
    fn applies_in_numeric_order_with_auth_and_json_payloads() {
        let project = TempProject::new();
        project.migration("10_ten.sql", "SELECT 10;");
        project.migration("9_nine.sql", "SELECT 9;");
        let (origin, server) = mock_server(vec![
            (200, ledger(&[8])),
            (200, r#"{"applied":true,"checksum":"a"}"#.to_owned()),
            (200, r#"{"applied":false,"checksum":"b"}"#.to_owned()),
        ]);

        run_with_origin(&project.0, "test-key", &origin).unwrap();
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 3);
        assert!(
            requests[0]
                .0
                .starts_with("GET /bff/projects/90da3093-84b6-4cd7-a39a-a8afc39403b8/migrations ")
        );
        for (_, headers, _) in &requests {
            assert!(
                headers
                    .to_ascii_lowercase()
                    .contains("authorization: bearer test-key")
            );
        }
        let bodies: Vec<ApplyRequestOwned> = requests[1..]
            .iter()
            .map(|request| serde_json::from_str(&request.2).unwrap())
            .collect();
        assert_eq!(
            bodies.iter().map(|body| body.sequence).collect::<Vec<_>>(),
            [9, 10]
        );
        assert_eq!(bodies[0].name, "nine");
        assert_eq!(bodies[1].sql, "SELECT 10;");
    }

    #[derive(Deserialize)]
    struct ApplyRequestOwned {
        sequence: u64,
        name: String,
        sql: String,
    }

    #[test]
    fn starts_at_one_when_ledger_empty_and_accepts_latest_over_bounded_history() {
        let project = TempProject::new();
        project.migration("001_init.sql", "SELECT 1;");
        let (origin, server) = mock_server(vec![
            (200, ledger(&[])),
            (200, r#"{"applied":true,"checksum":"x"}"#.to_owned()),
        ]);
        run_with_origin(&project.0, "key", &origin).unwrap();
        assert_eq!(server.join().unwrap().len(), 2);

        let project = TempProject::new();
        project.migration("106_next.sql", "SELECT 106;");
        let bounded: Vec<u64> = (6..=105).collect();
        let (origin, server) = mock_server(vec![
            (200, ledger(&bounded)),
            (200, r#"{"applied":true,"checksum":"x"}"#.to_owned()),
        ]);
        run_with_origin(&project.0, "key", &origin).unwrap();
        let requests = server.join().unwrap();
        assert_eq!(
            serde_json::from_str::<ApplyRequestOwned>(&requests[1].2)
                .unwrap()
                .sequence,
            106
        );
    }

    #[test]
    fn skips_applied_files_and_reports_up_to_date() {
        let project = TempProject::new();
        project.migration("001_old.sql", "old sql");
        project.migration("002_new.sql", "new sql");
        let (origin, server) = mock_server(vec![
            (200, ledger(&[1])),
            (200, r#"{"applied":false,"checksum":"x"}"#.to_owned()),
        ]);
        run_with_origin(&project.0, "key", &origin).unwrap();
        assert_eq!(server.join().unwrap().len(), 2);

        let project = TempProject::new();
        project.migration("001_applied.sql", "old sql");
        let (origin, server) = mock_server(vec![(200, ledger(&[1]))]);
        run_with_origin(&project.0, "key", &origin).unwrap();
        assert_eq!(server.join().unwrap().len(), 1);

        let project = TempProject::new();
        let (origin, server) = mock_server(vec![(200, ledger(&[]))]);
        run_with_origin(&project.0, "key", &origin).unwrap();
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn local_validation_happens_before_any_network_request() {
        for (filename, expected) in [
            ("1_bad-name.sql", "invalid migration filename"),
            ("001_other.sql", "duplicate migration sequence"),
        ] {
            let project = TempProject::new();
            project.migration("001_same.sql", "SELECT 1;");
            project.migration(filename, "SELECT 2;");
            let (origin, server) = mock_server(Vec::new());
            assert!(
                run_with_origin(&project.0, "key", &origin)
                    .unwrap_err()
                    .contains(expected)
            );
            assert!(server.join().unwrap().is_empty());
        }

        let project = TempProject::new();
        project.migration("001_duplicate.sql", "SELECT 1;");
        project.migration("002_duplicate.sql", "SELECT 2;");
        let (origin, server) = mock_server(Vec::new());
        assert!(
            run_with_origin(&project.0, "key", &origin)
                .unwrap_err()
                .contains("duplicate migration name")
        );
        assert!(server.join().unwrap().is_empty());
    }

    #[test]
    fn validates_every_pending_sql_file_before_posting_any() {
        for (filename, sql, expected) in [
            ("002_empty.sql", "", "is empty"),
            ("002_oversize.sql", "x", "exceeds the 32768-byte SQL limit"),
        ] {
            let project = TempProject::new();
            project.migration("001_valid.sql", "SELECT 1;");
            let invalid_sql = if expected.starts_with("exceeds") {
                "x".repeat(MAX_SQL_BYTES + 1)
            } else {
                sql.to_owned()
            };
            project.migration(filename, &invalid_sql);
            let (origin, server) = mock_server(vec![(200, ledger(&[]))]);
            assert!(
                run_with_origin(&project.0, "key", &origin)
                    .unwrap_err()
                    .contains(expected)
            );
            assert_eq!(server.join().unwrap().len(), 1);
        }
    }

    #[test]
    fn rejects_gaps_before_applying_anything() {
        let project = TempProject::new();
        project.migration("001_one.sql", "SELECT 1;");
        project.migration("003_three.sql", "SELECT 3;");
        let (origin, server) = mock_server(vec![(200, ledger(&[]))]);
        assert!(
            run_with_origin(&project.0, "key", &origin)
                .unwrap_err()
                .contains("sequence gap")
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn malformed_api_json_and_post_errors_include_context_and_stop() {
        let project = TempProject::new();
        project.migration("001_one.sql", "SELECT 1;");
        project.migration("002_two.sql", "SELECT 2;");
        let (origin, server) = mock_server(vec![
            (200, ledger(&[])),
            (409, r#"{"error":"migration_out_of_order"}"#.to_owned()),
        ]);
        let error = run_with_origin(&project.0, "key", &origin).unwrap_err();
        assert!(error.contains("001_one.sql"));
        assert!(error.contains("HTTP 409: migration_out_of_order"));
        assert_eq!(server.join().unwrap().len(), 2);

        let (origin, server) = mock_server(vec![(200, "not-json".to_owned())]);
        assert!(
            run_with_origin(&project.0, "key", &origin)
                .unwrap_err()
                .contains("invalid JSON response")
        );
        assert_eq!(server.join().unwrap().len(), 1);
    }

    #[test]
    fn invalid_project_id_never_reaches_network() {
        let project = TempProject::new();
        fs::write(
            project.0.join(CONFIG_FILE),
            r#"{"projectId":"../../other"}"#,
        )
        .unwrap();
        let (origin, server) = mock_server(Vec::new());
        assert!(
            run_with_origin(&project.0, "key", &origin)
                .unwrap_err()
                .contains("lowercase UUID")
        );
        assert!(server.join().unwrap().is_empty());
    }

    #[test]
    fn redirect_is_not_followed_or_forwarded() {
        let project = TempProject::new();
        project.migration("001_init.sql", "SELECT 1;");
        let redirect_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let redirect_addr = redirect_listener.local_addr().unwrap();
        let redirect = thread::spawn(move || {
            redirect_listener.set_nonblocking(true).unwrap();
            thread::sleep(Duration::from_millis(300));
            redirect_listener.accept().is_ok()
        });
        let (origin, server) = mock_server_with_headers(vec![(
            302,
            format!("Location: http://{redirect_addr}/redirected\r\n"),
            r#"{"error":"redirect"}"#.to_owned(),
        )]);
        let error = run_with_origin(&project.0, "secret-key", &origin).unwrap_err();
        let requests = server.join().unwrap();
        assert!(error.contains("HTTP 302"));
        assert_eq!(requests.len(), 1);
        assert!(
            requests[0]
                .1
                .to_ascii_lowercase()
                .contains("authorization: bearer secret-key")
        );
        assert!(!redirect.join().unwrap());
    }
}
