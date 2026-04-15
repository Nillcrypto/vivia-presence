const http = require('http')

let pairingCode = null
let connected = false
let db = null

async function initFirebase() {
  try {
    const { initializeApp, cert } = require('firebase-admin/app')
    const { getDatabase } = require('firebase-admin/database')
    const pk = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    if (!pk || pk.length < 50) { console.log('Firebase: sem chave configurada'); return null }
    initializeApp({
      credential: cert({
        projectId: 'carwashea-27d00',
        clientEmail: 'firebase-adminsdk-fbsvc@carwashea-27d00.iam.gserviceaccount.com',
        privateKey: pk
      }),
      databaseURL: 'https://carwashea-27d00-default-rtdb.firebaseio.com'
    })
    db = getDatabase()
    console.log('Firebase conectado!')
    return db
  } catch(e) {
    console.log('Firebase erro:', e.message)
    return null
  }
}

async function startWhatsApp() {
  // Limpar sessão antiga para forçar novo pareamento
  const fs = require('fs')
  try {
    if (fs.existsSync('./auth_info')) {
      fs.rmSync('./auth_info', { recursive: true, force: true })
      console.log('Sessão antiga removida!')
    }
  } catch(e) { console.log('Sem sessão anterior') }

  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
    const pino = require('pino')
    const logger = pino({ level: 'silent' })

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info')

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: false,
      browser: ['VivIA', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
      if (connection === 'open') {
        connected = true
        pairingCode = null
        console.log('WhatsApp conectado!')
        // Inicializa Firebase só depois de conectar
        if (!db) await initFirebase()
      }
      if (connection === 'close') {
        connected = false
        const code = lastDisconnect?.error?.output?.statusCode
        if (code !== DisconnectReason.loggedOut) {
          console.log('Reconectando...')
          setTimeout(startWhatsApp, 5000)
        }
      }
    })

    // Gerar código de pareamento
    if (!sock.authState.creds.registered) {
      await new Promise(r => setTimeout(r, 3000))
      try {
        const number = process.env.WA_NUMBER || '5528999994692'
        pairingCode = await sock.requestPairingCode(number)
        console.log('CODIGO:', pairingCode)
      } catch(e) {
        console.log('Erro codigo:', e.message)
        setTimeout(startWhatsApp, 8000)
      }
    }

    // Presenca dos contatos
    sock.ev.on('presence.update', async ({ id, presences }) => {
      if (!db) return
      try {
        for (const [jid, presence] of Object.entries(presences)) {
          const number = jid.replace('@s.whatsapp.net','').replace('@g.us','')
          const status = presence.lastKnownPresence === 'available' ? 'online' : 'offline'
          const timestamp = Date.now()
          await db.ref(`vivia_presence/${number}`).set({ status, timestamp, updated_at: new Date().toISOString() })
          await db.ref(`vivia_presence_historico/${number}/${timestamp}`).set({ status, updated_at: new Date().toISOString() })
          console.log(number, '->', status)
        }
      } catch(e) { console.error('Presence erro:', e.message) }
    })

  } catch(e) {
    console.error('Erro:', e.message)
    setTimeout(startWhatsApp, 10000)
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/code' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="60">
  <title>VivIA Presence</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;padding:20px;text-align:center}
    .logo{font-size:22px;color:#222;font-weight:bold;margin-bottom:6px}
    .sub{font-size:13px;color:#999;margin-bottom:36px}
    .code-box{font-size:54px;font-weight:bold;color:#111;letter-spacing:12px;padding:22px 36px;border:2px solid #e0e0e0;border-radius:16px;background:#f8f8f8;margin-bottom:20px}
    .instrucao{font-size:14px;color:#555;line-height:1.8;max-width:300px}
    .conectado{font-size:26px;color:#22c55e;font-weight:bold}
    .aguardando{font-size:16px;color:#f59e0b}
    .nota{font-size:11px;color:#ccc;margin-top:24px}
  </style>
</head>
<body>
  <div class="logo">&#128105;&#8205;&#128187; VivIA Presence</div>
  <div class="sub">Monitor de Contatos WhatsApp</div>
  ${connected
    ? '<div class="conectado">&#9989; WhatsApp Conectado!</div>'
    : pairingCode
      ? `<div class="code-box">${pairingCode}</div>
         <div class="instrucao">
           Abra o <strong>WhatsApp</strong><br>
           &#8594; Dispositivos vinculados<br>
           &#8594; Vincular com numero de telefone<br>
           &#8594; Digite o codigo acima
         </div>`
      : '<div class="aguardando">&#9203; Gerando codigo...</div>'
  }
  <div class="nota">Atualiza a cada 10 segundos</div>
</body>
</html>`)
  } else if (req.url === '/status') {
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({connected, pairing_code: pairingCode, ts: Date.now()}))
  } else {
    res.writeHead(200); res.end('OK')
  }
})

server.listen(process.env.PORT || 3000, () => {
  console.log('Porta', process.env.PORT || 3000)
  startWhatsApp()
})
