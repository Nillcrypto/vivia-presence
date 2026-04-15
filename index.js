const http = require('http')
const fs = require('fs')

let pairingCode = null
let connected = false
let qrString = null
let retries = 0

function limparSessao() {
  try { fs.rmSync('./auth_info', { recursive: true, force: true }) } catch(e) {}
}

async function startWhatsApp() {
  limparSessao()
  pairingCode = null
  qrString = null
  connected = false

  try {
    const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys')
    const pino = require('pino')
    const logger = pino({ level: 'warn' })
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info')

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: true,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04']
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update
      console.log('connection.update keys:', Object.keys(update).join(','))

      if (qr) {
        qrString = qr
        console.log('QR recebido! Gerando pairing code...')
        try {
          await new Promise(r => setTimeout(r, 1000))
          const number = (process.env.WA_NUMBER || '5528999994692').replace(/[^0-9]/g, '')
          pairingCode = await sock.requestPairingCode(number)
          console.log('CODIGO:', pairingCode)
        } catch(e) {
          console.log('Erro pairing:', e.message)
          pairingCode = 'ERRO:' + e.message.substring(0,50)
        }
      }

      if (connection === 'open') {
        connected = true
        pairingCode = null
        qrString = null
        retries = 0
        console.log('CONECTADO!')
      }

      if (connection === 'close') {
        connected = false
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('Fechado. StatusCode:', code)
        retries++
        if (code !== DisconnectReason.loggedOut && retries < 5) {
          const delay = retries * 5000
          console.log(`Tentativa ${retries} - reconectando em ${delay}ms`)
          setTimeout(startWhatsApp, delay)
        } else {
          console.log('Desistindo apos', retries, 'tentativas ou logout')
        }
      }
    })

    sock.ev.on('presence.update', async ({ id, presences }) => {
      for (const [jid, presence] of Object.entries(presences)) {
        const number = jid.replace(/@.*/g,'')
        const status = presence.lastKnownPresence === 'available' ? 'online' : 'offline'
        console.log('PRESENCE:', number, '->', status)
      }
    })

  } catch(e) {
    console.error('Erro fatal:', e.message)
    retries++
    if (retries < 5) setTimeout(startWhatsApp, 10000)
  }
}

const server = http.createServer((req, res) => {
  const url = req.url

  if (url === '/code' || url === '/') {
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
    .code-box{font-size:52px;font-weight:bold;color:#111;letter-spacing:10px;padding:22px 36px;border:2px solid #e0e0e0;border-radius:16px;background:#f8f8f8;margin-bottom:24px}
    .instrucao{font-size:14px;color:#555;line-height:1.9;max-width:320px}
    .conectado{font-size:26px;color:#22c55e;font-weight:bold}
    .aguardando{font-size:16px;color:#f59e0b}
    .erro{font-size:13px;color:#e74c3c;max-width:300px;word-break:break-word}
    .nota{font-size:11px;color:#ccc;margin-top:24px}
  </style>
</head>
<body>
  <div class="logo">&#128105;&#8205;&#128187; VivIA Presence</div>
  <div class="sub">Monitor de Contatos WhatsApp</div>
  ${connected
    ? '<div class="conectado">&#9989; WhatsApp Conectado!</div>'
    : pairingCode && !pairingCode.startsWith('ERRO')
      ? `<div class="code-box">${pairingCode}</div>
         <div class="instrucao">
           Abra o <strong>WhatsApp</strong><br>
           &#8594; Dispositivos vinculados<br>
           &#8594; Vincular com n&uacute;mero<br>
           &#8594; Digite o c&oacute;digo acima<br><br>
           <small style="color:#e67e22">&#9888; Digite manualmente</small>
         </div>`
      : pairingCode && pairingCode.startsWith('ERRO')
        ? `<div class="erro">&#10060; ${pairingCode}</div>`
        : '<div class="aguardando">&#9203; Aguardando WhatsApp...</div>'
  }
  <div class="nota">Atualiza a cada 60s &bull; Tentativas: ${retries}</div>
</body>
</html>`)
  } else if (url === '/status') {
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({connected, pairing_code: pairingCode, qr: !!qrString, retries, ts: Date.now()}))
  } else if (url === '/restart') {
    retries = 0
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({ok:true}))
    setTimeout(startWhatsApp, 500)
  } else {
    res.writeHead(200); res.end('OK')
  }
})

server.listen(process.env.PORT || 3000, () => {
  console.log('Servidor na porta', process.env.PORT || 3000)
  startWhatsApp()
})
