# Native macOS manager

Approved direction: native SwiftUI window hosted by the existing AppKit application.
The dashboard follows Windows: searchable/filterable thumbnail library and selected-theme preview with apply controls. Imports and settings occupy separate tabs. Existing menu actions and their runtime locking, restart prompts and validation remain authoritative.
The window reads the existing saved-theme library. Settings save a new theme copy, preserving the original. Video preview uses AVKit; thumbnails use ImageIO / AVFoundation off the UI thread. Closing the window keeps the menu app alive; launch and reopen show the manager.
Deliver a local app build separately from the installed app. No automatic skin application, tests or visual verification in this task.
