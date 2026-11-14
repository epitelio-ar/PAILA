// IPC de la Fase C: claves de los servicios de internet (Discogs, AcoustID, AudD y Last.fm; cifradas por Windows, nunca vuelven a la interfaz),
// prueba de cada clave, la búsqueda de nombres oficiales (proceso largo) y el diccionario de artistas.
// La clave de aplicación de PAILA puede venir incluida al armar el instalador (claves.local.json, que no se sube al repo).
import fs from 'node:fs'
import { app, dialog, ipcMain, safeStorage } from 'electron'
import type { DictImport, DiscogsKeyInput, KeyService, KeyStatus, KeyTest, NamesStatus, OnlineKeysStatus } from '@paila/shared/types'
import { ArtistDict } from '@paila/core/artistdict'
import { cleanedRows, OfficialSearch, type OnlineKeys } from '@paila/core/official-run'
import { officialFindings, type NameRow } from '@paila/core/official-findings'
import { AcoustId, Discogs, type DiscogsKey } from '@paila/core/online/sources'
import { AudD, audioClip } from '@paila/core/online/audd'
import { LastFm } from '@paila/core/online/lastfm'
import { rulesOf, type TidyRule } from '@paila/shared/tidy-profiles'
import type { Ctx } from '../context'
import { servicios } from './albums'
import { avisarClaves } from '../chequeo'
import { cant, textos } from '@paila/shared/idioma'

// lo que se ve: avisos de las claves, el nombre de la tarea y los títulos de las ventanas de archivos. El nombre del archivo
// que se exporta ("diccionario-de-artistas.json") queda igual: lo crea PAILA.
const T = textos({
  claveLastfm: { es: 'Esa no parece una clave de Last.fm: la "API key" son 32 letras y números (la "Shared secret" no hace falta)', en: 'That does not look like a Last.fm key: the "API key" is 32 letters and numbers (the "Shared secret" is not needed)' },
  claveAudd: { es: 'Esa no parece una clave de AudD (letras y números, sin espacios)', en: 'That does not look like an AudD key (letters and numbers, no spaces)' },
  claveAcoustid: { es: 'Esa no parece una clave de aplicación de AcoustID (son unas 10 letras y números)', en: 'That does not look like an AcoustID application key (it is about 10 letters and numbers)' },
  revisar: { es: 'Revisá la clave: tiene que ser letras y números, sin espacios', en: 'Check the key: it has to be letters and numbers, no spaces' },
  sinClave: { es: (s: string) => `No hay clave de ${s}`, en: (s: string) => `There is no ${s} key` },
  funciona: { es: 'Funciona', en: 'It works' },
  sinInternet: { es: 'No hay conexión a internet (o el servicio no responde)', en: 'There is no internet connection (or the service is not answering)' },
  buscando: { es: 'Buscando nombres oficiales', en: 'Searching for official names' },
  aviso: { es: 'aviso', en: 'warning' },
  hechas: {
    es: (n: number, found: number) => `Se hicieron ${n} búsquedas; ${found} temas con resultados. Las propuestas están en "Arreglar nombres y tags", perfil Oficial`,
    en: (n: number, found: number) => `${cant(n, 'search was', 'searches were')} made; ${cant(found, 'track', 'tracks')} with results. The suggestions are in "Fix names and tags", Official profile`,
  },
  exportarTitulo: { es: 'Exportar el diccionario de artistas', en: 'Export the artist dictionary' },
  importarTitulo: { es: 'Importar un diccionario de artistas', en: 'Import an artist dictionary' },
  filtro: { es: 'Diccionario de PAILA', en: 'PAILA dictionary' },
  exportados: { es: (n: number, f: string) => `Se exportaron ${n} nombres a ${f}`, en: (n: number, f: string) => `${cant(n, 'name was', 'names were')} exported to ${f}` },
})

declare const __PAILA_CLAVES__: { discogsKey?: string; discogsSecret?: string; acoustid?: string; lastfm?: string } | undefined
/** Claves que vienen con PAILA (solo en el instalador armado con claves.local.json). */
const BUILT_IN = typeof __PAILA_CLAVES__ !== 'undefined' && __PAILA_CLAVES__ ? __PAILA_CLAVES__ : {}

const K = { discogs: 'claves.discogs', acoustid: 'claves.acoustid', audd: 'claves.audd', lastfm: 'claves.lastfm', test: (s: KeyService) => `claves.prueba.${s}`, deezer: 'online.deezer', auddOn: 'online.audd' }

export function registerOnline(c: Ctx) {
  const ua = `PAILA/${app.getVersion()} (https://github.com/epitelio-ar/PAILA)`
  const dict = new ArtistDict(c.lib.db)

  // ---- claves: cifradas con la cuenta de Windows (safeStorage); si no se puede cifrar, se guardan tal cual en la base local ----
  const seal = (v: string) => (safeStorage.isEncryptionAvailable() ? `dpapi:${safeStorage.encryptString(v).toString('base64')}` : `plano:${v}`)
  const open = (v: string | null): string | null => {
    if (!v) return null
    try { return v.startsWith('dpapi:') ? safeStorage.decryptString(Buffer.from(v.slice(6), 'base64')) : v.startsWith('plano:') ? v.slice(6) : null } catch { return null }
  }
  const own = {
    discogs: (): DiscogsKey | null => { const v = open(c.setting(K.discogs)); try { return v ? JSON.parse(v) as DiscogsKey : null } catch { return null } },
    acoustid: (): string | null => open(c.setting(K.acoustid)),
    audd: (): string | null => open(c.setting(K.audd)),
    lastfm: (): string | null => open(c.setting(K.lastfm)),
  }
  const useAudd = () => c.setting(K.auddOn) === '1'
  const keys = (): OnlineKeys => ({
    discogs: own.discogs() ?? (BUILT_IN.discogsKey && BUILT_IN.discogsSecret ? { key: BUILT_IN.discogsKey, secret: BUILT_IN.discogsSecret } : null),
    acoustid: own.acoustid() ?? BUILT_IN.acoustid ?? null,
    audd: useAudd() ? own.audd() : null, // AudD: solo con la clave de cada uno y si lo prendió
    lastfm: own.lastfm() ?? BUILT_IN.lastfm ?? null,
  })
  const lastTest = (s: KeyService): KeyTest | null => { try { const v = c.setting(K.test(s)); return v ? JSON.parse(v) as KeyTest : null } catch { return null } }
  const useDeezer = () => c.setting(K.deezer) !== '0'
  // la pantalla Discos (electron/ipc/albums.ts) usa las mismas claves y la misma preferencia de Deezer
  c.onlineKeys = keys
  c.useDeezer = useDeezer
  const status = (): OnlineKeysStatus => {
    const d = own.discogs()
    const discogs: KeyStatus = { own: !!d, ...(d ? { kind: 'token' in d ? 'token' as const : 'app' as const } : {}), builtIn: !!(BUILT_IN.discogsKey && BUILT_IN.discogsSecret), test: lastTest('discogs') }
    const acoustid: KeyStatus = { own: !!own.acoustid(), builtIn: !!BUILT_IN.acoustid, test: lastTest('acoustid') }
    const audd: KeyStatus = { own: !!own.audd(), builtIn: false, test: lastTest('audd') }
    const lastfm: KeyStatus = { own: !!own.lastfm(), builtIn: !!BUILT_IN.lastfm, test: lastTest('lastfm') }
    return { discogs, acoustid, audd, lastfm, deezer: useDeezer(), auddOn: useAudd(), secure: safeStorage.isEncryptionAvailable() }
  }
  const clearTest = (s: KeyService) => c.lib.db.prepare('DELETE FROM settings WHERE key = ?').run(K.test(s))

  ipcMain.handle('online:keys', () => status())
  ipcMain.handle('online:setKey', (_e, s: KeyService, v: DiscogsKeyInput | string | null) => {
    clearTest(s)
    if (v == null) { c.lib.db.prepare('DELETE FROM settings WHERE key = ?').run(K[s]); return status() }
    if (s === 'lastfm') {
      const k = String(v).trim()
      if (!/^[0-9a-f]{32}$/i.test(k)) throw new Error(T.claveLastfm)
      c.setSetting(K.lastfm, seal(k))
    } else if (s === 'acoustid' || s === 'audd') {
      const k = String(v).trim()
      if (!/^[\w-]{6,64}$/.test(k)) throw new Error(s === 'audd' ? T.claveAudd : T.claveAcoustid)
      c.setSetting(K[s], seal(k))
    } else {
      const d = v as DiscogsKeyInput
      const clean = 'token' in d ? { token: d.token.trim() } : { key: d.key.trim(), secret: d.secret.trim() }
      if (Object.values(clean).some((x) => !/^[\w-]{6,80}$/.test(x))) throw new Error(T.revisar)
      c.setSetting(K.discogs, seal(JSON.stringify(clean)))
    }
    return status()
  })
  const probar = async (s: KeyService): Promise<KeyTest> => {
    const k = keys()
    let r: KeyTest
    try {
      if (s === 'discogs') { if (!k.discogs) throw new Error(T.sinClave('Discogs')); await new Discogs(k.discogs, ua, undefined, 0).test() }
      else if (s === 'acoustid') { if (!k.acoustid) throw new Error(T.sinClave('AcoustID')); await new AcoustId(k.acoustid, ua, undefined, 0).test() }
      else if (s === 'lastfm') { if (!k.lastfm) throw new Error(T.sinClave('Last.fm')); await new LastFm(k.lastfm, ua, undefined, 0).test() }
      else { const t = own.audd(); if (!t) throw new Error(T.sinClave('AudD')); await new AudD(t, ua, undefined, 0).test() }
      r = { ok: true, msg: T.funciona, at: new Date().toISOString() }
    } catch (e) {
      const m = (e as Error).message
      r = { ok: false, msg: /fetch failed|ENOTFOUND|ECONN|network/i.test(m) ? T.sinInternet : m, at: new Date().toISOString() }
    }
    c.setSetting(K.test(s), JSON.stringify(r))
    return r
  }
  // para el Chequeo: si hay clave (propia o de PAILA) y cómo salió, nunca su valor
  c.probarClave = async (s) => {
    if (!keys()[s]) return { hay: false }
    const r = await probar(s)
    return { hay: true, ok: r.ok, sinInternet: !r.ok && r.msg === T.sinInternet, msg: r.msg }
  }
  ipcMain.handle('online:testKey', (_e, s: KeyService) => probar(s))
  ipcMain.handle('online:setDeezer', (_e, on: boolean) => { c.setSetting(K.deezer, on ? '1' : '0'); return status() })
  ipcMain.handle('online:setAudd', (_e, on: boolean) => { c.setSetting(K.auddOn, on ? '1' : '0'); return status() })

  // ---- nombres oficiales ----
  const clip = async (id: number, duration: number | null) => { const f = c.lib.trackPath(id); return f ? audioClip(c.ffmpeg, f, duration) : null }
  const search = new OfficialSearch(c.lib.db, { ua, keys, useDeezer, clip })
  // los temas como los deja el asistente (con las reglas elegidas); se guardan un minuto: armarlos lleva unos segundos
  let rowsMemo: { at: number; rows: NameRow[] } | null = null
  const savedRules = (): TidyRule[] => { try { const v = c.setting('tidy.reglas'); return v ? JSON.parse(v) as TidyRule[] : rulesOf('oficial') } catch { return rulesOf('oficial') } }
  const rows = () => {
    if (!rowsMemo || Date.now() - rowsMemo.at > 60_000) rowsMemo = { at: Date.now(), rows: cleanedRows(c.lib.db, savedRules()) }
    return rowsMemo.rows
  }
  // cuántos temas tienen algo para revisar: se recalcula solo si cambió lo buscado o los temas
  let propMemo: { stamp: string; n: number } | null = null
  const proposals = (): number => {
    const r = rows(), stamp = `${rowsMemo?.at}|${JSON.stringify(search.cache.counts())}`
    if (propMemo?.stamp !== stamp) propMemo = { stamp, n: [...officialFindings(c.lib.db, r).values()].filter((f) => f.length).length }
    return propMemo.n
  }
  ipcMain.handle('names:status', (): NamesStatus => {
    const t = search.todo(rows())
    // medido el 20/10: MusicBrainz ~2 s por tema (a veces pide dos búsquedas), Deezer ~0,8 s
    const minutes = Math.ceil(Math.max(t.musicbrainz * 2, t.deezer * 0.8, t.discogs * 1.2, t.acoustid * 0.45) / 60)
    return { tracks: t.tracks, artists: t.artists, unnamed: t.unnamed, left: { musicbrainz: t.musicbrainz, deezer: t.deezer, discogs: t.discogs, acoustid: t.acoustid, audd: t.audd }, done: search.cache.counts(), minutes, proposals: proposals() }
  })
  // MusicBrainz permite un pedido por segundo en total y Discogs 60 por minuto: con otra búsqueda que los usa, espera en fila
  const correr = (retry: boolean) => c.jobs.run('names', T.buscando,
    async (h) => {
      if (retry) search.cache.forgetErrors()
      rowsMemo = null
      const r = await search.run(rows(), (p) => h.update({ done: p.done, total: p.total, current: p.current, found: p.found }), h.cancelled)
      const stopped = Object.entries(r.bySource).filter(([, v]) => v?.stopped).map(([, v]) => v!.stopped!)
      if (stopped.length) h.update({ problems: stopped.map((m) => ({ name: T.aviso, error: m })) })
      avisarClaves(c, r.bySource)
      return r
    },
    (r) => T.hechas(r.done, r.found), servicios(!!keys().discogs))
  ipcMain.handle('names:run', (_e, retry: boolean) => correr(retry))
  c.internet = { ...c.internet, nombres: () => correr(false) }

  // ---- diccionario de artistas ----
  ipcMain.handle('dict:list', () => dict.list())
  ipcMain.handle('dict:set', (_e, from: string, to: string) => { dict.set(from, to, 'a mano'); return dict.list() })
  ipcMain.handle('dict:remove', (_e, from: string) => { dict.remove(from); return dict.list() })
  ipcMain.handle('dict:export', async () => {
    const r = await dialog.showSaveDialog(c.win()!, { title: T.exportarTitulo, defaultPath: 'diccionario-de-artistas.json', filters: [{ name: T.filtro, extensions: ['json'] }] })
    if (r.canceled || !r.filePath) return null
    fs.writeFileSync(r.filePath, dict.export(), 'utf8')
    return T.exportados(dict.list().length, r.filePath)
  })
  ipcMain.handle('dict:import', async (): Promise<DictImport | null> => {
    const r = await dialog.showOpenDialog(c.win()!, { title: T.importarTitulo, properties: ['openFile'], filters: [{ name: T.filtro, extensions: ['json'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return dict.import(fs.readFileSync(r.filePaths[0], 'utf8'))
  })
}
