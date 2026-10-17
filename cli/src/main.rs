use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    match args.as_slice() {
        [] => {}
        [arg] if arg == "-h" || arg == "--help" => {
            print_help();
            return;
        }
        [argument, ..] => {
            eprintln!("error: unexpected argument '{argument}'\n\nUsage: canopy [--help]");
            process::exit(2);
        }
    }

    if env::var("MAINBRELLA_API_KEY")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        eprintln!(
            "error: MAINBRELLA_API_KEY is not set. Set it before running canopy, for example:\n  export MAINBRELLA_API_KEY=\"your-api-key\""
        );
        process::exit(1);
    }

    print_help();
}

fn print_help() {
    println!(
        "Canopy CLI\n\nUsage: canopy [OPTIONS]\n\nOptions:\n  -h, --help  Print this help message\n\nEnvironment:\n  MAINBRELLA_API_KEY  API key required to run canopy"
    );
}
