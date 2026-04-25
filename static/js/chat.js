// ─────────────────────────────────────────────────────
// chat.js — chat P2P via WebRTC
// ─────────────────────────────────────────────────────

let ws = null
let conexoesPeer = {}
let canaisChat   = {}
let streamsLocais = {}
let nomeLocal    = null

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
  const base = SERVIDOR.replace(/^http/, 'ws')
  const url  = `${base}/ws/${encodeURIComponent(nomeLocal)}`

  console.log('chat: conectando como', nomeLocal)
  ws = new WebSocket(url)

  ws.onopen = () => {
    console.log('chat: ws conectado')
    // ping a cada 25s para manter a conexão viva no Railway
    if (window._wsPingInterval) clearInterval(window._wsPingInterval)
    window._wsPingInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: 'ping' }))
      }
    }, 25000)
  }

  ws.onerror   = (e) => console.error('chat: ws erro', e)
  ws.onclose = (e) => {
    clearInterval(window._wsPingInterval)
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
      mostrarToast(`${de} recusou o chat.`)
      limparConexao(de)
      break
  }
}

function enviarSignal(para, tipo, dados) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('chat: ws nao esta aberto')
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

  peer.onicecandidate    = (e) => { if (e.candidate) enviarSignal(nomeRemoto, 'ice', e.candidate) }
  peer.ondatachannel     = (e) => configurarCanal(nomeRemoto, e.channel)
  peer.ontrack           = (e) => reproduzirAudio(nomeRemoto, e.streams[0])
  peer.onconnectionstatechange = () => {
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
    mostrarToast('Conectando... tente novamente em instantes.')
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
    catch (e) {}
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
      const msg = JSON.parse(e.data)
      adicionarMensagem(nomeRemoto, nomeRemoto, msg.texto)
    } catch (err) {}
  }
}

function enviarMensagem(nomeRemoto) {
  const input = document.getElementById(`chat-input-${nomeRemoto}`)
  const texto = input?.value?.trim()
  if (!texto) return

  const canal = canaisChat[nomeRemoto]
  if (!canal || canal.readyState !== 'open') {
    mostrarToast('Canal não está aberto ainda.')
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
    mostrarToast('Microfone ativado')
  } catch (e) {
    mostrarToast('Permita o microfone no navegador.')
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
  btn.style.background  = ativo ? 'var(--green-bg)' : 'none'
  btn.style.color       = ativo ? 'var(--green)'    : 'var(--text2)'
  btn.style.borderColor = ativo ? 'var(--green)'    : 'var(--border2)'
  btn.textContent       = ativo ? 'mic on' : 'voz'
}

// ── JANELA DE CHAT ────────────────────────────────────

function abrirJanela(nomeRemoto) {
  const existente = document.getElementById(`chat-${nomeRemoto}`)
  if (existente) { existente.style.display = 'flex'; return }

  const janela = document.createElement('div')
  janela.id = `chat-${nomeRemoto}`
  janela.className = 'chat-janela'
  janela.innerHTML = `
    <div class="chat-head">
      <div>
        <div class="chat-nome">${nomeRemoto}</div>
        <div class="chat-status-texto" id="status-chat-${nomeRemoto}">conectando...</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button id="btn-voz-${nomeRemoto}" onclick="toggleVoz('${nomeRemoto}')"
          class="btn-topo" style="padding:4px 10px;font-size:11px">voz</button>
        <button onclick="fecharJanela('${nomeRemoto}')" class="modal-fechar">×</button>
      </div>
    </div>
    <div id="msgs-${nomeRemoto}" class="chat-msgs"></div>
    <div class="chat-input-wrap">
      <input id="chat-input-${nomeRemoto}" class="chat-input" type="text"
        placeholder="mensagem..."
        onkeydown="if(event.key==='Enter') enviarMensagem('${nomeRemoto}')">
      <button onclick="enviarMensagem('${nomeRemoto}')" class="chat-enviar">enviar</button>
    </div>`

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
    wrap.innerHTML = `<div class="chat-msg sistema">${texto}</div>`
  } else {
    wrap.innerHTML = `
      <div class="chat-msg ${souEu ? 'meu' : 'deles'}">${texto}</div>
      <div class="chat-time">
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
  notif.className = 'chat-notif'
  notif.innerHTML = `
    <div class="chat-notif-titulo">${nomeRemoto} quer conversar</div>
    <div class="chat-notif-btns">
      <button class="chat-notif-btn chat-notif-aceitar" id="btn-ac-${nomeRemoto}">aceitar</button>
      <button class="chat-notif-btn chat-notif-recusar" id="btn-rc-${nomeRemoto}">recusar</button>
    </div>`

  document.body.appendChild(notif)

  const timer = setTimeout(() => { notif.remove(); recusar() }, 30000)

  document.getElementById(`btn-ac-${nomeRemoto}`).onclick = () => {
    clearTimeout(timer); notif.remove(); aceitar()
  }
  document.getElementById(`btn-rc-${nomeRemoto}`).onclick = () => {
    clearTimeout(timer); notif.remove(); recusar()
  }
}

// ── LIMPEZA ───────────────────────────────────────────

let timersLimpeza = {}

function agendarLimpeza(nomeRemoto) {
  clearTimeout(timersLimpeza[nomeRemoto])
  timersLimpeza[nomeRemoto] = setTimeout(() => {
    const c = document.getElementById(`msgs-${nomeRemoto}`)
    if (c) { c.innerHTML = ''; adicionarMensagem(nomeRemoto, null, '— histórico apagado (15min) —', true) }
  }, 15 * 60 * 1000)
}

function limparConexao(nomeRemoto) {
  conexoesPeer[nomeRemoto]?.close()
  delete conexoesPeer[nomeRemoto]
  delete canaisChat[nomeRemoto]
  pararVoz(nomeRemoto)
}

//--
// fallback local caso o index.html ainda não tenha carregado
function mostrarToast(texto, duracao = 3000) {
  // usa a função global se existir
  if (window._toast) {
    window._toast(texto, duracao)
    return
  }
  let t = document.getElementById('toast')
  if (!t) {
    t = document.createElement('div')
    t.id = 'toast'
    t.style.cssText = `
      position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
      background:#1a1a18;color:white;font-size:13px;
      padding:9px 18px;border-radius:20px;z-index:99999;
      font-family:system-ui;pointer-events:none;
      opacity:0;transition:opacity .25s;white-space:nowrap;
      box-shadow:0 4px 20px rgba(0,0,0,0.15);
    `
    document.body.appendChild(t)
  }
  t.textContent = texto
  t.style.opacity = '1'
  setTimeout(() => { t.style.opacity = '0' }, duracao)
}