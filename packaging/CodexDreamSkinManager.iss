#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PackageRoot
  #define PackageRoot "..\build\CodexDreamSkinManager"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

#define AppName "Codex Dream Skin Manager"
#define AppExeName "CodexDreamSkinManager.exe"

[Setup]
AppId={{A4A6B717-9DB4-4C21-9AF1-7F9EA5D2CF5E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Codex Dream Skin
AppPublisherURL=https://github.com/xxloocee/Codex-Dream-Skin-Manager
AppSupportURL=https://github.com/xxloocee/Codex-Dream-Skin-Manager/issues
DefaultDirName={localappdata}\Programs\CodexDreamSkinManager
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#OutputDir}
OutputBaseFilename=CodexDreamSkinManager-v{#AppVersion}-setup
SetupIconFile=..\assets\CodexDreamSkinManager.ico
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
Uninstallable=yes
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoCompany=Codex Dream Skin
VersionInfoDescription={#AppName} installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："

[Files]
Source: "{#PackageRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent
