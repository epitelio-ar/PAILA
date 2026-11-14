// IPC de "mejorar la calidad": reemplazo de un tema por otro mejor y lista de deseos por disco (la Bandeja y la lista por tema: ipc/inbox.ts).
import fs from 'node:fs'
import path from 'node:path'
import { dialog, ipcMain, shell } from 'electron'
import { describeCandidate } from '@paila/core/replace'
import { WorkerPool } from '@paila/core/analysis/pool'
import type { WishStatus } from '@paila/core/wishlist'
import { spectrogram } from '../media'
import type { Ctx } from '../context'
import { textos } from '@paila/shared/idioma'

// Lo que se ve al elegir el archivo nuevo para reemplazar uno (la ventana y los avisos de la comparación).
const T = textos({
  elegi: { es: 'Elegí el archivo nuevo', en: 'Choose the new file' },
  noDisponible: { es: 'El tema no está disponible', en: "The track isn't available" },
  duracion: {
    es: (a: number, b: number) => `La duración es distinta (${a} s el actual, ${b} s el nuevo): puede ser otra versión o un tema distinto.`,
    en: (a: number, b: number) => `The length is different (${a} s now, ${b} s the new one): it may be another version or a different track.`,
  },
  noMejora: { es: 'El archivo nuevo no tiene mejor nota que el actual: no parece una mejora.', en: "The new file doesn't have a better grade than the current one: it doesn't look like an improvement." },
  volumen: {
    es: (db: string) => `El volumen cambia ${db} dB: probablemente es otro master.`,
    en: (db: string) => `The volume changes by ${db} dB: it's probably a different master.`,
  },
})

const RANK: Record<string, number> = { 'A+': 0, A: 1, B: 2, C: 3, D: 4, F: 5 }

export function registerQuality(c: Ctx) {
  const { lib, replacer, wishlist } = c

  // ---- reemplazo ----
  ipcMain.handle('rep:pick', async () => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.elegi, properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['flac', 'wav', 'aiff', 'aif', 'mp3', 'm4a', 'ogg', 'opus', 'alac'] }] })
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('rep:compare', async (_e, id: number, candidate: string) => {
    const cur = lib.trackFile(id)
    if (!cur) throw new Error(T.noDisponible)
    const tmp = new WorkerPool(path.join(__dirname, 'analysis-worker.js'), 1)
    try {
      const cand = await describeCandidate(tmp, c.ffprobe, c.ffmpeg, candidate)
      const a = lib.getAnalysis(id)
      const row = lib.tracks(id)[0]
      const spectroDir = path.join(c.userData, 'spectro')
      const curDur = row[10] as number | null
      const side = async (file: { path: string; size: number; mtime: number; ext: string; codec: string | null }, key: number, dur: number | null) => {
        try { return await spectrogram(c.ffmpeg, spectroDir, key, file, true, dur) } catch { return null }
      }
      const cst = fs.statSync(candidate)
      const [specCur, specNew] = await Promise.all([side(cur, id, curDur), side({ path: candidate, size: cst.size, mtime: cst.mtimeMs, ext: cand.ext, codec: cand.codec }, -1, cand.duration)])
      const warnings: string[] = []
      if (curDur && cand.duration && Math.abs(curDur - cand.duration) > 5) warnings.push(T.duracion(Math.round(curDur), Math.round(cand.duration)))
      if (a?.grade && (RANK[cand.grade] ?? 9) >= (RANK[a.grade] ?? 9)) warnings.push(T.noMejora)
      if (a?.lufs != null && cand.lufs != null && Math.abs(a.lufs - cand.lufs) >= 2) warnings.push(T.volumen(Math.abs(a.lufs - cand.lufs).toFixed(1)))
      return {
        current: { ext: cur.ext, codec: cur.codec, kbps: row[9] as number | null, sampleRate: row[6] as number | null, bits: row[7] as number | null, duration: curDur, size: cur.size, grade: a?.grade ?? null, label: a?.isLabel ?? null, lufs: a?.lufs ?? null, cutoff: a?.cutoff ?? null, why: a?.why ?? [], spectrogram: specCur },
        candidate: { path: candidate, ext: cand.ext, codec: cand.codec, kbps: cand.kbps, sampleRate: cand.sampleRate, bits: cand.bits, duration: cand.duration, size: cand.size, grade: cand.grade, label: cand.label, lufs: cand.lufs, cutoff: cand.cutoff, why: cand.why, spectrogram: specNew, artist: cand.artist, title: cand.title },
        warnings,
        audio: { current: `paila://audio/${id}`, candidate: `paila://audio/${c.registerCandidate(candidate)}` },
      }
    } finally { await tmp.close() }
  })
  ipcMain.handle('rep:apply', async (_e, id: number, candidate: string, o: { keepTags: boolean; keepCover: boolean; sameName: boolean }) => {
    return c.withPaused(async () => (await replacer.replace(id, candidate, o)).newRel)
  })
  ipcMain.handle('rep:list', () => replacer.list())
  ipcMain.handle('rep:undo', (_e, id: number) => c.withPaused(() => replacer.undo(id)))

  // ---- lista de deseos ----
  ipcMain.handle('wl:list', (_e, g: 'C' | 'D' | 'F') => wishlist.list(g))
  ipcMain.handle('wl:status', (_e, k: string, s: WishStatus, n?: string) => wishlist.setStatus(k, s, n))
  ipcMain.handle('wl:open', (_e, site: string, a: string, b: string) => shell.openExternal(wishlist.searchUrl(site, a, b)))
}
