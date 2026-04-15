const { Client, LocalAuth } = require('whatsapp-web.js')
const admin = require('firebase-admin')
const http = require('http')

// Firebase
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: 'carwashea-27d00',
    clientEmail: 'firebase-adminsdk-fbsvc@carwashea-27d00.iam.gserviceaccount.com',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  }),
  databaseURL: 'https://carwashea-27d00-default-rtdb.firebaseio.com'
})
const db = admin.database()

let pairingCode = null
let connected = false

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox','--disable-setuid-sandbox'] }
})

client.on('qr', () => {
  console.log('QR gerado, solicitando codigo de pareamento...')
})

client.on('ready', () => {
  connected = true
  pairingCode = null
  console.log('WhatsApp conectado!')
})

client.on('disconnected', () => {
  connected = false
  console.log('Desconectado. Reiniciando...')
  setTimeout(() => client.initialize(), 5000)
})

// Detectar presenca dos contatos
client.on('change_battery', (batteryInfo) => {
  console.log('Battery:', batteryInfo)
})

client.initialize()

// Servidor HTTP
const server = http.createServer((req, res) => {
  if (req.url === '/code') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="15">
  <title>VivIA Presence</title>
  <style>
    body{background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:Arial,sans-serif;margin:0}
    .code{font-size:60px;font-weight:bold;color:#111;letter-spacing:16px;margin:24px 0;padding:20px 40px;border:3px solid #eee;border-radius:16px}
    .title{font-size:22px;color:#333;margin-bottom:8px}
    .sub{font-size:15px;color:#666;text-align:center;max-width:400px;line-height:1.6}
    .ok{font-size:32px;color:green}
    .wait{font-size:18px;color:#e67e22}
  </style>
</head>
<body>
  <div class="title">VivIA WhatsApp Presence</div>
  ${connected
    ? '<div class="ok">WhatsApp Conectado!</div>'
    : pairingCode
      ? `<div class="code">${pairingCode}</div>
         <div class="sub">Abra o WhatsApp > Dispositivos vinculados > Vincular com numero de telefone > Digite o codigo acima</div>`
      : '<div class="wait">Aguardando codigo... (atualiza em 15s)</div>'
  }
</body>
</html>`)
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ connected, pairing_code: pairingCode }))
  }
})

server.listen(process.env.PORT || 3000, () => {
  console.log('Servidor na porta', process.env.PORT || 3000)
})
