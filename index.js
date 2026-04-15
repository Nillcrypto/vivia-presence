const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { initializeApp, cert } = require('firebase-admin/app')
const { getDatabase } = require('firebase-admin/database')
const http = require('http')
const P = require('pino')

// Firebase config
const firebaseConfig = {
  credential: cert({
    projectId: 'carwashea-27d00',
    clientEmail: 'firebase-adminsdk-fbsvc@carwashea-27d00.iam.gserviceaccount.com',
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  }),
  databaseURL: 'https://carwashea-27d00-default-rtdb.firebaseio.com'
}

initializeApp(firebaseConfig)
const db = getDatabase()

let pairingCode = null
let connected = false

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: 'silent' }),
    printQRInTerminal: false,
    mobile: false
  })

  // Gerar código de pareamento (não QR Code)
  if (!sock.authState.creds.registered) {
    await new Promise(r => setTimeout(r, 3000))
    const number = process.env.WA_NUMBER || '5528999994692'
    pairingCode = await sock.requestPairingCode(number)
    console.log('=================================')
    console.log(`CÓDIGO DE PAREAMENTO: ${pairingCode}`)
    console.log('=================================')
    console.log('Abra o WhatsApp > Dispositivos Vinculados > Vincular com número de telefone')
    console.log('Digite o código acima. Válido por 30 segundos.')
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      connected = true
      console.log('✅ WhatsApp conectado!')
      pairingCode = null
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

  // Detectar online/offline dos contatos
  sock.ev.on('presence.update', async ({ id, presences }) => {
    for (const [jid, presence] of Object.entries(presences)) {
      const number = jid.replace('@s.whatsapp.net', '')
      const status = presence.lastKnownPresence // 'available' ou 'unavailable'
      const timestamp = Date.now()

      const statusLabel = status === 'available' ? 'online' : 'offline'
      console.log(`${number} → ${statusLabel}`)

      // Salvar no Firebase
      await db.ref(`vivia_presence/${number}`).set({
        status: statusLabel,
        timestamp,
        updated_at: new Date().toISOString()
      })
    }
  })
}

// Servidor HTTP simples para o Render não derrubar
const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      connected,
      pairing_code: pairingCode,
      timestamp: new Date().toISOString()
    }))
  } else if (req.url === '/code') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="refresh" content="10">
        <title>VivIA Presence</title>
        <style>
          body { background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: Arial; }
          .code { font-size: 64px; font-weight: bold; color: #111; letter-spacing: 12px; margin: 20px 0; }
          .label { font-size: 18px; color: #555; }
          .status { margin-top: 20px; font-size: 16px; color: ${connected ? 'green' : '#e67e22'}; }
        </style>
      </head>
      <body>
        <div class="label">VivIA WhatsApp Presence</div>
        ${pairingCode
          ? `<div class="code">${pairingCode}</div>
             <div class="label">Digite no WhatsApp → Dispositivos Vinculados → Vincular com número</div>
             <div class="label" style="color:red">⏱️ Atualiza a cada 10 segundos</div>`
          : `<div class="status">${connected ? '✅ WhatsApp Conectado!' : '⏳ Aguardando conexão...'}</div>`
        }
      </body>
      </html>
    `)
  } else {
    res.writeHead(200)
    res.end('VivIA Presence Server OK')
  }
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`)
  startWhatsApp()
})
