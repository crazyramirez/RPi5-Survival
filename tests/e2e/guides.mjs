/* eslint-disable no-console -- informe de validación por consola */
/** Catálogo local: tamaños táctiles, filtros, idiomas y estados de la biblioteca. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const OUT = process.env.GUIDE_SHOTS || ''
if (OUT) mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'survivelia-guides-chrome-'))
const port = 9500 + Math.floor(Math.random() * 300)
const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(path => existsSync(path))
if (!chromePath) throw new Error('Chrome no encontrado: define CHROME_PATH')
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--password-store=basic', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws
try {
  let targets
  for (let n=0; n<60 && !targets; n++) { await sleep(100); targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()).catch(()=>null) }
  if (!targets) throw new Error('Chrome no responde')
  ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise(r=>ws.addEventListener('open',r,{once:true}))
  let seq=0
  const pending=new Map()
  const errors=[], external=[]
  let override = null
  ws.addEventListener('message',ev=>{
    const m=JSON.parse(ev.data)
    if(m.method==='Fetch.requestPaused') {
      const requestId=m.params.requestId
      const action=override ? send('Fetch.fulfillRequest',{requestId,responseCode:override.status,responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from(JSON.stringify(override.body)).toString('base64')}) : send('Fetch.continueRequest',{requestId})
      void action.catch(error=>errors.push(error.message))
    }
    if(m.id) { const cb=pending.get(m.id); if(cb){ pending.delete(m.id); if(m.error)cb.reject(new Error(m.error.message));else cb.resolve(m.result) } }
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '))
    if(m.method==='Network.requestWillBeSent' && /^https?:/.test(m.params.request.url) && !['127.0.0.1','localhost'].includes(new URL(m.params.request.url).hostname)) external.push(m.params.request.url)
  })
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor=async expr=>{for(let n=0;n<120;n++){if(await evaluate(expr))return;await sleep(150)}console.log(await evaluate('document.body.innerText.slice(0,2500)'));throw new Error('Timeout: '+expr)}
  const check=(ok,label,data)=>{if(!ok)throw new Error(label+' '+JSON.stringify(data));console.log('PASS '+label+(data?' '+JSON.stringify(data):''))}
  const source = await fetch(BASE+'/api/library/protocols').then(r=>{if(!r.ok)throw new Error('Biblioteca no disponible');return r.json()})
  const total=source.length
  check(total>0,'biblioteca con contenido real')
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable')
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
  const variants=[
    ['propuesta-1536x1024',1536,1024,'es',false],['pi-800x480',800,480,'es',false],['pi-1024x600',1024,600,'es',false],
    ['movil-390x844',390,844,'es',false],['escritorio-1440x900',1440,900,'es',false],
    ['pi-texto-grande',800,480,'es',true],['pi-ingles',800,480,'en',false],
    ['pi-frances',800,480,'fr',false],['pi-italiano',800,480,'it',false],
  ]
  for(const [name,width,height,lang,large] of variants){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<680})
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('survival-os:locale',${JSON.stringify(lang)});document.cookie='survival-lang=${lang}; path=/';`})
    await send('Page.navigate',{url:BASE+'/emergencias'})
    await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total} ')`)
    if(large)await evaluate(`document.documentElement.dataset.text='large';document.documentElement.dataset.contrast='high'`)
    await evaluate('document.fonts.ready.then(()=>true)');await sleep(150)
    const audit=await evaluate(`(()=>{
      const scrollers=[document.documentElement,...document.querySelectorAll('.emergency,.guide-main,.guide-sidebar,.guide-results')];
      const wide=scrollers.filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>({class:el.className,scroll:el.scrollWidth,width:el.clientWidth}));
      const controls=[...document.querySelectorAll('.emergency button,.emergency select,.emergency a,.emergency input')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height});
      const small=controls.filter(el=>{const r=el.getBoundingClientRect();return Math.min(r.width,r.height)<44}).map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON()}));
      const cards=[...document.querySelectorAll('.emergency-shortcut')].map(el=>el.getBoundingClientRect().toJSON());
      const region=document.querySelector('.guide-results').getBoundingClientRect();
      return {wide,small,cards:cards.length,cardsVisible:cards.every(r=>r.bottom<=region.bottom+1),count:document.querySelectorAll('.guide-link').length,sidebar:getComputedStyle(document.querySelector('.guide-sidebar')).display,select:getComputedStyle(document.querySelector('.guide-mobile-categories')).display};
    })()`)
    if(width===1536) {
      const reference=await evaluate(`(()=>{
        const firstAid=document.querySelector('.guide-category:nth-child(2) > span');
        const style=getComputedStyle(firstAid);
        const warning=document.querySelector('.emergency-disclaimer').getBoundingClientRect();
        const list=document.querySelector('.guide-results').getBoundingClientRect();
        return {singleLine:firstAid.getBoundingClientRect().height<=parseFloat(style.lineHeight)+1,compactCards:[...document.querySelectorAll('.emergency-shortcut')].every(el=>el.getBoundingClientRect().height<90),fixedWarning:warning.top>=list.bottom};
      })()`)
      check(reference.singleLine,'categoría de primeros auxilios en una línea como la referencia')
      check(reference.compactCards,'tarjetas horizontales con la altura de la referencia')
      check(reference.fixedWarning,'aviso fijo sobre la navegación')
    }
    check(!audit.wide.length,name+' sin desbordamiento',audit.wide)
    check(!audit.small.length,name+' controles de al menos 44 px',audit.small)
    check(audit.cards===6,name+' seis accesos urgentes')
    if(width===800&&!large) check(audit.cardsVisible,name+' seis accesos visibles sin desplazar',audit)
    check(width<680?audit.sidebar==='none'&&audit.select!=='none':audit.sidebar!=='none',name+' navegación adaptada')
    if (OUT) {
      const shot=await send('Page.captureScreenshot',{format:'png'})
      writeFileSync(join(OUT,'emergencias-'+name+'.png'),Buffer.from(shot.data,'base64'))
    }
  }
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('survival-os:locale','es');document.cookie='survival-lang=es; path=/';`})
  await send('Emulation.setDeviceMetricsOverride',{width:1024,height:600,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:BASE+'/emergencias'});await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total} ')`)
  await evaluate(`[...document.querySelectorAll('.guide-category')].find(el=>el.textContent.includes('Agua')).click()`)
  await waitFor(`document.querySelectorAll('.guide-link').length===1`)
  check(await evaluate(`document.querySelector('.guide-link').getAttribute('href')==='/emergencias/agua-potable'`),'filtro de agua y ruta real')
  await evaluate(`document.querySelector('.guide-reset').click()`);await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total} ')`)
  check(await evaluate(`document.querySelector('.guide-group').querySelectorAll('.guide-link').length===8`),'portada muestra las ocho guías de la propuesta')
  await evaluate(`document.querySelector('.guide-more').click()`)
  await waitFor(`document.querySelectorAll('.guide-link').length===22`)
  check(await evaluate(`!document.querySelector('.emergency-shortcut')`),'ver todos abre los 22 primeros auxilios')
  await evaluate(`document.querySelector('.guide-reset').click()`)
  await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total} ')`)
  const setQuery=async q=>{await evaluate(`(()=>{const el=document.querySelector('.guide-search input');el.value=${JSON.stringify(q)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`);await sleep(150)}
  await setQuery('HIPOtermia');check(await evaluate(`document.querySelectorAll('.guide-link').length===1 && document.querySelector('.guide-link').textContent.includes('Hipotermia')`),'búsqueda sin distinguir mayúsculas')
  await setQuery('azucar');check(await evaluate(`document.querySelectorAll('.guide-link').length===1 && document.querySelector('.guide-link').textContent.includes('azúcar')`),'búsqueda sin tildes')
  await evaluate(`document.querySelector('.guide-link').click()`);await waitFor(`!!document.querySelector('article.protocol')`)
  check(await evaluate(`!!document.querySelector('article.protocol h1') && document.querySelector('.tags').textContent.includes('Revisado:')`),'ficha mantiene fuentes y revisión')
  await evaluate('window.history.back()');await waitFor(`!!document.querySelector('.guide-search input')`)
  check(await evaluate(`document.querySelector('.guide-search input').value==='azucar' && document.querySelectorAll('.guide-link').length===1`),'volver conserva la consulta')
  await setQuery('sin-coincidencias-xyz');check(await evaluate(`!!document.querySelector('.guide-empty') && !document.querySelector('.emergency-shortcut')`),'estado sin resultados y sin atajos ajenos a la búsqueda')
  await evaluate(`document.querySelector('.guide-empty button').click()`);await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total} ')`)
  check(await evaluate(`document.querySelectorAll('.emergency-shortcut').length===6`),'limpiar recupera todos los protocolos')
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await evaluate(`(()=>{const s=document.querySelector('.guide-mobile-categories select');s.value='Clima';s.dispatchEvent(new Event('change',{bubbles:true}))})()`)
  await waitFor(`document.querySelectorAll('.guide-link').length===4`)
  check(await evaluate(`document.querySelector('.guide-heading h2').textContent==='Clima'`),'selector móvil filtra los cuatro protocolos de clima')
  check(!external.length,'ninguna petición externa',external)
  check(!errors.length,'sin errores JS',errors)
  // Las respuestas siguientes solo se simulan dentro de este navegador de pruebas.
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/library/protocols',requestStage:'Request'}]})
  override={status:200,body:[...source,{id:'prueba-cultivo',title:'Conservar semillas',category:'Cultivo y alimentación',reviewed:'2026-11-16',sources:'Fixture de prueba del catálogo'}]}
  await send('Emulation.setDeviceMetricsOverride',{width:800,height:480,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:BASE+'/emergencias'})
  await waitFor(`document.querySelector('.guide-heading p')?.textContent.trim().startsWith('${total+1} ')`)
  await evaluate(`[...document.querySelectorAll('.guide-category')].find(el=>el.textContent.includes('Cultivo y alimentación')).click()`)
  await waitFor(`document.querySelectorAll('.guide-link').length===1`)
  check(await evaluate(`document.querySelector('.guide-link').textContent.includes('Conservar semillas') && !document.querySelector('.emergency-shortcut')`),'categoría nueva no sanitaria disponible y filtrable')
  override={status:503,body:{statusCode:503,message:'Biblioteca no disponible (prueba)'}}
  await send('Page.navigate',{url:BASE+'/emergencias'})
  await waitFor(`!!document.querySelector('.emergency-error')`)
  check(await evaluate(`document.querySelector('.emergency-phone').textContent.includes('112') && !!document.querySelector('.emergency-error button')`),'fallo de biblioteca conserva 112 y permite reintentar')
  override=null
  await evaluate(`document.querySelector('.emergency-error button').click()`)
  await waitFor(`!!document.querySelector('.guide-catalog')`)
  check(await evaluate(`!document.querySelector('.emergency-error')`),'reintentar recupera el catálogo')
  override={status:200,body:[]}
  await send('Page.navigate',{url:BASE+'/emergencias'})
  await waitFor(`document.querySelector('.emergency > p[role=status]')?.textContent.includes('Ningún')`)
  check(await evaluate(`!document.querySelector('.guide-catalog') && !!document.querySelector('.emergency-phone')`),'catálogo vacío sin accesos inexistentes')
  await send('Fetch.disable')
  if (OUT) console.log('CAPTURAS '+OUT)
} finally { if(ws)ws.close();chrome.kill();await sleep(300);rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:150}) }
