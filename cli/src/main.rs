use std::env;
use std::process;
use std::time::Duration;

const API_KEY_ME_URL: &str = "https://api.mainbrella.com/api-keys/me";

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    let whoami = match args.as_slice() {
        [] => false,
        [arg] if arg == "--whoami" => true,
        [arg] if arg == "-h" || arg == "--help" => {
            print_help();
            return;
        }
        [argument, ..] => {
            eprintln!("error: unexpected argument '{argument}'\n\nUsage: canopy [OPTIONS]");
            process::exit(2);
        }
    };

    let api_key = env::var("MAINBRELLA_API_KEY").unwrap_or_default();
    if api_key.trim().is_empty() {
        eprintln!(
            "error: MAINBRELLA_API_KEY is not set. Set it before running canopy, for example:\n  export MAINBRELLA_API_KEY=\"your-api-key\""
        );
        process::exit(1);
    }

    if whoami {
        match fetch_whoami(API_KEY_ME_URL, api_key.trim()) {
            Ok(json) => println!("{json}"),
            Err(error) => {
                eprintln!("error: GET /api-keys/me failed: {error}");
                process::exit(1);
            }
        }
    } else {
        print_help();
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
        "Canopy CLI\n\nUsage: canopy [OPTIONS]\n\nOptions:\n      --whoami  Call /api-keys/me and print the returned JSON\n  -h, --help    Print this help message\n\nEnvironment:\n  MAINBRELLA_API_KEY  API key required to run canopy"
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread::{self, JoinHandle};

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
