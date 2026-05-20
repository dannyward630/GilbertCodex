$root = Split-Path -Parent $PSScriptRoot
$exclude = @('node_modules','target','dist','.git','.github','docs','public','scripts')
$exts = @('*.ts','*.tsx','*.rs','*.css','*.mjs','*.ps1','*.html','*.md','*.json','*.toml')

$total = 0
$fileCount = 0

Get-ChildItem -Path $root -Recurse -Include $exts | Where-Object {
    $full = $_.FullName
    $excluded = $false
    foreach ($ex in $exclude) {
       if ($full -like "*\$ex*") { $excluded = $true; break }
    }
    if ($excluded) { $false }
   elseif ($_.Name -eq 'Cargo.lock' -or $_.Name -like '*.lock') { $false }
   else { $true }
} | Sort-Object FullName | ForEach-Object {
   $count = (Get-Content $_.FullName -ReadCount 0 -ErrorAction SilentlyContinue).Count
    $rel = $_.FullName.Replace("$root\","")
   $total += $count
    $fileCount++
    Write-Host ("{0,-75} {1,6}" -f $rel, $count)
}

Write-Host "`n================================"
Write-Host "Total source files: $fileCount"
Write-Host "Total lines of code: $total"
