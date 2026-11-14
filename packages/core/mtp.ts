// Celulares conectados por cable (Android en "Transferencia de archivos" = MTP): Windows los muestra en el Explorador,
// pero no tienen letra de disco, así que un selector de carpetas no los ve. Este puente usa el Shell de Windows
// (Shell.Application, el mismo que usa el Explorador) desde un PowerShell aparte, que ya viene con Windows: lista los
// celulares y copia de a un archivo, esperando a que llegue entero (mismo tamaño). Nunca pisa ni borra nada en el celular.
// En otros sistemas no hay celulares para listar (devuelve una lista vacía).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { PhoneDevice } from '@paila/shared/types'
import { textos } from '@paila/shared/idioma'

const T = textos({
  noSeEncuentra: { es: (x: string) => `No se encuentra ${x}`, en: (x: string) => `Can't find ${x}` },
  yaNoAparece: { es: 'El celular ya no aparece: fijate que siga conectado y desbloqueado', en: "The phone doesn't show up anymore: check that it's still connected and unlocked" },
  noCarpeta: { es: (p: string) => `No se pudo crear la carpeta '${p}' en el celular`, en: (p: string) => `Couldn't create the folder '${p}' on the phone` },
  noEsCarpeta: { es: (p: string) => `'${p}' ya existe en el celular y no es una carpeta`, en: (p: string) => `'${p}' already exists on the phone and isn't a folder` },
  noSePisa: { es: 'Ya hay un archivo con ese nombre en el celular y es distinto: no se pisa', en: "There's already a different file with that name on the phone: it isn't overwritten" },
  incompleto: { es: 'No llegó completo al celular (¿se bloqueó la pantalla o se desconectó el cable?)', en: "It didn't reach the phone complete (did the screen lock or the cable come loose?)" },
  errorWindows: { es: 'Error de Windows al hablar con el celular', en: 'Windows error while talking to the phone' },
  noPowershell: { es: (e: string) => `No se pudo abrir PowerShell: ${e}`, en: (e: string) => `Couldn't open PowerShell: ${e}` },
  seCerro: { es: 'Se cerró el proceso que habla con el celular', en: 'The process that talks to the phone closed' },
  noContesto: { es: 'El celular no contestó a tiempo (¿está bloqueado o se desconectó?)', en: "The phone didn't answer in time (is it locked or disconnected?)" },
})

/**
 * El script de Windows (abajo) habla siempre en castellano: es código y no se traduce. Sus mensajes conocidos se pasan acá al
 * idioma de la pantalla (en castellano quedan iguales); los de Windows llegan como los da Windows.
 */
export function psMessage(m: string): string {
  let x: RegExpExecArray | null
  if ((x = /^No se encuentra (.+)$/.exec(m))) return T.noSeEncuentra(x[1])
  if ((x = /^No se pudo crear la carpeta '(.*)' en el celular$/.exec(m))) return T.noCarpeta(x[1])
  if ((x = /^'(.*)' ya existe en el celular y no es una carpeta$/.exec(m))) return T.noEsCarpeta(x[1])
  const fijos: Record<string, () => string> = {
    'El celular ya no aparece: fijate que siga conectado y desbloqueado': () => T.yaNoAparece,
    'Ya hay un archivo con ese nombre en el celular y es distinto: no se pisa': () => T.noSePisa,
    'No llegó completo al celular (¿se bloqueó la pantalla o se desconectó el cable?)': () => T.incompleto,
  }
  return fijos[m]?.() ?? m
}

/**
 * El lado de Windows. Habla por líneas en base64 (JSON en UTF-8) para que los acentos no dependan de la consola.
 * `Root` acepta también una carpeta común (C:\…): así las pruebas recorren el mismo camino sin un celular.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject Shell.Application
$cache = @{}
function Reply($id, $ok, $data, $err) {
  $j = ConvertTo-Json @{ id = $id; ok = $ok; data = $data; error = $err } -Compress -Depth 6
  [Console]::Out.WriteLine([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j)))
  [Console]::Out.Flush()
}
function FileName($it) {
  try { $n = $it.ExtendedProperty('System.FileName'); if ($n) { return [string]$n } } catch {}
  return [string]$it.Name
}
function SizeOf($it) {
  try { $s = $it.ExtendedProperty('System.Size'); if ($s -ne $null) { return [int64]$s } } catch {}
  try { return [int64]$it.Size } catch { return [int64]-1 }
}
function Num($it, $prop) { try { $v = $it.ExtendedProperty($prop); if ($v -ne $null) { return [int64]$v } } catch {}; return $null }
function IsDevice($it) {
  if (-not $it.IsFolder -or $it.IsFileSystem) { return $false }
  return ([string]$it.Path -match '\\\\\?\\') -or ([string]$it.Type -match 'port')
}
function Child($folder, $name) {
  try { $it = $folder.ParseName($name); if ($it -and ((FileName $it) -ieq $name -or $it.Name -ieq $name)) { return $it } } catch {}
  foreach ($it in $folder.Items()) { if ((FileName $it) -ieq $name -or $it.Name -ieq $name) { return $it } }
  return $null
}
function Root($id) {
  if ($id -match '^[A-Za-z]:\\') { $f = $shell.NameSpace($id); if (-not $f) { throw "No se encuentra $id" }; return $f }
  foreach ($it in $shell.NameSpace(17).Items()) { if ([string]$it.Path -eq $id) { return $it.GetFolder } }
  throw 'El celular ya no aparece: fijate que siga conectado y desbloqueado'
}
function Wait-Child($f, $p, $tries) {
  for ($i = 0; $i -lt $tries; $i++) { $c = Child $f $p; if ($c) { return $c }; Start-Sleep -Milliseconds 100 }
  return $null
}
function Open-Dir($id, $parts) {
  $key = $id + '|' + ($parts -join '/')
  if ($cache.ContainsKey($key)) { return $cache[$key] }
  $f = Root $id
  foreach ($p in $parts) {
    $c = Child $f $p
    if (-not $c) {
      try { [void]$f.NewFolder($p) } catch {}
      $c = Wait-Child $f $p 40
      if (-not $c) {
        # plan B: copiar una carpeta vacía con ese nombre (algunos celulares no aceptan "carpeta nueva")
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ('paila-dir-' + [guid]::NewGuid())
        $e = New-Item -ItemType Directory -Path (Join-Path $tmp $p) -Force
        [void]$f.CopyHere($e.FullName, 1556)
        $c = Wait-Child $f $p 100
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
      }
      if (-not $c) { throw "No se pudo crear la carpeta '$p' en el celular" }
    }
    if (-not $c.IsFolder) { throw "'$p' ya existe en el celular y no es una carpeta" }
    $f = $c.GetFolder
  }
  $cache[$key] = $f
  return $f
}
function Devices {
  $out = @()
  foreach ($it in $shell.NameSpace(17).Items()) {
    if (-not (IsDevice $it)) { continue }
    $st = @()
    try { foreach ($s in $it.GetFolder.Items()) { if ($s.IsFolder) { $st += @{ name = [string]$s.Name; free = (Num $s 'System.FreeSpace'); total = (Num $s 'System.Capacity') } } } } catch {}
    $out += @{ id = [string]$it.Path; name = [string]$it.Name; storages = $st }
  }
  return ,$out
}
function CopyOne($q) {
  $d = Open-Dir $q.root @($q.parts)
  $size = [int64]$q.size
  $ex = Child $d $q.name
  if ($ex) {
    if ((SizeOf $ex) -eq $size) { return 'already' }
    throw 'Ya hay un archivo con ese nombre en el celular y es distinto: no se pisa'
  }
  # 4 sin ventana de progreso + 16 sí a todo + 512 sin confirmar carpetas + 1024 sin ventanas de error
  [void]$d.CopyHere([string]$q.local, 1556)
  $deadline = (Get-Date).AddSeconds(30 + $size / 1MB)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 300
    $it = Child $d $q.name
    if ($it -and (SizeOf $it) -eq $size) { return 'sent' }
  }
  throw 'No llegó completo al celular (¿se bloqueó la pantalla o se desconectó el cable?)'
}
function Stat($q) {
  $d = Open-Dir $q.root @($q.parts)
  $it = Child $d $q.name
  if (-not $it) { return $null }
  return (SizeOf $it)
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not $line.Trim()) { continue }
  $id = -1
  try {
    $q = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim())) | ConvertFrom-Json
    $id = $q.id
    switch ($q.cmd) {
      'ping' { $r = 'ok' }
      'devices' { $r = Devices }
      'copy' { $r = CopyOne $q }
      'stat' { $r = Stat $q }
      default { throw "Pedido desconocido: $($q.cmd)" }
    }
    Reply $id $true $r $null
  } catch { Reply $id $false $null $_.Exception.Message }
}
`

type Pending = { ok: (v: unknown) => void; fail: (e: Error) => void; timer: NodeJS.Timeout }

/** Un PowerShell que queda abierto mientras se usa (arrancarlo tarda ~1 s); se cierra solo con `close()`. */
export class MtpBridge {
  private p: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private seq = 0
  private buf = ''

  constructor(private exe = 'powershell.exe') {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.p) return this.p
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
    const p = spawn(this.exe, ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    p.stdout.setEncoding('ascii')
    p.stdout.on('data', (d: string) => {
      this.buf += d
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (!line) continue
        let m: { id: number; ok: boolean; data: unknown; error: string | null }
        try { m = JSON.parse(Buffer.from(line, 'base64').toString('utf8')) } catch { continue } // ruido de la consola
        const w = this.pending.get(m.id)
        if (!w) continue
        this.pending.delete(m.id); clearTimeout(w.timer)
        if (m.ok) w.ok(m.data); else w.fail(new Error(m.error ? psMessage(m.error) : T.errorWindows))
      }
    })
    p.stderr.on('data', () => { /* los errores llegan como respuesta */ })
    const gone = (why: string) => {
      if (this.p === p) this.p = null
      for (const [id, w] of this.pending) { clearTimeout(w.timer); w.fail(new Error(why)); this.pending.delete(id) }
    }
    p.on('error', (e) => gone(T.noPowershell(e.message)))
    p.on('exit', () => gone(T.seCerro))
    this.p = p
    return p
  }

  /** Un pedido al lado de Windows. Si no contesta a tiempo se cierra el proceso (se rearma en el próximo pedido). */
  call<T>(cmd: string, args: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const p = this.ensure()
    const id = ++this.seq
    return new Promise<T>((ok, fail) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        fail(new Error(T.noContesto))
        this.close()
      }, timeoutMs)
      this.pending.set(id, { ok: ok as (v: unknown) => void, fail, timer })
      p.stdin.write(Buffer.from(JSON.stringify({ id, cmd, ...args }), 'utf8').toString('base64') + '\n')
    })
  }

  /** Los celulares (y reproductores) conectados por cable. Vacío fuera de Windows. */
  async devices(): Promise<PhoneDevice[]> {
    if (process.platform !== 'win32') return []
    type Raw = { id: string; name: string; storages: { name: string; free: number | null; total: number | null }[] | null }
    const raw = await this.call<Raw[] | Raw | null>('devices', {}, 30_000)
    return ([] as Raw[]).concat(raw ?? []).map((d) => ({
      id: d.id, name: d.name, apple: /iphone|ipad|ipod|apple/i.test(d.name),
      storages: ([] as NonNullable<Raw['storages']>).concat(d.storages ?? []).map((s) => ({ name: s.name, freeBytes: s.free ?? null, totalBytes: s.total ?? null })),
    }))
  }

  /** Copia un archivo a `parts` (almacenamiento/carpetas, se crean si faltan) y espera a que llegue con el mismo tamaño. */
  copy(root: string, parts: string[], local: string, name: string, size: number): Promise<'sent' | 'already'> {
    return this.call('copy', { root, parts, local, name, size }, (45 + size / 1e6) * 1000)
  }

  /** El tamaño de un archivo en el celular, o null si no está. */
  stat(root: string, parts: string[], name: string): Promise<number | null> {
    return this.call('stat', { root, parts, name }, 30_000)
  }

  close() {
    const p = this.p
    this.p = null
    if (p) { try { p.stdin.end(); p.kill() } catch { /* ya estaba cerrado */ } }
  }
}
