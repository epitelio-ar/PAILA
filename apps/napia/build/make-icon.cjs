// Arma los íconos y el logo de NAPIA desde el dibujo original (build/arte/napia-original.jpg). La lógica está en scripts/iconos/motor.cjs.
// Uso: node_modules/electron/dist/electron.exe apps/napia/build/make-icon.cjs [--lamina=salida.png]
require('../../../scripts/iconos/motor.cjs').correr('napia')
