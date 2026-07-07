; Custom NSIS installer hooks for DealFlow AI (Windows).
; Ensures any running instance is closed before install/uninstall so files
; are not locked, and cleans up the custom protocol handler on uninstall.

!macro customInit
  ; Placeholder for future per-install customization.
!macroend

!macro customInstall
  ; Register nothing extra here; protocol registration is declared in
  ; electron-builder.yml (protocols:) and handled by the app at runtime.
!macroend

!macro customUnInstall
  ; Remove the custom URL protocol registration on uninstall.
  DeleteRegKey HKCU "Software\Classes\dealflow"
!macroend
