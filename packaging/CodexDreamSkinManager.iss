#ifndef AppVersion
  #error "AppVersion must be supplied from windows/VERSION"
#endif
#ifndef PackageRoot
  #define PackageRoot "..\build\DreamSkin"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define AppName "Dream Skin"
#define AppExeName "DreamSkin.exe"

[Setup]
AppId={{A4A6B717-9DB4-4C21-9AF1-7F9EA5D2CF5E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Dream Skin
AppPublisherURL=https://github.com/xxloocee/Dream-Skin
AppSupportURL=https://github.com/xxloocee/Dream-Skin/issues
DefaultDirName={localappdata}\Programs\CodexDreamSkinManager
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=DreamSkin-v{#AppVersion}-windows-x64-setup
SetupIconFile=..\assets\CodexDreamSkinManager.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
; Shutdown is scoped to this installation by PrepareToInstall, including Node.
CloseApplications=no
RestartApplications=no
SetupLogging=yes
ShowLanguageDialog=no
Uninstallable=yes
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoCompany=Dream Skin
VersionInfoDescription={#AppName} installer

[Languages]
Name: "chinesesimp"; MessagesFile: "languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："

[InstallDelete]
Type: files; Name: "{app}\CodexDreamSkinManager.exe"
Type: files; Name: "{app}\CodexDreamSkinManager.exe.config"
Type: files; Name: "{app}\CodexDreamSkinManager.dll"
Type: files; Name: "{app}\CodexDreamSkinManager.pdb"
Type: files; Name: "{autoprograms}\Codex Dream Skin Manager.lnk"
Type: files; Name: "{autodesktop}\Codex Dream Skin Manager.lnk"
Type: files; Name: "{autoprograms}\Codex Dream Skin.lnk"
Type: files; Name: "{autodesktop}\Codex Dream Skin.lnk"

[Files]
Source: "windows-install.ps1"; Flags: dontcopy
Source: "{#PackageRoot}\*"; DestDir: "{app}"; Excludes: "updater\installation-complete.json"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Classes\dreamskin"; ValueType: string; ValueData: "URL:Dream Skin"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\dreamskin"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\dreamskin\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExeName}"" ""%1"""

[Run]
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\updater\installation-complete.json"

[Code]
var
  HelperLog: String;

function CloseInstalledManager: Boolean;
var
  Parameters: String;
  ResultCode: Integer;
begin
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\windows-install.ps1') + '" -InstallRoot "' +
    ExpandConstant('{app}') + '" -LogPath "' + HelperLog + '"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ResultCode);
  if Result then Result := ResultCode = 0;
  Log('Installation shutdown helper: exit code ' + IntToStr(ResultCode) +
    '; details: ' + HelperLog);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if SuppressibleMsgBox('安装需要关闭本软件及其后台进程。' + #13#10 +
    '点击“确定”立即关闭并继续；点击“取消”不关闭、不继续。',
    mbConfirmation, MB_OKCANCEL or MB_DEFBUTTON2, IDCANCEL) <> IDOK then begin
    Result := '安装已取消，未关闭任何进程。';
    Exit;
  end;
  ExtractTemporaryFile('windows-install.ps1');
  { A sibling of the temporary folder survives Setup's temporary-file cleanup. }
  HelperLog := ExpandConstant('{tmp}') + '-dreamskin-install.log';
  Log('Installation shutdown log: ' + HelperLog);
  if CloseInstalledManager then
    Result := ''
  else
    Result := '无法关闭管理器或后台进程，安装尚未开始。请关闭后重试。' + #13#10 +
      '详细日志：' + HelperLog;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssDone then begin
    ForceDirectories(ExpandConstant('{app}\updater'));
    if not SaveStringToFile(ExpandConstant('{app}\updater\installation-complete.json'),
      '{"schemaVersion":1,"version":"{#AppVersion}"}', False) then
      Log('Could not write the installation completion receipt.');
  end;
end;
