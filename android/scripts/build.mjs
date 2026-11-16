#!/usr/bin/env node
/**
 * Construye la app Android (ADR 0020):
 *   npm run build && npm run release:android [-- --debug] [--abi=arm64-v8a] [--skip-natives]
 *
 * 1. Binarios nativos (android/scripts/natives.mjs) si faltan.
 * 2. Carpeta app/ igual que la portable (scripts/stage-app.mjs) → android/app/src/main/assets/app.zip.
 * 3. Gradle (wrapper de android/) con el SDK y el JDK detectados.
 * 4. APK firmados en release/: survival-os-<v>-android-arm64.apk y -x86_64.apk (+ .sha256).
 *
 * Firma: clave propia en .data/android-keystore.jks (fuera de Git), creada la primera vez. ¡Consérvala! Sin ella no
 * se puede publicar una actualización que Android acepte sobre la versión instalada.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { missingBuild, stageApp, writeZip } from '../../scripts/stage-app.mjs'
import { ABIS } from './natives.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const ANDROID = join(ROOT, 'android')
const OUT = join(ROOT, 'release')
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const debug = process.argv.includes('--debug')
const abis = (process.argv.find((a) => a.startsWith('--abi='))?.slice(6) ?? Object.keys(ABIS).join(',')).split(',')
const say = (m) => console.log(`[android] ${m}`)
const fail = (m) => {
  console.error(`[android] ERROR: ${m}`)
  process.exit(1)
}
const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')
const win = process.platform === 'win32'

// ------------------------------------------------------------------ herramientas

function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', win ? 'java.exe' : 'java'))) return process.env.JAVA_HOME
  // Instalación por usuario de Temurin (la que deja preparada el agente en Windows).
  const base = join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Temurin')
  if (existsSync(base)) {
    const jdk = readdirSync(base).filter((d) => d.startsWith('jdk-')).sort().pop()
    if (jdk) return join(base, jdk)
  }
  return null
}
function findSdk() {
  for (const p of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk'), join(process.env.HOME ?? '', 'Android', 'Sdk')]) {
    if (p && existsSync(join(p, 'platforms'))) return p
  }
  return null
}

const javaHome = findJavaHome()
const sdk = findSdk()
if (!javaHome) fail('No se encuentra un JDK 17+ (JAVA_HOME)')
if (!sdk) fail('No se encuentra el Android SDK (ANDROID_HOME)')
const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk }
writeFileSync(join(ANDROID, 'local.properties'), `sdk.dir=${sdk.replaceAll('\\', '/')}\n`)

// ------------------------------------------------------------------ 1. nativos

const need = ['libnode.so', 'libkiwix-serve.so', 'libkiwix-manage.so', 'libllama-server.so', 'libpmtiles.so']
const missingAbis = abis.filter((a) => need.some((f) => !existsSync(join(ANDROID, 'app', 'src', 'main', 'jniLibs', a, f))))
const jar = join(ANDROID, 'app', 'libs', 'brouter-1.7.10-all.jar')
if ((missingAbis.length || !existsSync(jar)) && !process.argv.includes('--skip-natives')) {
  say(`Preparando binarios nativos (${missingAbis.join(', ') || 'BRouter'})…`)
  const r = spawnSync(process.execPath, [join(HERE, 'natives.mjs'), `--abi=${(missingAbis.length ? missingAbis : abis).join(',')}`], { stdio: 'inherit', env })
  if (r.status !== 0) fail('no se pudieron preparar los binarios nativos')
}
// Solo las ABI pedidas: las demás carpetas de jniLibs se apartan durante la compilación.
for (const a of Object.keys(ABIS)) {
  const dir = join(ANDROID, 'app', 'src', 'main', 'jniLibs', a)
  const parked = join(ROOT, '.data', 'android-cache', 'parked', a)
  if (!abis.includes(a) && existsSync(dir)) {
    rmSync(parked, { recursive: true, force: true })
    mkdirSync(dirname(parked), { recursive: true })
    renameSync(dir, parked)
  }
}

// ------------------------------------------------------------------ 2. app.zip

for (const f of missingBuild(ROOT)) fail(`Falta ${f}. Ejecuta "npm run build" primero.`)
const stage = join(ROOT, '.data', 'android-cache', 'stage', 'app')
rmSync(dirname(stage), { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
stageApp(ROOT, stage, version)
const lock = JSON.parse(readFileSync(join(ANDROID, 'natives.lock.json'), 'utf8'))
const natives = { ...lock.components }
// pdftotext solo si se ha compilado (componente opcional: sin él los manuales se leen igual, sin búsqueda).
if (!abis.every((a) => existsSync(join(ANDROID, 'app', 'src', 'main', 'jniLibs', a, 'libpdftotext.so')))) delete natives.xpdf
writeFileSync(join(stage, 'android-natives.json'), `${JSON.stringify(natives, null, 2)}\n`)
const catalog = JSON.parse(readFileSync(join(ROOT, 'content', 'catalog.json'), 'utf8'))
for (const c of ['kiwix-tools', 'llama', 'pmtiles', 'brouter']) {
  if (natives[c] !== catalog.components[c].version) fail(`${c}: el APK lleva ${natives[c]} y el catálogo ${catalog.components[c].version}; ejecuta android/scripts/natives.mjs --update-lock`)
}
const assets = join(ANDROID, 'app', 'src', 'main', 'assets')
mkdirSync(assets, { recursive: true })
const zip = join(assets, 'app.zip')
const files = writeZip(stage, zip, '')
writeFileSync(join(assets, 'app-files.txt'), `${files}\n`)
writeFileSync(join(assets, 'app-build.txt'), `${version}-${sha256(zip).slice(0, 16)}\n`)
say(`app.zip: ${files} ficheros, ${(statSync(zip).size / 1024 ** 2).toFixed(0)} MB`)

// ------------------------------------------------------------------ 3. firma y Gradle

const ksFile = join(ROOT, '.data', 'android-keystore.jks')
const ksPass = join(ROOT, '.data', 'android-keystore.pass')
if (!debug && !existsSync(ksFile)) {
  const pass = randomBytes(18).toString('base64url')
  const keytool = join(javaHome, 'bin', win ? 'keytool.exe' : 'keytool')
  const r = spawnSync(keytool, ['-genkeypair', '-keystore', ksFile, '-storetype', 'PKCS12', '-alias', 'survival-os', '-keyalg', 'RSA', '-keysize', '4096', '-validity', '10000', '-dname', 'CN=Survival OS', '-storepass:env', 'KS_PASS', '-keypass:env', 'KS_PASS'], { stdio: 'inherit', env: { ...env, KS_PASS: pass } })
  if (r.status !== 0) fail('keytool no pudo crear la clave de firma')
  writeFileSync(ksPass, pass, { mode: 0o600 })
  say(`Clave de firma creada en ${ksFile}. CONSÉRVALA (y ${ksPass}): sin ella no se puede actualizar la app instalada.`)
}
const gradlew = join(ANDROID, win ? 'gradlew.bat' : 'gradlew')
if (!existsSync(gradlew)) fail('Falta el wrapper de Gradle en android/')
const task = debug ? 'assembleDebug' : 'assembleRelease'
const genv = { ...env, ORG_GRADLE_PROJECT_survivalVersion: version }
if (!debug) {
  genv.ORG_GRADLE_PROJECT_survivalKeystore = ksFile
  genv.ORG_GRADLE_PROJECT_survivalKeystorePassword = readFileSync(ksPass, 'utf8').trim()
}
say(`gradle ${task} (${abis.join(', ')})`)
// En Windows, gradlew.bat necesita cmd; se llama por su nombre relativo (cwd = android/) para que una ruta con espacios
// («D:\DEV\Mi proyecto\…») no se parta en el intérprete.
const g = win
  ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'gradlew.bat', task, '--console=plain'], { cwd: ANDROID, stdio: 'inherit', env: genv })
  : spawnSync(gradlew, [task, '--console=plain'], { cwd: ANDROID, stdio: 'inherit', env: genv })
// Devolver las ABI apartadas.
for (const a of Object.keys(ABIS)) {
  const parked = join(ROOT, '.data', 'android-cache', 'parked', a)
  const dir = join(ANDROID, 'app', 'src', 'main', 'jniLibs', a)
  if (existsSync(parked) && !existsSync(dir)) renameSync(parked, dir)
}
if (g.status !== 0) fail('Gradle falló')

// ------------------------------------------------------------------ 4. APK en release/

const kind = debug ? 'debug' : 'release'
const apkDir = join(ANDROID, 'app', 'build', 'outputs', 'apk', kind)
mkdirSync(OUT, { recursive: true })
for (const abi of abis) {
  const src = readdirSync(apkDir).find((f) => f.includes(abi) && f.endsWith('.apk'))
  if (!src) fail(`no se generó el APK de ${abi}`)
  const short = abi === 'arm64-v8a' ? 'arm64' : abi
  const dest = join(OUT, `survival-os-${version}-android-${short}${debug ? '-debug' : ''}.apk`)
  copyFileSync(join(apkDir, src), dest)
  const sum = sha256(dest)
  writeFileSync(`${dest}.sha256`, `${sum}  ${dest.split(/[\\/]/).pop()}\n`)
  say(`${dest} (${(statSync(dest).size / 1024 ** 2).toFixed(0)} MB) sha256=${sum}`)
}
