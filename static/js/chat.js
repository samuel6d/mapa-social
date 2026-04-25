// ─────────────────────────────────────────────────────
// chat.js — chat P2P via WebRTC
// ─────────────────────────────────────────────────────

let ws            = null
let conexoesPeer  = {}
let canaisChat    = {}
let streamsLocais = {}
let nomeLocal     = null
let wsPingTimer   = null

// ── TOAST PRÓPRIO (não depende do index.html) ─────────

function toast(texto, duracao = 3000) {
  let el = document.getElementById('chat-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'chat-toast'
    el.style.cssText = `
      position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
      background:#1a1a18;color:white;font-size:13px;font-family:system-ui;
      padding:9px 18px;border-radius:20px;z-index:99999;
      pointer-events:none;opacity:0;transition:opacity .25s;
      white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.15);
    `
    document.body.appendChild(el)
  }
  el.textContent = texto
  el.style.opacity = '1'
  clearTimeout(el._timer)
  el._timer = setTimeout(() => { el.style.opacity = '0' }, duracao)
}

// também sobrescreve a função global caso exista
function mostrarToast(texto, duracao = 3000) {
  toast(texto, duracao)
}

// ── INICIAR SINALIZAÇÃO ───────────────────────────────

async function iniciarSignaling() {
  const perfil = await carregarPerfil()
  const { data: { user } } = await db.auth.getUser()
  nomeLocal = perfil?.nome?.trim() || user.email.split('@')[0]

  if (!nomeLocal) {
    console.error('chat: nome nao definido')
    return
  }

  conectarWS()
}

function conectarWS() {
  // remove barra do final do SERVIDOR antes de montar URL
  const base = SERVIDOR.replace(/\/+$/, '').replace(/^http/, 'ws')
  const url  = `${base}/ws/${encodeURIComponent(nomeLocal)}`

  console.log('chat: conectando como', nomeLocal)
  ws = new WebSocket(url)

  ws.onopen = () => {
    console.log('chat: ws conectado')
    // ping a cada 20s para manter conexão viva no Railway
    clearInterval(wsPingTimer)
    wsPingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: 'ping' }))
      }
    }, 20000)
  }

  ws.onerror = (e) => console.error('chat: ws erro', e)

  ws.onclose = (e) => {
    clearInterval(wsPingTimer)
    console.log('chat: ws fechado, reconectando...', e.code)
    setTimeout(conectarWS, 3000)
  }

  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg.tipo === 'ping') return
      console.log('chat: recebeu', msg.tipo, 'de', msg.de)
      await processarSignal(msg)
    } catch (e) {
      console.error('chat: erro ao processar mensagem', e)
    }
  }
}

// ── PROCESSAR SINAIS ──────────────────────────────────

async function processarSignal(msg) {
  const { tipo, de, dados } = msg
  switch (tipo) {
    case 'oferta':   await receberOferta(de, dados);   break
    case 'resposta': await receberResposta(de, dados); break
    case 'ice':      await receberICE(de, dados);      break
    case 'recusado':
      toast(`${de} recusou o chat.`)
      limparConexao(de)
      break
  }
}

function enviarSignal(para, tipo, dados) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('chat: ws nao esta aberto')
    toast('Reconectando... tente em instantes.')
    return
  }
  ws.send(JSON.stringify({ para, tipo, de: nomeLocal, dados }))
  console.log('chat: enviou', tipo, 'para', para)
}

// ── PEER ──────────────────────────────────────────────

function criarPeer(nomeRemoto) {
  conexoesPeer[nomeRemoto]?.close()

  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  })

  peer.onicecandidate = (e) => {
    if (e.candidate) enviarSignal(nomeRemoto, 'ice', e.candidate)
  }

  peer.ondatachannel = (e) => configurarCanal(nomeRemoto, e.channel)
  peer.ontrack       = (e) => reproduzirAudio(nomeRemoto, e.streams[0])

  peer.onconnectionstatechange = () => {
    console.log('chat: peer', nomeRemoto, peer.connectionState)
    if (['disconnected','failed','closed'].includes(peer.connectionState)) {
      limparConexao(nomeRemoto)
    }
  }

  conexoesPeer[nomeRemoto] = peer
  return peer
}

// ── INICIAR CHAT ──────────────────────────────────────

async function iniciarChat(nomeRemoto) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast('Reconectando... tente em instantes.')
    return
  }

  abrirJanela(nomeRemoto)

  const peer  = criarPeer(nomeRemoto)
  const canal = peer.createDataChannel('chat', { ordered: true })
  configurarCanal(nomeRemoto, canal)

  const oferta = await peer.createOffer()
  await peer.setLocalDescription(oferta)
  enviarSignal(nomeRemoto, 'oferta', oferta)
}

// ── RECEBER OFERTA ────────────────────────────────────

async function receberOferta(nomeRemoto, oferta) {
  mostrarNotificacao(nomeRemoto,
    async () => {
      const peer = criarPeer(nomeRemoto)
      await peer.setRemoteDescription(new RTCSessionDescription(oferta))
      const resposta = await peer.createAnswer()
      await peer.setLocalDescription(resposta)
      enviarSignal(nomeRemoto, 'resposta', resposta)
      abrirJanela(nomeRemoto)
    },
    () => enviarSignal(nomeRemoto, 'recusado', {})
  )
}

async function receberResposta(nomeRemoto, resposta) {
  const peer = conexoesPeer[nomeRemoto]
  if (peer) await peer.setRemoteDescription(new RTCSessionDescription(resposta))
}

async function receberICE(nomeRemoto, candidato) {
  const peer = conexoesPeer[nomeRemoto]
  if (peer) {
    try { await peer.addIceCandidate(new RTCIceCandidate(candidato)) }
    catch (e) { console.warn('chat: ICE ignorado', e) }
  }
}

// ── CANAL DE DADOS ────────────────────────────────────

function configurarCanal(nomeRemoto, canal) {
  canaisChat[nomeRemoto] = canal

  canal.onopen = () => {
    adicionarMensagem(nomeRemoto, null, '— conectado —', true)
    const el = document.getElementById(`status-chat-${nomeRemoto}`)
    if (el) el.textContent = 'conectado'
  }

  canal.onclose = () => {
    adicionarMensagem(nomeRemoto, null, '— desconectado —', true)
    const el = document.getElementById(`status-chat-${nomeRemoto}`)
    if (el) el.textContent = 'desconectado'
  }

  canal.onmessage = (e) => {
    try {
      const { texto } = JSON.parse(e.data)
      adicionarMensagem(nomeRemoto, nomeRemoto, texto)
    } catch (err) {}
  }
}

function enviarMensagem(nomeRemoto) {
  const input = document.getElementById(`chat-input-${nomeRemoto}`)
  const texto = input?.value?.trim()
  if (!texto) return

  const canal = canaisChat[nomeRemoto]
  if (!canal || canal.readyState !== 'open') {
    toast('Canal ainda não está aberto.')
    return
  }

  canal.send(JSON.stringify({ texto }))
  adicionarMensagem(nomeRemoto, nomeLocal, texto)
  input.value = ''
}

// ── VOZ ───────────────────────────────────────────────

async function iniciarVoz(nomeRemoto) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamsLocais[nomeRemoto] = stream

    let peer = conexoesPeer[nomeRemoto] || criarPeer(nomeRemoto)
    stream.getTracks().forEach(t => peer.addTrack(t, stream))

    const oferta = await peer.createOffer()
    await peer.setLocalDescription(oferta)
    enviarSignal(nomeRemoto, 'oferta', oferta)

    atualizarBotaoVoz(nomeRemoto, true)
    toast('Microfone ativado')
  } catch (e) {
    toast('Permita o microfone no navegador.')
    console.error('chat: microfone', e)
  }
}

function pararVoz(nomeRemoto) {
  streamsLocais[nomeRemoto]?.getTracks().forEach(t => t.stop())
  delete streamsLocais[nomeRemoto]
  atualizarBotaoVoz(nomeRemoto, false)
}

function reproduzirAudio(nomeRemoto, stream) {
  let el = document.getElementById(`audio-${nomeRemoto}`)
  if (!el) {
    el = document.createElement('audio')
    el.id = `audio-${nomeRemoto}`
    el.autoplay = true
    document.body.appendChild(el)
  }
  el.srcObject = stream
}

function toggleVoz(nomeRemoto) {
  streamsLocais[nomeRemoto] ? pararVoz(nomeRemoto) : iniciarVoz(nomeRemoto)
}

function atualizarBotaoVoz(nomeRemoto, ativo) {
  const btn = document.getElementById(`btn-voz-${nomeRemoto}`)
  if (!btn) return
  btn.style.background  = ativo ? '#ECFDF5' : 'none'
  btn.style.color       = ativo ? '#059669' : '#6b6a65'
  btn.style.borderColor = ativo ? '#059669' : 'rgba(0,0,0,0.14)'
  btn.textContent       = ativo ? 'mic on'  : 'voz'
}

// ── JANELA DE CHAT ────────────────────────────────────

function abrirJanela(nomeRemoto) {
  const existente = document.getElementById(`chat-${nomeRemoto}`)
  if (existente) { existente.style.display = 'flex'; return }

  const janela = document.createElement('div')
  janela.id = `chat-${nomeRemoto}`
  janela.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:9998;
    width:300px;height:420px;background:var(--bg,white);
    border:0.5px solid rgba(0,0,0,0.14);border-radius:14px;
    display:flex;flex-direction:column;overflow:hidden;
    box-shadow:0 8px 28px rgba(0,0,0,0.10);
    font-family:system-ui;
  `

  janela.innerHTML = `
    <div style="padding:12px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);
      display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <div>
        <div style="font-size:13px;font-weight:500;color:var(--text,#1a1a18)">
          ${nomeRemoto}
        </div>
        <div style="font-size:11px;color:#059669" id="status-chat-${nomeRemoto}">
          conectando...
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="btn-voz-${nomeRemoto}" onclick="toggleVoz('${nomeRemoto}')"
          style="padding:4px 10px;font-size:11px;font-weight:500;border-radius:20px;
          border:0.5px solid rgba(0,0,0,0.14);background:none;color:#6b6a65;
          cursor:pointer;font-family:system-ui;transition:all .15s">voz</button>
        <button onclick="fecharJanela('${nomeRemoto}')"
          style="background:none;border:none;font-size:20px;color:#9c9a92;
          cursor:pointer;line-height:1;padding:0 2px">×</button>
      </div>
    </div>

    <div id="msgs-${nomeRemoto}"
      style="flex:1;overflow-y:auto;padding:12px;
      display:flex;flex-direction:column;gap:6px"></div>

    <div style="padding:10px;border-top:0.5px solid rgba(0,0,0,0.08);
      display:flex;gap:6px;flex-shrink:0">
      <input id="chat-input-${nomeRemoto}" type="text" placeholder="mensagem..."
        style="flex:1;padding:8px 12px;font-size:13px;border-radius:20px;
        border:0.5px solid rgba(0,0,0,0.14);outline:none;
        background:var(--bg2,#f5f4f0);color:var(--text,#1a1a18);
        font-family:system-ui;"
        onkeydown="if(event.key==='Enter') enviarMensagem('${nomeRemoto}')">
      <button onclick="enviarMensagem('${nomeRemoto}')"
        style="background:#2563EB;color:white;border:none;border-radius:20px;
        padding:8px 14px;font-size:12px;font-weight:500;cursor:pointer;
        font-family:system-ui">enviar</button>
    </div>
  `

  document.body.appendChild(janela)
}

function fecharJanela(nomeRemoto) {
  const el = document.getElementById(`chat-${nomeRemoto}`)
  if (el) el.style.display = 'none'
}

function adicionarMensagem(nomeRemoto, autor, texto, sistema = false) {
  const container = document.getElementById(`msgs-${nomeRemoto}`)
  if (!container) return

  const souEu = autor === nomeLocal
  const wrap  = document.createElement('div')
  wrap.style.cssText = `display:flex;flex-direction:column;
    align-items:${sistema ? 'center' : souEu ? 'flex-end' : 'flex-start'}`

  if (sistema) {
    wrap.innerHTML = `
      <div style="font-size:11px;color:#9c9a92;padding:4px 0">${texto}</div>`
  } else {
    const bg = souEu ? '#2563EB' : '#f0ede8'
    const cor = souEu ? 'white' : '#1a1a18'
    const raio = souEu ? '10px 2px 10px 10px' : '2px 10px 10px 10px'
    wrap.innerHTML = `
      <div style="background:${bg};color:${cor};border-radius:${raio};
        padding:7px 11px;font-size:13px;line-height:1.45;
        max-width:220px;word-break:break-word">${texto}</div>
      <div style="font-size:10px;color:#9c9a92;margin-top:2px;padding:0 4px">
        ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
      </div>`
  }

  container.appendChild(wrap)
  container.scrollTop = container.scrollHeight
  agendarLimpeza(nomeRemoto)
}

// ── NOTIFICAÇÃO ───────────────────────────────────────

function mostrarNotificacao(nomeRemoto, aceitar, recusar) {
  document.getElementById(`notif-${nomeRemoto}`)?.remove()

  const notif = document.createElement('div')
  notif.id = `notif-${nomeRemoto}`
  notif.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:99999;
    background:var(--bg,white);border:0.5px solid rgba(0,0,0,0.14);
    border-radius:14px;padding:16px;
    box-shadow:0 8px 28px rgba(0,0,0,0.10);
    font-family:system-ui;min-width:240px;
    animation:slideDown .2s ease;
  `

  notif.innerHTML = `
    <style>
      @keyframes slideDown {
        from { opacity:0; transform:translateY(-8px) }
        to   { opacity:1; transform:translateY(0) }
      }
    </style>
    <div style="font-size:13px;font-weight:500;
      color:var(--text,#1a1a18);margin-bottom:12px">
      ${nomeRemoto} quer conversar
    </div>
    <div style="display:flex;gap:8px">
      <button id="btn-ac-${nomeRemoto}"
        style="flex:1;padding:7px;font-size:12px;font-weight:500;
        border-radius:8px;border:0.5px solid rgba(5,150,105,.3);
        background:#ECFDF5;color:#059669;cursor:pointer;font-family:system-ui">
        aceitar
      </button>
      <button id="btn-rc-${nomeRemoto}"
        style="flex:1;padding:7px;font-size:12px;
        border-radius:8px;border:0.5px solid rgba(0,0,0,0.12);
        background:none;color:#6b6a65;cursor:pointer;font-family:system-ui">
        recusar
      </button>
    </div>
  `

  document.body.appendChild(notif)

  const timer = setTimeout(() => { notif.remove(); recusar() }, 30000)

  document.getElementById(`btn-ac-${nomeRemoto}`).onclick = () => {
    clearTimeout(timer); notif.remove(); aceitar()
  }
  document.getElementById(`btn-rc-${nomeRemoto}`).onclick = () => {
    clearTimeout(timer); notif.remove(); recusar()
  }
}

// ── LIMPEZA DE HISTÓRICO (15 MIN) ─────────────────────

let timersLimpeza = {}

function agendarLimpeza(nomeRemoto) {
  clearTimeout(timersLimpeza[nomeRemoto])
  timersLimpeza[nomeRemoto] = setTimeout(() => {
    const c = document.getElementById(`msgs-${nomeRemoto}`)
    if (c) {
      c.innerHTML = ''
      adicionarMensagem(nomeRemoto, null, '— histórico apagado (15min) —', true)
    }
  }, 15 * 60 * 1000)
}

// ── LIMPAR CONEXÃO ────────────────────────────────────

function limparConexao(nomeRemoto) {
  conexoesPeer[nomeRemoto]?.close()
  delete conexoesPeer[nomeRemoto]
  delete canaisChat[nomeRemoto]
  pararVoz(nomeRemoto)
}