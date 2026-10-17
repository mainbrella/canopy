use std::env;
use std::process;
use std::time::Duration;

mod api;
mod browser_keys;
mod migration;
mod permissions;

const API_KEY_ME_URL: &str = "https://api.mainbrella.com/api-keys/me";

#[derive(Debug, PartialEq, Eq)]
enum Command {
    NoArgs,
    Help,
    Whoami,
    Migrate,
    ReadEveryone(String),
    BrowserKeys,
    GrantSelect { table: String, key_id: String },
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    let command = match parse_args(&args) {
        Ok(command) => command,
        Err(error) => {
            eprintln!("error: {error}\n\nUsage: canopy [OPTIONS]");
            process::exit(2);
        }
    };

    if command == Command::Help {
        print_help();
        return;
    }

    let api_key = env::var("MAINBRELLA_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        eprintln!(
            "error: MAINBRELLA_API_KEY is not set. Set it before running canopy, for example:\n  export MAINBRELLA_API_KEY=\"your-api-key\""
        );
        process::exit(1);
    }

    match command {
        Command::Whoami => match fetch_whoami(API_KEY_ME_URL, api_key.trim()) {
            Ok(json) => println!("{json}"),
            Err(error) => {
                eprintln!("error: GET /api-keys/me failed: {error}");
                process::exit(1);
            }
        },
        Command::Migrate => {
            if let Err(error) = migration::run(std::path::Path::new("."), api_key.trim()) {
                eprintln!("error: {error}");
                process::exit(1);
            }
        }
        Command::ReadEveryone(table) => {
            if let Err(error) = permissions::run(std::path::Path::new("."), api_key.trim(), &table)
            {
                eprintln!("error: {error}");
                process::exit(1);
            }
        }
        Command::BrowserKeys => match browser_keys::list(std::path::Path::new("."), api_key.trim())
        {
            Ok(listing) => println!("{listing}"),
            Err(error) => {
                eprintln!("error: {error}");
                process::exit(1);
            }
        },
        Command::GrantSelect { table, key_id } => match browser_keys::grant_select(
            std::path::Path::new("."),
            api_key.trim(),
            &table,
            &key_id,
        ) {
            Ok(message) => println!("{message}"),
            Err(error) => {
                eprintln!("error: {error}");
                process::exit(1);
            }
        },
        Command::NoArgs => print_help(),
        Command::Help => unreachable!(),
    }
}

fn parse_args(args: &[String]) -> Result<Command, String> {
    match args {
        [] => Ok(Command::NoArgs),
        [arg] if arg == "--whoami" => Ok(Command::Whoami),
        [arg] if arg == "--migrate" => Ok(Command::Migrate),
        [arg] if arg == "--browser-keys" => Ok(Command::BrowserKeys),
        [arg] if arg == "-h" || arg == "--help" => Ok(Command::Help),
        [flag] if flag == "--read-everyone" => {
            Err("--read-everyone requires a table name".to_owned())
        }
        [flag, table] if flag == "--read-everyone" => {
            if table.is_empty() || table.starts_with('-') {
                Err("--read-everyone requires a table name".to_owned())
            } else {
                Ok(Command::ReadEveryone(table.clone()))
            }
        }
        [flag] if flag == "--grant-select" => {
            Err("--grant-select requires a table name followed by --key <KEY_ID>".to_owned())
        }
        [flag, table] if flag == "--grant-select" => {
            if table.is_empty() || table.starts_with('-') {
                Err("--grant-select requires a table name followed by --key <KEY_ID>".to_owned())
            } else {
                Err("--grant-select requires --key <KEY_ID>".to_owned())
            }
        }
        [flag, table, key_flag] if flag == "--grant-select" => {
            if table.is_empty() || table.starts_with('-') {
                Err("--grant-select requires a table name".to_owned())
            } else if key_flag == "--key" {
                Err("--grant-select --key requires a browser key ID".to_owned())
            } else {
                Err("--grant-select requires --key <KEY_ID>".to_owned())
            }
        }
        [flag, table, key_flag, key_id] if flag == "--grant-select" => {
            if table.is_empty() || table.starts_with('-') {
                Err("--grant-select requires a table name".to_owned())
            } else if key_flag != "--key" || key_id.is_empty() || key_id.starts_with('-') {
                Err("expected --grant-select <TABLE> --key <KEY_ID>".to_owned())
            } else if let Err(error) = permissions::validate_table(table) {
                Err(error)
            } else if !api::is_lowercase_uuid(key_id) {
                Err(format!(
                    "invalid browser key ID '{key_id}': expected a lowercase UUID"
                ))
            } else {
                Ok(Command::GrantSelect {
                    table: table.clone(),
                    key_id: key_id.clone(),
                })
            }
        }
        [argument, ..] => Err(format!("unexpected argument '{argument}'")),
    }
}

fn fetch_whoami(url: &str, api_key: &str) -> Result<String, ureq::Error> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(0)
        .build()
        .into();
    let mut response = agent
        .get(url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .call()?;

    if !response.status().is_success() {
        return Err(ureq::Error::StatusCode(response.status().as_u16()));
    }

    response.body_mut().read_to_string()
}

fn print_help() {
    println!(
        "Canopy CLI\n\nUsage: canopy [OPTIONS]\n\nOptions:\n  --whoami                         Call /api-keys/me and print the returned JSON\n  --migrate                        Apply pending SQL files from ./migrations\n  --read-everyone <TABLE>           Allow public reads from a table\n  --browser-keys                    List browser keys and their grants\n  --grant-select <TABLE> --key <KEY_ID>\n                                    Add a table SELECT grant to an existing browser key\n  -h, --help                        Print this help message\n\nProject config:\n  ./canopy.json  Must contain a lowercase UUID projectId\n\nEnvironment:\n  MAINBRELLA_API_KEY  API key required to run canopy"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

    #[test]
    fn parses_read_everyone_and_preserves_existing_commands() {
        assert_eq!(parse_args(&[]).unwrap(), Command::NoArgs);
        assert_eq!(parse_args(&["--whoami".into()]).unwrap(), Command::Whoami);
        assert_eq!(parse_args(&["--migrate".into()]).unwrap(), Command::Migrate);
        assert_eq!(
            parse_args(&["--browser-keys".into()]).unwrap(),
            Command::BrowserKeys
        );
        assert_eq!(
            parse_args(&["--read-everyone".into(), "boards".into()]).unwrap(),
            Command::ReadEveryone("boards".into())
        );
        assert!(
            parse_args(&["--read-everyone".into()])
                .unwrap_err()
                .contains("requires a table name")
        );
        assert!(
            parse_args(&["--read-everyone".into(), "boards".into(), "extra".into()])
                .unwrap_err()
                .contains("unexpected argument")
        );
        for value in ["", "--migrate"] {
            assert!(
                parse_args(&["--read-everyone".into(), value.into()])
                    .unwrap_err()
                    .contains("requires a table name")
            );
        }
        assert_eq!(
            parse_args(&[
                "--grant-select".into(),
                "boards".into(),
                "--key".into(),
                "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9".into(),
            ])
            .unwrap(),
            Command::GrantSelect {
                table: "boards".into(),
                key_id: "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9".into(),
            }
        );
        for invalid in [
            vec!["--grant-select"],
            vec!["--grant-select", "boards"],
            vec![
                "--grant-select",
                "--key",
                "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9",
            ],
            vec!["--grant-select", "boards", "--key"],
            vec![
                "--grant-select",
                "boards",
                "wrong",
                "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9",
            ],
            vec!["--grant-select", "boards", "--key", "not-a-uuid"],
            vec![
                "--grant-select",
                "bad-name",
                "--key",
                "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9",
            ],
            vec![
                "--grant-select",
                "boards",
                "--key",
                "c88a1cb6-7aaa-4c30-8c4a-d4f2288421e9",
                "extra",
            ],
        ] {
            let args = invalid.into_iter().map(String::from).collect::<Vec<_>>();
            assert!(parse_args(&args).is_err(), "accepted {args:?}");
        }
    }

    fn mock_response(status: &str, headers: &str, body: &str) -> (String, JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/api-keys/me", listener.local_addr().unwrap());
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
            body.len()
        );
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(&stream);
            let mut request = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap() == 0 || line == "\r\n" {
                    break;
                }
                request.push_str(&line);
            }
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        (url, server)
    }

    #[test]
    fn whoami_sends_api_key_and_preserves_response_json() {
        for body in [
            r#"{"accountId":"account-123"}"#,
            r#"{"accountId":"account-456","extra":true}"#,
        ] {
            let (url, server) = mock_response("200 OK", "", body);
            let result = fetch_whoami(&url, "test-api-key");
            let request = server.join().unwrap().to_ascii_lowercase();

            assert_eq!(result.unwrap(), body);
            assert!(request.starts_with("get /api-keys/me http/1.1\r\n"));
            assert!(request.contains("\r\nauthorization: bearer test-api-key\r\n"));
            assert!(request.contains("\r\naccept: application/json\r\n"));
        }
    }

    #[test]
    fn whoami_reports_http_failures() {
        for status in [
            "401 Unauthorized",
            "403 Forbidden",
            "503 Service Unavailable",
        ] {
            let (url, server) = mock_response(status, "", r#"{"error":"denied"}"#);
            let result = fetch_whoami(&url, "test-api-key");
            server.join().unwrap();

            let code = status[..3].parse::<u16>().unwrap();
            assert!(matches!(result, Err(ureq::Error::StatusCode(actual)) if actual == code));
        }
    }

    #[test]
    fn whoami_rejects_redirects() {
        let (url, server) = mock_response(
            "302 Found",
            "Location: http://127.0.0.1:1/redirected\r\n",
            "",
        );
        let result = fetch_whoami(&url, "test-api-key");
        server.join().unwrap();

        assert!(matches!(result, Err(ureq::Error::StatusCode(302))));
    }
}
