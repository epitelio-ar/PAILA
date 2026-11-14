// Lo que hace falta antes de bajar: que sockseek esté en la compu (si no, dónde conseguirlo) y que su configuración tenga
// la cuenta de Soulseek (NAPIA no la pide ni la guarda: explica cómo ponerla en la config de sockseek).
import { useState } from 'react'
import { Aviso, Boton, Caja, Info, Ruta } from '@paila/diseno'
import type { SockseekInfo } from '@paila/shared/napia'
import { textos } from '@paila/shared/idioma'
import { esMac } from '@paila/shared/teclas'
import { TIP } from './textos'

const T = textos({
  noEncontramos: { es: 'No encontramos sockseek en esta compu', en: "We couldn't find sockseek on this computer" },
  intro1: { es: 'NAPIA es el panel de control de ', en: 'NAPIA is the control panel for ' },
  intro2: { es: ', un programa aparte y gratuito que busca y baja de Soulseek', en: ', a separate, free program that searches and downloads from Soulseek' },
  intro3: { es: '. NAPIA no baja nada: le da la lista a sockseek y te muestra cómo va.', en: ". NAPIA doesn't download anything: it gives the list to sockseek and shows you how it's going." },
  paso1: { es: 'Bajá sockseek de su página (la versión para Windows) y guardalo donde quieras, por ejemplo en una carpeta "sockseek".', en: 'Download sockseek from its page (the Windows version) and save it wherever you like, for example in a "sockseek" folder.' },
  paso2a: { es: 'Volvé acá y tocá ', en: 'Come back here and click ' },
  yaLoTengo: { es: 'Ya lo tengo', en: 'I have it' },
  paso2b: { es: ' para decirle a NAPIA dónde quedó.', en: ' to tell NAPIA where it is.' },
  dondeConseguirlo: { es: 'Dónde conseguirlo', en: 'Where to get it' },
  yaLoTengoElegir: { es: 'Ya lo tengo: elegir dónde está', en: 'I have it: choose where it is' },
  faltaCuenta: { es: 'Falta tu cuenta de Soulseek', en: 'Your Soulseek account is missing' },
  necesita1: { es: 'sockseek necesita tu usuario y contraseña de Soulseek. ', en: 'sockseek needs your Soulseek username and password. ' },
  necesita2: { es: 'NAPIA no los pide ni los guarda:', en: "NAPIA doesn't ask for them or store them:" },
  necesita3: { es: ' se escriben una sola vez en la configuración de sockseek', en: " you enter them just once in sockseek's settings" },
  necesita4: { es: ', en tu compu.', en: ', on your computer.' },
  c1a: { es: 'Tocá ', en: 'Click ' },
  abrirConfig: { es: 'Abrir la configuración', en: 'Open the settings' },
  c1b: { es: ': se abre en el Bloc de notas', en: ': it opens in Notepad' },
  c1c: { es: ' (NAPIA la crea vacía, en la carpeta de sockseek)', en: ' (NAPIA creates it empty, in the sockseek folder)' },
  c2a: { es: 'Completá ', en: 'Fill in ' },
  c2b: { es: 'tu usuario y ', en: 'your username and ' },
  c2c: { es: 'tu contraseña. Si no tenés cuenta, inventá un usuario y una contraseña: Soulseek la crea la primera vez que entrás.', en: 'your password. If you have no account, make up a username and a password: Soulseek creates it the first time you sign in.' },
  c3a: { es: 'Guardá (Ctrl+G) y tocá ', en: 'Save (Ctrl+S) and click ' },
  yaLaPuse: { es: 'Ya la puse', en: 'I set it up' },
  seAbrio: { es: 'Se abrió en el Bloc de notas. Cuando guardes, tocá "Ya la puse".', en: 'It opened in Notepad. When you save, click "I set it up".' },
  // en Mac la configuración se abre con TextEdit (ajustes.ts) y se guarda con Cmd+S
  paso1Mac: { es: 'Bajá sockseek de su página (la versión para Mac) y guardalo donde quieras, por ejemplo en una carpeta "sockseek".', en: 'Download sockseek from its page (the Mac version) and save it wherever you like, for example in a "sockseek" folder.' },
  c1bMac: { es: ': se abre en TextEdit', en: ': it opens in TextEdit' },
  c3aMac: { es: 'Guardá (Cmd+S) y tocá ', en: 'Save (Cmd+S) and click ' },
  seAbrioMac: { es: 'Se abrió en TextEdit. Cuando guardes, tocá "Ya la puse".', en: 'It opened in TextEdit. When you save, click "I set it up".' },
})

export default function Preparar({ info, onChange, onRefresh }: { info: SockseekInfo | null; onChange: (i: SockseekInfo) => void; onRefresh: () => void }) {
  const [opened, setOpened] = useState<string | null>(null)
  if (!info) return null

  if (!info.exe) {
    return (
      <Caja pad className="preparar" head={<b>{T.noEncontramos}<Info tip={TIP.sockseek} /></b>}>
        <p>{T.intro1}<b>sockseek</b>{T.intro2}<Info tip={TIP.soulseek} />{T.intro3}</p>
        <ol className="pasos-cortos">
          <li>{esMac ? T.paso1Mac : T.paso1}</li>
          <li>{T.paso2a}<b>{T.yaLoTengo}</b>{T.paso2b}</li>
        </ol>
        <div className="row">
          <Boton onClick={() => window.napia.openSockseekPage()}>{T.dondeConseguirlo}</Boton>
          <Boton variant="ghost" onClick={async () => onChange(await window.napia.chooseExe())}>{T.yaLoTengoElegir}</Boton>
        </div>
      </Caja>
    )
  }

  if (info.hasUser && info.hasPass) return null
  return (
    <Caja pad className="preparar" head={<b>{T.faltaCuenta}<Info tip={TIP.soulseek} /></b>}>
      <p>{T.necesita1}<b>{T.necesita2}</b>{T.necesita3}<Info tip={TIP.config} />{T.necesita4}</p>
      <ol className="pasos-cortos">
        <li>{T.c1a}<b>{T.abrirConfig}</b>{esMac ? T.c1bMac : T.c1b}{info.config ? '' : T.c1c}.</li>
        <li>{T.c2a}<code>username = </code>{T.c2b}<code>password = </code>{T.c2c}</li>
        <li>{esMac ? T.c3aMac : T.c3a}<b>{T.yaLaPuse}</b>.</li>
      </ol>
      <Ruta ruta={info.config ?? info.configDefault} />
      <div className="row" style={{ marginTop: 'var(--sp-3)' }}>
        <Boton onClick={async () => setOpened(await window.napia.openConfig())}>{T.abrirConfig}</Boton>
        <Boton variant="ghost" onClick={onRefresh}>{T.yaLaPuse}</Boton>
      </div>
      {opened && <Aviso style={{ marginTop: 'var(--sp-3)' }}>{esMac ? T.seAbrioMac : T.seAbrio}</Aviso>}
    </Caja>
  )
}
