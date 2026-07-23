param(
    [ValidateSet("check", "test", "clippy", "dev", "build")]
    [string]$Task = "check",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$TaskArgs
)

$ErrorActionPreference = "Stop"
$sdk = Join-Path $env:LOCALAPPDATA "potato-box\xwin-sdk"
$packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
$llvmPackage = Get-ChildItem $packageRoot -Directory -Filter "MartinStorsjo.LLVM-MinGW.UCRT*" |
    Select-Object -First 1
$protobufPackage = Get-ChildItem $packageRoot -Directory -Filter "Google.Protobuf*" |
    Select-Object -First 1
$toolchain = Join-Path $env:USERPROFILE ".rustup\toolchains\stable-x86_64-pc-windows-msvc"

if (-not (Test-Path (Join-Path $sdk "crt\lib\x86_64"))) {
    throw "xwin SDK not found at $sdk. Follow CONTRIBUTING.md first."
}
if (-not $llvmPackage) {
    throw "LLVM-MinGW UCRT is not installed through winget."
}
if (-not $protobufPackage) {
    throw "Google.Protobuf is not installed through winget."
}

$clang = Get-ChildItem $llvmPackage.FullName -File -Filter "clang-*.exe" -Recurse |
    Where-Object { $_.Name -match '^clang-[0-9]+\.exe$' } |
    Select-Object -First 1
if (-not $clang) {
    throw "LLVM clang executable was not found."
}
$llvmBin = $clang.DirectoryName

$clangCl = Join-Path $llvmBin "clang-cl.exe"
if (-not (Test-Path $clangCl)) {
    New-Item -ItemType HardLink -Path $clangCl -Target $clang.FullName | Out-Null
}
$ml64 = Join-Path $llvmBin "ml64.exe"
$llvmMl = Join-Path $llvmBin "llvm-ml.exe"
if (-not (Test-Path $ml64)) {
    New-Item -ItemType HardLink -Path $ml64 -Target $llvmMl | Out-Null
}

$lld = Join-Path $toolchain "lib\rustlib\x86_64-pc-windows-msvc\bin\rust-lld.exe"
$crtLib = Join-Path $sdk "crt\lib\x86_64"
$umLib = Join-Path $sdk "sdk\lib\um\x86_64"
$ucrtLib = Join-Path $sdk "sdk\lib\ucrt\x86_64"
$protocBin = Join-Path $protobufPackage.FullName "bin"

$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-msvc"
$env:PATH = "$llvmBin;$protocBin;$env:PATH"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = $lld
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS = "-Lnative=$crtLib -Lnative=$umLib -Lnative=$ucrtLib"
$env:CC_x86_64_pc_windows_msvc = $clangCl
$env:CXX_x86_64_pc_windows_msvc = $clangCl
$env:AR_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-lib.exe"
$env:RC_x86_64_pc_windows_msvc = Join-Path $llvmBin "llvm-rc.exe"
$env:RC = $env:RC_x86_64_pc_windows_msvc
$env:INCLUDE = @(
    (Join-Path $sdk "crt\include")
    (Join-Path $sdk "sdk\include\ucrt")
    (Join-Path $sdk "sdk\include\um")
    (Join-Path $sdk "sdk\include\shared")
    (Join-Path $sdk "sdk\include\winrt")
) -join ";"
$env:LIB = "$crtLib;$umLib;$ucrtLib"

switch ($Task) {
    "check" { & cargo check --manifest-path src-tauri/Cargo.toml --lib @TaskArgs }
    "test" { & cargo test --manifest-path src-tauri/Cargo.toml --lib @TaskArgs }
    "clippy" { & cargo clippy --manifest-path src-tauri/Cargo.toml --lib -- -D warnings @TaskArgs }
    "dev" { & npm run tauri dev -- @TaskArgs }
    "build" { & npm run tauri build -- @TaskArgs }
}

if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
