// Reconocedor tipo Shazam (AudD), OPCIONAL y apagado de fábrica (decidido el 20/10/2026): con la clave de cada
// usuario, solo para los temas que no se identificaron por datos, MusicBrainz, Deezer, Discogs ni AcoustID. Manda 15
// segundos de audio del medio del tema (en MP3 chico), nada más. Lo encontrado va a "para mirar a mano".
import { spawn } from 'node:child_process'
import { ERR, KeyError, Polite, realFetch, type FetchFn } from './http'
import { plainPunct } from './hits'

export const CLIP_SECONDS = 15
export interface AuddResult { artist: string; title: string; album: string | null; year: string | null }

/** 15 s del medio del tema, en MP3 mono de 64 kbps (~120 KB). null si no se pudo leer. */
export function audioClip(ffmpeg: string, file: string, duration: number | null): Promise<Uint8Array | null> {
  const start = duration && duration > CLIP_SECONDS * 2 ? Math.floor(duration / 2 - CLIP_SECONDS / 2) : 0
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(start), '-t', String(CLIP_SECONDS), '-i', file, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', '-f', 'mp3', 'pipe:1'], { windowsHide: true })
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', () => resolve(null))
    p.on('close', (code) => { const b = Buffer.concat(chunks); resolve(code === 0 && b.length > 1000 ? new Uint8Array(b) : null) })
  })
}

interface AuddRes { status: string; result?: { artist?: string; title?: string; album?: string; release_date?: string } | null; error?: { error_code?: number; error_message?: string } }
export class AudD {
  readonly http: Polite
  constructor(private token: string, ua: string, fetchFn: FetchFn = realFetch, gapMs = 1000) { this.http = new Polite('AudD', gapMs, fetchFn, ua) }

  async recognize(clip: Uint8Array): Promise<AuddResult | null> {
    const form = new FormData()
    form.append('api_token', this.token)
    form.append('file', new Blob([new Uint8Array(clip)], { type: 'audio/mpeg' }), 'fragmento.mp3')
    const j = await this.call(form)
    const r = j.result
    if (!r?.artist || !r.title) return null
    return { artist: plainPunct(r.artist), title: plainPunct(r.title), album: r.album ? plainPunct(r.album) : null, year: /^\d{4}/.test(r.release_date ?? '') ? r.release_date!.slice(0, 4) : null }
  }

  /** ¿Anda la clave? (un pedido sin audio: con clave mala AudD responde el error 900; con clave buena, "falta el archivo"). */
  async test(): Promise<void> {
    const form = new FormData()
    form.append('api_token', this.token)
    form.append('url', 'https://audd.tech/example.mp3')
    await this.call(form)
  }

  private async call(form: FormData): Promise<AuddRes> {
    const res = await this.http.get('https://api.audd.io/', {}, { method: 'POST', body: form })
    let j: AuddRes
    try { j = (await res.json()) as AuddRes } catch { throw new Error(ERR.respondio('AudD', res.status)) }
    if (j.status === 'success') return j
    const code = j.error?.error_code
    if (code === 900 || code === 901) throw new KeyError(ERR.clave('AudD'))
    throw new Error(`AudD: ${j.error?.error_message ?? `error ${code ?? res.status}`}`)
  }
}
