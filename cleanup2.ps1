Write-Host "=== DISK SPACE BEFORE CLEANUP ==="
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -match '^[CD]$' } | ForEach-Object {
    $free = [math]::Round($_.Free/1GB, 2)
    $used = [math]::Round($_.Used/1GB, 2)
    $total = [math]::Round(($_.Used + $_.Free)/1GB, 2)
    Write-Host "$($_.Name): Free=$free GB, Used=$used GB, Total=$total GB"
}

function Clean-Dir {
    param([string]$Path, [string]$Label)
    if (Test-Path $Path) {
        $size = (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        $sizeMB = [math]::Round($size/1MB, 2)
        Write-Host "$Label : $sizeMB MB"
        Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  -> Cleaned"
    } else {
        Write-Host "$Label : not found"
    }
}

Write-Host ""
Write-Host "=== CLEANING NVIDIA CACHES ==="
# NVIDIA driver installer cache (biggest win ~14 GB)
Clean-Dir "C:\ProgramData\NVIDIA Corporation\Downloader" "NVIDIA Downloader"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\NV_Cache" "NVIDIA NV_Cache"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\OptixCache" "NVIDIA OptixCache"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\GLCache" "NVIDIA GLCache"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\DXCache" "NVIDIA DXCache"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\NVAPI" "NVIDIA NVAPI"
Clean-Dir "C:\ProgramData\NVIDIA Corporation\NVWMI" "NVIDIA NVWMI"
# User-level NVIDIA cache
Clean-Dir "$env:LOCALAPPDATA\NVIDIA Corporation\GLCache" "NVIDIA User GLCache"
Clean-Dir "$env:LOCALAPPDATA\NVIDIA Corporation\DXCache" "NVIDIA User DXCache"
Clean-Dir "$env:LOCALAPPDATA\NVIDIA Corporation\OptixCache" "NVIDIA User OptixCache"

Write-Host ""
Write-Host "=== CLEANING NPM CACHE ==="
Clean-Dir "$env:LOCALAPPDATA\npm-cache" "npm-cache"
Clean-Dir "$env:APPDATA\npm-cache" "npm-cache (Roaming)"

Write-Host ""
Write-Host "=== CLEANING TEMP ==="
$tempPath = $env:TEMP
if (Test-Path $tempPath) {
    $size = (Get-ChildItem -Path $tempPath -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    Write-Host "Temp: $([math]::Round($size/1MB,2)) MB"
    Get-ChildItem -Path $tempPath -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  -> Cleaned"
}

Write-Host ""
Write-Host "=== CLEANING ELECTRON CACHE ==="
Clean-Dir "$env:LOCALAPPDATA\electron\Cache" "Electron Cache"

Write-Host ""
Write-Host "=== CLEANING AZURE FUNCTIONS TOOLS ==="
Clean-Dir "$env:LOCALAPPDATA\AzureFunctionsTools" "AzureFunctionsTools"

Write-Host ""
Write-Host "=== CLEANING BROWSER CACHES ==="
# Brave cache
Clean-Dir "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Default\Cache" "Brave Cache"
Clean-Dir "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Default\Code Cache" "Brave Code Cache"
Clean-Dir "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data\Default\Service Worker" "Brave Service Worker"
# Opera cache
Clean-Dir "$env:LOCALAPPDATA\Opera Software\Opera Stable\Cache" "Opera Cache"
Clean-Dir "$env:LOCALAPPDATA\Opera Software\Opera Stable\Code Cache" "Opera Code Cache"

Write-Host ""
Write-Host "=== CLEANING SPOTIFY CACHE ==="
Clean-Dir "$env:LOCALAPPDATA\Spotify\Storage" "Spotify Storage"
Clean-Dir "$env:LOCALAPPDATA\Spotify\Data" "Spotify Data"

Write-Host ""
Write-Host "=== CLEANING DISCORD CACHE ==="
Clean-Dir "$env:LOCALAPPDATA\Discord\Cache" "Discord Cache"
Clean-Dir "$env:APPDATA\discord\Cache" "Discord Cache (Roaming)"

Write-Host ""
Write-Host "=== CLEANING VSCODE CACHES ==="
Clean-Dir "$env:APPDATA\Code\Cache" "VSCode Cache"
Clean-Dir "$env:APPDATA\Code\CachedData" "VSCode CachedData"
Clean-Dir "$env:APPDATA\Code\CachedExtensions" "VSCode CachedExtensions"
Clean-Dir "$env:APPDATA\Code\CachedProfiles" "VSCode CachedProfiles"
Clean-Dir "$env:APPDATA\Code\logs" "VSCode Logs"

Write-Host ""
Write-Host "=== CLEANING JETBRAINS CACHES ==="
Clean-Dir "$env:LOCALAPPDATA\JetBrains\Toolbox" "JetBrains Toolbox"

Write-Host ""
Write-Host "=== CLEANING PYTHON/PIP CACHE ==="
Clean-Dir "$env:LOCALAPPDATA\pip\cache" "Pip Cache"
Clean-Dir "$env:APPDATA\Python\Python3*\cache" "Python Cache"

Write-Host ""
Write-Host "=== CLEANING CAPCUT CACHE ==="
$capcutPath = "$env:LOCALAPPDATA\CapCut"
if (Test-Path $capcutPath) {
    $size = (Get-ChildItem -Path $capcutPath -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    Write-Host "CapCut total: $([math]::Round($size/1GB,2)) GB"
    # Clean cache subdirectories but keep the app itself
    Get-ChildItem -Path $capcutPath -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'cache|Cache|temp|Temp|log|Log' } | ForEach-Object {
        $subSize = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        Write-Host "  Cleaning $($_.Name): $([math]::Round($subSize/1MB,2)) MB"
        Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
Write-Host "=== CLEANING RECYCLE BIN ==="
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
Write-Host "Recycle bin cleared"

Write-Host ""
Write-Host "=== CLEANING WINDOWS UPDATE CACHE ==="
Stop-Service -Name wuauserv -Force -ErrorAction SilentlyContinue
Clean-Dir "C:\Windows\SoftwareDistribution\Download" "Windows Update Downloads"
Start-Service -Name wuauserv -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== CLEANING DELIVERY OPTIMIZATION ==="
Stop-Service -Name DoSvc -Force -ErrorAction SilentlyContinue
Clean-Dir "C:\Windows\SoftwareDistribution\DeliveryOptimization" "Delivery Optimization"
Start-Service -Name DoSvc -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "=== DISK SPACE AFTER CLEANUP ==="
Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Name -match '^[CD]$' } | ForEach-Object {
    $free = [math]::Round($_.Free/1GB, 2)
    $used = [math]::Round($_.Used/1GB, 2)
    $total = [math]::Round(($_.Used + $_.Free)/1GB, 2)
    Write-Host "$($_.Name): Free=$free GB, Used=$used GB, Total=$total GB"
}