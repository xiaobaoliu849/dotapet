param(
  [string]$Installer = (Join-Path $PSScriptRoot '..\release\DotaPet-Setup-0.1.2.exe'),
  [Parameter(Mandatory = $true)][string]$Baseline
)
$ErrorActionPreference = 'Stop'
$taskProject = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskExpectedVersion = (Get-Content -LiteralPath (Join-Path $taskProject 'package.json') -Raw | ConvertFrom-Json).version
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
$taskBaseline = (Resolve-Path -LiteralPath $Baseline).Path
$taskUninstallRoots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
function Find-CompanionInstallation {
  @(Get-ItemProperty -Path $taskUninstallRoots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like '*VoiceSpirit*' -or $_.DisplayName -eq 'DotaPet' })
}
if ((Find-CompanionInstallation).Count -gt 0) { throw 'A companion is already installed. Run this check in a clean Windows account or Sandbox to preserve the existing installation.' }
$taskShortcutPaths = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) '刀塔宠物.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\刀塔宠物.lnk')
)
$taskProtectedShortcuts = $taskShortcutPaths + @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Dota2 VoiceSpirit Companion.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Desktop')) '刀塔Pet.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\刀塔Pet.lnk'),
  (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs\Dota2 VoiceSpirit Companion.lnk')
)
foreach ($taskShortcut in $taskProtectedShortcuts) { if (Test-Path -LiteralPath $taskShortcut) { throw "An existing shortcut must be preserved: $taskShortcut" } }
$taskRoot = Join-Path ([IO.Path]::GetTempPath()) ('companion-installer-' + [Guid]::NewGuid().ToString('N'))
$taskInstallDir = [IO.Path]::GetFullPath((Join-Path $taskRoot 'DotaPet'))
$taskDataDir = Join-Path $taskRoot 'profile'
New-Item -ItemType Directory -Path $taskDataDir -Force | Out-Null
Set-Content -LiteralPath (Join-Path $taskDataDir '.companion-validation') -Value 'synthetic test data only'
$taskReport = [ordered]@{ baseline = $taskBaseline; installer = $taskInstaller; installDirectory = $taskInstallDir; dataDirectory = $taskDataDir }
function Invoke-Installer([string]$Executable) {
  $taskProcess = Start-Process -FilePath $Executable -ArgumentList @('/S', '/currentuser', "/D=$taskInstallDir") -WindowStyle Hidden -PassThru
  if (!$taskProcess.WaitForExit(45000)) { throw 'Installer timed out; inspect the isolated installation directory.' }
  if ($taskProcess.ExitCode -ne 0) { throw "Installer failed: $($taskProcess.ExitCode)" }
}
function Assert-InstallTarget {
  $taskEntry = @(Find-CompanionInstallation)
  if ($taskEntry.Count -ne 1) { throw 'Expected exactly one uninstall entry.' }
  $taskMatch = [regex]::Match($taskEntry[0].UninstallString, '^"([^"]+)"')
  if (!$taskMatch.Success) { throw 'Uninstall entry is not a quoted executable path.' }
  $taskRegisteredDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $taskMatch.Groups[1].Value))
  if ($taskRegisteredDirectory.TrimEnd('\') -ne $taskInstallDir.TrimEnd('\')) { throw 'Unexpected install location. Refusing to operate on it.' }
}
function Data-Hashes {
  $taskHasher = [Security.Cryptography.SHA256]::Create()
  try {
    @(Get-ChildItem -LiteralPath $taskDataDir -File -Recurse | Where-Object { $_.Name -eq 'ai-settings.json' -or $_.Name -eq 'welcome.json' -or $_.Name -eq 'customization.json' -or $_.Name -eq 'custom_phrases.json' -or $_.Extension -eq '.svg' } | Sort-Object FullName | ForEach-Object { $_.Name + ':' + [BitConverter]::ToString($taskHasher.ComputeHash([IO.File]::ReadAllBytes($_.FullName))).Replace('-', '') })
  } finally { $taskHasher.Dispose() }
}
function Invoke-Node([string[]]$Arguments) {
  & node @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'Desktop validation failed.' }
}
try {
  Invoke-Installer $taskBaseline
  Assert-InstallTarget
  $taskExecutable = Join-Path $taskInstallDir 'DotaPet.exe'
  if (!(Test-Path -LiteralPath $taskExecutable)) { $taskExecutable = Join-Path $taskInstallDir 'Dota2 VoiceSpirit Companion.exe' }
  if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Installed executable missing.' }
  Invoke-Node @((Join-Path $PSScriptRoot 'smoke-desktop.mjs'), $taskExecutable)
  $taskReport.freshInstall = 'PASS'
  Invoke-Node @((Join-Path $PSScriptRoot 'run-upgrade.mjs'), 'seed', $taskDataDir)
  $taskBefore = Data-Hashes
  Invoke-Installer $taskInstaller
  Assert-InstallTarget
  $taskExecutable = Join-Path $taskInstallDir 'DotaPet.exe'
  if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Updated executable missing.' }
  if (@(Compare-Object $taskBefore (Data-Hashes)).Count -ne 0) { throw 'Installer changed user data.' }
  $taskReport.upgradePreservedFiles = 'PASS'
  $taskShell = New-Object -ComObject WScript.Shell
  foreach ($taskShortcut in $taskShortcutPaths) {
    if (!(Test-Path -LiteralPath $taskShortcut)) { throw "Shortcut missing: $taskShortcut" }
    if ($taskShell.CreateShortcut($taskShortcut).TargetPath -ne $taskExecutable) { throw 'Shortcut targets the wrong executable.' }
  }
  $taskReport.shortcuts = 'PASS'
  $taskVersion = (Get-Item -LiteralPath $taskExecutable).VersionInfo.ProductVersion
  if (!$taskVersion.StartsWith($taskExpectedVersion)) { throw "Upgrade executable version is $taskVersion, expected $taskExpectedVersion" }
  $taskReport.version = $taskVersion
  Invoke-Node @((Join-Path $PSScriptRoot 'run-upgrade.mjs'), 'check', $taskExecutable, $taskDataDir)
  $taskReport.upgradeCanReadData = 'PASS'
  Invoke-Node @((Join-Path $PSScriptRoot 'smoke-desktop.mjs'), $taskExecutable)
  $taskReport.currentDesktopSmoke = 'PASS'
} finally {
  if (Test-Path -LiteralPath $taskInstallDir) {
    # Check the fully resolved target before invoking an uninstaller that recursively removes it.
    $taskResolvedRoot = [IO.Path]::GetFullPath($taskRoot).TrimEnd('\') + '\'
    $taskResolvedInstall = [IO.Path]::GetFullPath($taskInstallDir)
    if (!$taskResolvedInstall.StartsWith($taskResolvedRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Uninstall target is outside the validation directory.' }
    Assert-InstallTarget
    $taskUninstaller = Get-ChildItem -LiteralPath $taskResolvedInstall -Filter 'Uninstall*.exe' | Select-Object -First 1
    if ($taskUninstaller) {
      $taskProcess = Start-Process -FilePath $taskUninstaller.FullName -ArgumentList @('/S', '/currentuser', "_?=$taskResolvedInstall") -WindowStyle Hidden -PassThru
      if (!$taskProcess.WaitForExit(45000) -or $taskProcess.ExitCode -ne 0) { throw 'Uninstall validation failed.' }
      if ((Find-CompanionInstallation).Count -gt 0 -or (Test-Path -LiteralPath $taskExecutable)) { throw 'Uninstaller left the application registered or executable present.' }
      foreach ($taskShortcut in $taskProtectedShortcuts) { if (Test-Path -LiteralPath $taskShortcut) { throw 'Uninstaller left a shortcut.' } }
      $taskReport.uninstall = 'PASS'
      if ($taskBefore -and @(Compare-Object $taskBefore (Data-Hashes)).Count -ne 0) { throw 'Uninstall changed preserved test settings.' }
      $taskReport.uninstallPreservedData = 'PASS'
    }
  }
  $taskReport | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'report.json') -Encoding UTF8
  Write-Output "Validation report: $(Join-Path $taskRoot 'report.json')"
}
$taskReport | ConvertTo-Json
