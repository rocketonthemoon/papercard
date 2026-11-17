# Starts the Docker-compatible pipe for the Podman machine, which `podman compose`
# (via docker-compose) needs. Podman normally starts it itself, but on some Windows
# setups its helper (win-sshproxy) fails to launch during `podman machine start`.
# Run this after each `podman machine start` if `podman compose` says it can't find
# //./pipe/podman-machine-default.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\podman-pipe.ps1

$ErrorActionPreference = "Stop"
$machine = "podman-machine-default"
$pipe = "\\.\pipe\$machine"

if ([System.IO.Directory]::GetFiles("\\.\pipe\") -contains $pipe) {
    Write-Host "The pipe $pipe is already running."
    exit 0
}

# The root connection: ssh://root@127.0.0.1:<port>/run/podman/podman.sock
$conn = podman system connection list --format "{{.Name}}|{{.URI}}|{{.Identity}}" |
    Where-Object { $_ -like "$machine-root|*" } | Select-Object -First 1
if (-not $conn) { throw "No '$machine-root' connection. Is the Podman machine initialized? Try: podman machine start" }
$name, $uri, $identity = $conn.Split("|")

$proxy = Join-Path (Split-Path (Get-Command podman).Source) "win-sshproxy.exe"
$state = Join-Path $env:USERPROFILE ".local\share\containers\podman\machine\wsl\$machine"
Start-Process -FilePath $proxy -WindowStyle Hidden -ArgumentList @(
    $machine, "`"$state`"", "npipe:////./pipe/$machine", $uri, "`"$identity`""
)

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if ([System.IO.Directory]::GetFiles("\\.\pipe\") -contains $pipe) {
        Write-Host "Started $pipe. podman compose will work until the Podman machine or Windows restarts."
        exit 0
    }
}
throw "win-sshproxy didn't create $pipe. Check that the Podman machine is running: podman machine list"
