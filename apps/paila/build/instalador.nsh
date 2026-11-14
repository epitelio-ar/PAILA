; Instalador de la familia PAILA (lo incluye electron-builder: "nsis.include" en apps/paila/package.json).
; Suma una página con la casilla de NAPIA, tildada de fábrica (decisión del 20/10): NAPIA usa el mismo motor que PAILA
; (PAILA.exe --napia), así que instalarla es solo crear su acceso directo, con su ícono y su nombre. Quien la destilda no ve
; NAPIA en ningún lado. Instalación sin preguntas (/S): con NAPIA; para sacarla, /SIN-NAPIA.
; En castellano o en inglés, según Windows (installerLanguages en package.json): los textos propios van en LangString.

!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER
  Var NapiaOn
  Var NapiaCasilla
!endif

; los textos de esta página en los dos idiomas (3082 = castellano, 1033 = inglés); van en customHeader, cuando ya están cargados
!macro customHeader
  LangString napiaSub 3082 "El panel de control para sockseek, de la familia PAILA"
  LangString napiaSub 1033 "The control panel for sockseek, from the PAILA family"
  LangString napiaTexto 3082 "NAPIA es el segundo programa de la familia: un panel para usar sockseek (el programa que baja de Soulseek) sin escribir comandos. Le das una lista de temas, por ejemplo la lista «Faltan o suenan mal» de PAILA, y te muestra cómo va.$\r$\n$\r$\nTrae sockseek adentro, ya listo para usar: no hay que instalar nada más. Ocupa casi nada: usa el mismo motor que PAILA."
  LangString napiaTexto 1033 "NAPIA is the second program in the family: a panel for using sockseek (the program that downloads from Soulseek) without typing commands. You give it a list of tracks, for example PAILA's $\"Missing or low quality$\" list, and it shows you how it's going.$\r$\n$\r$\nIt comes with sockseek inside, ready to use: there is nothing else to install. It takes up almost no space: it uses the same engine as PAILA."
  LangString napiaCasilla 3082 "Instalar también NAPIA (con su acceso directo en el escritorio y en el menú Inicio)"
  LangString napiaCasilla 1033 "Also install NAPIA (with its shortcut on the desktop and in the Start menu)"
  LangString napiaAcceso 3082 "Panel de control para sockseek"
  LangString napiaAcceso 1033 "Control panel for sockseek"
!macroend

!macro customInit
  StrCpy $NapiaOn ${BST_CHECKED}
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/SIN-NAPIA" $R1
  ${IfNot} ${Errors}
    StrCpy $NapiaOn ${BST_UNCHECKED}
  ${EndIf}
  ; al actualizar se respeta lo que se eligió la primera vez: si no está su acceso directo, NAPIA no se había instalado
  ${If} ${isUpdated}
  ${AndIfNot} ${FileExists} "$SMPROGRAMS\NAPIA.lnk"
    StrCpy $NapiaOn ${BST_UNCHECKED}
  ${EndIf}
!macroend

; las funciones van adentro de la macro: se arman ahí, cuando el instalador ya tiene las páginas de MUI2
!macro customPageAfterChangeDir
  Page custom NapiaPagina NapiaPaginaSalir

  Function NapiaPagina
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "NAPIA" "$(napiaSub)"
    nsDialogs::Create 1018
    Pop $0
    ${NSD_CreateLabel} 0 0 100% 52u "$(napiaTexto)"
    Pop $0
    ${NSD_CreateCheckbox} 0 64u 100% 14u "$(napiaCasilla)"
    Pop $NapiaCasilla
    ${NSD_SetState} $NapiaCasilla $NapiaOn
    nsDialogs::Show
  FunctionEnd

  Function NapiaPaginaSalir
    ${NSD_GetState} $NapiaCasilla $NapiaOn
  FunctionEnd
!macroend

!macro customInstall
  Delete "$SMPROGRAMS\NAPIA.lnk"
  Delete "$DESKTOP\NAPIA.lnk"
  ${If} $NapiaOn == ${BST_CHECKED}
    CreateShortCut "$SMPROGRAMS\NAPIA.lnk" "$appExe" "--napia" "$INSTDIR\resources\napia\build\icon.ico" 0 "" "" "$(napiaAcceso)"
    ClearErrors
    WinShell::SetLnkAUMI "$SMPROGRAMS\NAPIA.lnk" "ar.paila.napia"
    CreateShortCut "$DESKTOP\NAPIA.lnk" "$appExe" "--napia" "$INSTDIR\resources\napia\build\icon.ico" 0 "" "" "$(napiaAcceso)"
    ClearErrors
    WinShell::SetLnkAUMI "$DESKTOP\NAPIA.lnk" "ar.paila.napia"
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${EndIf}
!macroend

!macro customUnInstall
  ; al actualizar, el instalador nuevo los vuelve a crear si NAPIA sigue tildada
  ${IfNot} ${isUpdated}
    WinShell::UninstShortcut "$SMPROGRAMS\NAPIA.lnk"
    Delete "$SMPROGRAMS\NAPIA.lnk"
    WinShell::UninstShortcut "$DESKTOP\NAPIA.lnk"
    Delete "$DESKTOP\NAPIA.lnk"
  ${EndIf}
!macroend
