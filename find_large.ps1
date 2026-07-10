Write-Host "=== LARGE DIRECTORIES IN USER PROFILE ==="
Get-ChildItem -Path "$env:USERPROFILE" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 500MB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}

Write-Host ""
Write-Host "=== LARGE DIRECTORIES IN APPDATA LOCAL ==="
Get-ChildItem -Path "$env:LOCALAPPDATA" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 200MB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}

Write-Host ""
Write-Host "=== LARGE DIRECTORIES IN APPDATA ROAMING ==="
Get-ChildItem -Path "$env:APPDATA" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 200MB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}

Write-Host ""
Write-Host "=== LARGE DIRECTORIES IN PROGRAMDATA ==="
Get-ChildItem -Path "C:\ProgramData" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 500MB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}

Write-Host ""
Write-Host "=== LARGE DIRECTORIES IN PROGRAM FILES ==="
Get-ChildItem -Path "C:\Program Files" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 1GB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}

Write-Host ""
Write-Host "=== LARGE DIRECTORIES IN PROGRAM FILES (x86) ==="
Get-ChildItem -Path "C:\Program Files (x86)" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    if ($size -gt 1GB) {
        Write-Host "$([math]::Round($size/1GB,2)) GB - $($_.FullName)"
    }
}