# feyzullah-agents kurulum denetimi (Windows).
# Varsayılan: yalnız denetler, hiçbir şey kurmaz. -Link: `fa` komutunu npm link ile genel yola ekler.
# Kullanım: powershell -ExecutionPolicy Bypass -File tools\kur.ps1 [-Link] [-Test]
param([switch]$Link, [switch]$Test)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent $PSScriptRoot
$fail = 0

function Check($name, $ok, $detail) {
  if ($ok) { Write-Output ("  tamam  {0,-12} {1}" -f $name, $detail) }
  else { Write-Output ("  EKSİK  {0,-12} {1}" -f $name, $detail); $script:fail++ }
}
function Has($bin) { [bool](Get-Command $bin -ErrorAction SilentlyContinue) }

Write-Output 'Gerekenler:'
$node = if (Has node) { (node -v) } else { $null }
Check 'node' ($node -and [int]($node.TrimStart('v').Split('.')[0]) -ge 24) ($(if ($node) { "$node (24+ gerekli)" } else { 'yok: https://nodejs.org' }))
Check 'git' (Has git) ($(if (Has git) { (git --version) } else { 'yok' }))

Write-Output 'Motorlar (en az biri):'
$engines = 0
foreach ($e in @(@('codex', 'kod, test, build'), @('claude', 'yönetici, inceleme'), @('agy', 'belge, araştırma'))) {
  $has = Has $e[0]
  if ($has) { $engines++ }
  Write-Output ("  {0}  {1,-12} {2}" -f $(if ($has) { 'var  ' } else { 'yok  ' }), $e[0], $e[1])
}
if (-not $engines) { Write-Output '  EKSİK  hiçbir motor bulunamadı'; $fail++ }

Write-Output 'Roblox paketi için (isteğe bağlı):'
foreach ($b in 'rokit', 'rojo', 'stylua', 'selene', 'lune', 'luau-analyze') {
  Write-Output ("  {0}  {1}" -f $(if (Has $b) { 'var  ' } else { 'yok  ' }), $b)
}

Write-Output 'Ayarlar:'
Write-Output ("  FA_PORT          {0}" -f $(if ($env:FA_PORT) { $env:FA_PORT } else { '4317 (varsayılan)' }))
Write-Output ("  FA_NOESIS_PARENT {0}" -f $(if ($env:FA_NOESIS_PARENT) { 'ayarlı' } else { 'yok (ders sayfaları yazılmaz)' }))

if ($Test -and -not $fail) { Push-Location $root; try { npm test } finally { Pop-Location } }
if ($Link -and -not $fail) { Push-Location $root; try { npm link; Write-Output 'fa komutu eklendi.' } finally { Pop-Location } }
if ($fail) { Write-Output "$fail eksik var."; exit 1 }
Write-Output $(if ($Link) { 'Hazır.' } else { 'Hazır. fa komutunu eklemek için: -Link' })
