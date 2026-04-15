const http = require('http')

let pairingCode = null
let connected = false
let sock = null

async function startWhatsApp() {
  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
    const pino = require('pino')
    const { initializeApp, cert } = require('firebase-admin/app')
    const { getDatabase } = require('firebase-admin/database')

    // Firebase
    const firebasePrivateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    initializeApp({
      credential: cert({
        projectId: 'carwashea-27d00',
        clientEmail: 'firebase-adminsdk-fbsvc@carwashea-27d00.iam.gserviceaccount.com',
        privateKey: firebasePrivateKey
      }),
      databaseURL: 'https://carwashea-27d00-default-rtdb.firebaseio.com'
    })
    const db = getDatabase()

    const { state, saveCreds } = await useMultiFileAuthState('./auth_info')
    const logger = pino({ level: 'silent' })

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: false,
      browser: ['VivIA', 'Chrome', '1.0']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (connection === 'open') {
        connected = true
        pairingCode = null
        console.log('✅ WhatsApp conectado!')
      }

      if (connection === 'close') {
        connected = false
        const code = lastDisconnect?.error?.output?.statusCode
        if (code !== DisconnectReason.loggedOut) {
          console.log('Reconectando em 5s...')
          setTimeout(startWhatsApp, 5000)
        } else {
          console.log('Deslogado. Precisa parear novamente.')
        }
      }

      // Gerar pairing code quando não registrado
      if (!sock.authState.creds.registered && !pairingCode) {
        await new Promise(r => setTimeout(r, 2000))
        try {
          const number = process.env.WA_NUMBER || '5528999994692'
          pairingCode = await sock.requestPairingCode(number)
          console.log('📱 CÓDIGO DE PAREAMENTO:', pairingCode)
        } catch(e) {
          console.log('Erro ao gerar código:', e.message)
        }
      }
    })

    // Detectar online/offline dos contatos
    sock.ev.on('presence.update', async ({ id, presences }) => {
      try {
        for (const [jid, presence] of Object.entries(presences)) {
          const number = jid.replace('@s.whatsapp.net', '').replace('@g.us', '')
          const status = presence.lastKnownPresence === 'available' ? 'online' : 'offline'
          const timestamp = Date.now()

          console.log(`📊 ${number} → ${status}`)

          // Salvar no Firebase
          await db.ref(`vivia_presence/${number}`).set({
            status,
            timestamp,
            updated_at: new Date().toISOString()
          })

          // Histórico
          await db.ref(`vivia_presence_historico/${number}/${timestamp}`).set({
            status,
            updated_at: new Date().toISOString()
          })
        }
      } catch(e) {
        console.error('Erro ao salvar presence:', e.message)
      }
    })

  } catch(e) {
    console.error('Erro ao iniciar WhatsApp:', e.message)
    setTimeout(startWhatsApp, 10000)
  }
}

// Servidor HTTP
const server = http.createServer((req, res) => {
  const url = req.url

  if (url === '/code' || url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="10">
  <title>VivIA Presence</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#ffffff;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:Arial,sans-serif;padding:20px}
    .logo{font-size:20px;color:#333;font-weight:bold;margin-bottom:8px}
    .sub{font-size:13px;color:#888;margin-bottom:32px}
    .code-box{font-size:56px;font-weight:bold;color:#111;letter-spacing:14px;padding:24px 40px;border:2px solid #ddd;border-radius:16px;background:#f9f9f9;margin-bottom:20px}
    .instrucao{font-size:14px;color:#555;text-align:center;max-width:320px;line-height:1.7}
    .conectado{font-size:28px;color:#22c55e;font-weight:bold}
    .aguardando{font-size:16px;color:#f59e0b}
    .atualiza{font-size:11px;color:#bbb;margin-top:20px}
  </style>
</head>
<body>
  <div class="logo">👩🏻‍💻 VivIA Presence</div>
  <div class="sub">Monitor de Contatos WhatsApp</div>
  ${connected
    ? '<div class="conectado">✅ WhatsApp Conectado!</div>'
    : pairingCode
      ? `<div class="code-box">${pairingCode}</div>
         <div class="instrucao">
           Abra o <strong>WhatsApp</strong><br>
           → Dispositivos vinculados<br>
           → Vincular com número de telefone<br>
           → Digite o código acima
         </div>`
      : '<div class="aguardando">⏳ Gerando código...</div>'
  }
  <div class="atualiza">Atualiza automaticamente a cada 10s</div>
</body>
</html>`)
  } else if (url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ connected, pairing_code: pairingCode, ts: Date.now() }))
  } else {
    res.writeHead(200)
    res.end('VivIA Presence OK')
  }
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Servidor na porta ${PORT}`)
  startWhatsApp()
})
