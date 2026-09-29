fn main() {
  println!("cargo:rerun-if-changed=icons/icon.ico");
  println!("cargo:rerun-if-changed=tauri.conf.json");
  println!("cargo:rerun-if-changed=../dist");
  println!("cargo:rerun-if-changed=../dist/index.html");
  tauri_build::build()
}
