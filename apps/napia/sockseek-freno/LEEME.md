# sockseek con freno (para NAPIA)

**El problema.** Con el puerto de escucha cerrado (lo normal en una casa: el router no deja entrar conexiones), cada usuario de Soulseek que tiene lo que buscás le pide al servidor que lo llames vos. sockseek (con la librería Soulseek.NET) los llama **a todos a la vez**: con un tema popular, unas 5.000 conexiones en 3 segundos. Muchos routers de casa se llenan y dejan de dejar pasar conexiones nuevas (ni internet) por segundos o minutos, y las descargas no arrancan. Medido el 21/10/2026 en una PC hogareña, con el router común que da un proveedor de internet: 0 de 3 temas bajados, internet cortado hasta 2 minutos.

**El freno.** `freno.patch` cambia una sola cosa en Soulseek.NET 10.0.2: esos pedidos del servidor ("conectate con tal usuario", tipo P) pasan por una fila. Hay como mucho 48 en curso y arrancan 25 por segundo como máximo. Los que esperan más de 6 segundos se descartan: se pierden algunos resultados de búsqueda, nunca una descarga. Los usuarios de los que se está bajando pasan sin fila. Se puede ajustar sin rearmar, con `SOULSEEK_SOLICITED_MAX`, `SOULSEEK_SOLICITED_PER_SECOND` y `SOULSEEK_SOLICITED_WAIT_MS` (`SOULSEEK_SOLICITED_MAX=0` lo apaga). Además, el parche hace que sockseek use esa copia de Soulseek.NET en vez del paquete de NuGet.

Resultado en la misma PC: como mucho ~55 conexiones abriéndose a la vez, internet sin un solo corte, 3 de 3 temas bajados (y otras dos listas de prueba, bajadas también).

**Armarlo.** Hace falta el SDK de .NET 10 (`winget install Microsoft.DotNet.SDK.10`) y git:

```
powershell -ExecutionPolicy Bypass -File armar.ps1 -Trabajo C:\sockseek-freno
```

Baja sockseek v3.0.6 y Soulseek.NET 10.0.2 de GitHub (versiones fijas), aplica el parche y deja `publicado\sockseek.exe` (versión `3.0.6-napia.2`, unos 116 MB, no necesita instalar .NET). Usá una carpeta de ruta corta: con más de 260 caracteres, el armado de .NET falla.

Más fácil, desde la raíz del repositorio: `npm run sockseek:freno` lo arma y lo deja en `apps/napia/recursos/sockseek/sockseek.exe` (o `npm run sockseek:freno -- --desde <exe>` copia uno ya armado). El `.exe` no va al repositorio.

**Dónde lo busca NAPIA.** Primero el que elegiste a mano. Después el que viene con NAPIA: `apps/napia/recursos/sockseek/` (en el programa instalado, `resources/napia/recursos/sockseek/`, si el instalador lo lleva: ver `docs/DECISIONES.md`). Después, uno copiado en su carpeta de datos (`%APPDATA%\NAPIA\sockseek`). Recién al final busca el sockseek de siempre. NAPIA lo reconoce por la versión (`-napia`) y muestra "con freno (versión modificada)". Con un sockseek sin freno, avisa antes de bajar.

**Número de cliente propio.** Soulseek.NET pide que cada programa se identifique ante el servidor de Soulseek con un número propio. sockseek usa 800850000–800859999; esta versión modificada usa **826102100**.

**Licencias.** sockseek es **AGPL-3.0**; Soulseek.NET es **GPL-3.0 con términos adicionales**: decir en la interfaz y en la documentación que es una versión modificada, marcar los archivos cambiados, no hacerse pasar por el original y usar un número de cliente propio. Todo eso está hecho:
- el parche marca cada archivo;
- NAPIA dice "versión modificada";
- `apps/napia/recursos/sockseek/AVISO.txt` lleva el aviso y está junto a las tres licencias.

Quien lo reparta tiene que ofrecer el código: el de esas dos versiones más `freno.patch`.

This is a modified version of Soulseek.NET.  It is not maintained by, endorsed by, or affiliated with the Soulseek.NET project or its author(s).
