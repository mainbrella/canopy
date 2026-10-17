use std::env;
use std::process;

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();

    match args.as_slice() {
        [] => print_help(),
        [arg] if arg == "-h" || arg == "--help" => print_help(),
        [argument, ..] => {
            eprintln!("error: unexpected argument '{argument}'\n\nUsage: canopy [--help]");
            process::exit(2);
        }
    }
}

fn print_help() {
    println!(
        "Canopy CLI\n\nUsage: canopy [OPTIONS]\n\nOptions:\n  -h, --help  Print this help message"
    );
}
