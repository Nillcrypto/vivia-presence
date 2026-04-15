const http = require('http')
const fs = require('fs')

let pairingCode = null
let connected = false
let pairingRequested = false

// Limpar sessao antiga sempre que iniciar
function limparSessao() {
  try {
    if (fs.existsSync('./auth_info')) {
      fs.rmSync('./auth_info', { recursive: true, force: true })
    }
  } catch(e) {}
}

async function startWhatsApp() {
  limparSessao()
  pairingCode = null
  pairingRequested = false
  connected = false

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
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      syncFullHistory: false
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update

      // Quando receber QR, solicitar pairing code
      if (qr && !pairingRequested) {
        pairingRequested = true
        try {
          const number = (process.env.WA_NUMBER || '5528999994692').replace(/[^0-9]/g, '')
          console.log('Solicitando pairing code para:', number)
          await new Promise(r => setTimeout(r, 500))
          pairingCode = await sock.requestPairingCode(number)
          console.log('CODIGO GERADO:', pairingCode)
        } catch(e) {
          console.log('Erro ao gerar codigo:', e.message)
          pairingCode = 'ERRO: ' + e.message
        }
      }

      if (connection === 'open') {
        connected = true
        pairingCode = null
        console.log('WhatsApp conectado!')
      }

      if (connection === 'close') {
        connected = false
        const code = lastDisconnect?.error?.output?.statusCode
        console.log('Desconectado. Codigo:', code)
        if (code !== DisconnectReason.loggedOut) {
          console.log('Reconectando em 8s...')
          setTimeout(startWhatsApp, 8000)
        }
      }
    })

    // Presence
    sock.ev.on('presence.update', async ({ id, presences }) => {
      for (const [jid, presence] of Object.entries(presences)) {
        const number = jid.replace('@s.whatsapp.net','').replace('@g.us','')
        const status = presence.lastKnownPresence === 'available' ? 'online' : 'offline'
        console.log(number, '->', status)
        // TODO: salvar no Firebase quando conectado
      }
    })

  } catch(e) {
    console.error('Erro fatal:', e.message)
    setTimeout(startWhatsApp, 10000)
  }
}

// Servidor HTTP
const server = http.createServer((req, res) => {
  if (req.url === '/code' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    const html = `<!DOCTYPE html>
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
    .code-box{font-size:52px;font-weight:bold;color:#111;letter-spacing:10px;padding:22px 36px;border:2px solid #e0e0e0;border-radius:16px;background:#f8f8f8;margin-bottom:24px;word-break:break-all}
    .instrucao{font-size:14px;color:#555;line-height:1.9;max-width:320px}
    .conectado{font-size:26px;color:#22c55e;font-weight:bold}
    .aguardando{font-size:16px;color:#f59e0b}
    .nota{font-size:11px;color:#ccc;margin-top:24px}
    strong{color:#111}
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
           <small style="color:#e67e22">&#9888; Digite manualmente, n&atilde;o cole</small>
         </div>`
      : pairingCode && pairingCode.startsWith('ERRO')
        ? `<div class="aguardando">&#10060; ${pairingCode}</div>`
        : '<div class="aguardando">&#9203; Gerando c&oacute;digo...</div>'
  }
  <div class="nota">Atualiza a cada 60 segundos</div>
</body>
</html>`
    res.end(html)
  } else if (req.url === '/status') {
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({connected, pairing_code: pairingCode, ts: Date.now()}))
  } else if (req.url === '/restart') {
    res.writeHead(200, {'Content-Type':'application/json'})
    res.end(JSON.stringify({ok:true, msg:'Reiniciando...'}))
    setTimeout(startWhatsApp, 1000)
  } else {
    res.writeHead(200); res.end('OK')
  }
})

server.listen(process.env.PORT || 3000, () => {
  console.log('Porta', process.env.PORT || 3000)
  startWhatsApp()
})
