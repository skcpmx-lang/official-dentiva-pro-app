; Dentiva Pro — NSIS customisation.
;
; Uninstalling removes the application but keeps the clinic's data: the database, attachments, logs and
; backups in %APPDATA%\Dentiva Pro. Deleting patient records is a destructive act, so it happens only
; when the person uninstalling explicitly answers Yes to a question that defaults to No. The silent
; uninstall path (/S) always keeps the data — an unattended script must never be able to erase a clinic.
;
; Note for support: the folder that is removed is the one belonging to the Windows account running the
; uninstaller. On a shared machine each Windows account keeps its own Dentiva Pro data.

!macro customUnInstall
  IfSilent dentiva_keep_data
  MessageBox MB_YESNO|MB_ICONEXCLAMATION \
    "Also delete the clinic data (database, attachments, logs and backups) stored in $APPDATA\Dentiva Pro?$\r$\n$\r$\nChoose No to keep your clinic data. This cannot be undone." \
    /SD IDNO IDNO dentiva_keep_data
  RMDir /r "$APPDATA\Dentiva Pro"
  dentiva_keep_data:
!macroend

; The installer shows the licence before copying anything; declining cancels the installation.
!macro customInstall
!macroend
