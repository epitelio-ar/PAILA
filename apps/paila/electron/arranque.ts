// Arranque del programa instalado: el mismo motor abre PAILA o, con `--napia` (el acceso directo de NAPIA del instalador),
// NAPIA, el panel de control para sockseek. NAPIA viene armada aparte (apps/napia/out) y el instalador la deja en
// resources/napia; en desarrollo se usa la de apps/napia. Sin `--napia`, todo sigue exactamente como antes (main.js).
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const napia = app.isPackaged ? path.join(process.resourcesPath, 'napia', 'out', 'main', 'main.js') : path.join(__dirname, '../../../napia/out/main/main.js')
require(process.argv.includes('--napia') && fs.existsSync(napia) ? napia : path.join(__dirname, 'main.js'))
