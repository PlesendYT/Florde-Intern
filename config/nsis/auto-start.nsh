Var AutoStartCheckbox

!macro customInstallPage
  Page custom autoStartCreate autoStartLeave
!macroend

Function autoStartCreate
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 20u "Startup Options"
  Pop $0
  ${NSD_CreateCheckBox} 0 30 100% 12u "Launch Florde on Windows startup"
  Pop $AutoStartCheckbox
  ${NSD_SetState} $AutoStartCheckbox ${BST_CHECKED}
  nsDialogs::Show
FunctionEnd

Function autoStartLeave
  ${NSD_GetState} $AutoStartCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Florde" "$INSTDIR\Florde.exe"
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Florde"
  ${EndIf}
FunctionEnd
