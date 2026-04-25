// ─────────────────────────────────────────────────────
// chat.js — chat P2P via WebRTC
// mensagens, voz, arquivos — direto entre navegadores
// ─────────────────────────────────────────────────────

let ws = null              // WebSocket de sinalização
let conexoesPeer = {}      // RTCPeerConnection por usuário
let canaisChat = {}        // RTCDataChannel por usuário
let streamsLocais = {}     // MediaStream de áudio por chamada
let nomeLocal = null       // nome do usuário atual
let chatAberto = null      // nome do usuário com chat aberto

// ── INICIAR CONEXÃO DE SINALIZAÇÃO ───────────────────

async function iniciarSignaling() {
  const perfil = await carregarPerfil()
  const { data: { user } } = await db.auth.getUser()
  nomeLocal = perfil?.nome || user.email.split('@')[0]

  // conecta ao WebSocket do servidor Flask
  const WS_BASE = "wss://mapa-social.up.railway.app"

  const url = `${WS_BASE}/ws/${encodeURIComponent(nomeLocal)}`
  ws = new WebSocket(url)

  ws.onopen = () => console.log('Sinalização conectada')

  ws.onmessage = async (evento) => {
    const msg = JSON.parse(evento.data)
    await processarMensagemSignaling(msg)
  }

  ws.onclose = () => {
    // tenta reconectar após 3 segundos
    setTimeout(iniciarSignaling, 3000)
  }
}

// ── PROCESSAR MENSAGENS DE SINALIZAÇÃO ───────────────

async function processarMensagemSignaling(msg) {
  const { tipo, de, dados } = msg

  switch (tipo) {

    case 'oferta':
      await receberOferta(de, dados)
      break

    case 'resposta':
      await receberResposta(de, dados)
      break

    case 'ice':
      await receberICE(de, dados)
      break

    case 'recusado':
      mostrarAviso(`${de} recusou a chamada.`)
      limparConexao(de)
      break
  }
}

// ── ENVIAR MENSAGEM VIA WEBSOCKET ─────────────────────

function enviarSignal(para, tipo, dados) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ para, tipo, de: nomeLocal, dados }))
  }
}

// ── CRIAR CONEXÃO PEER ────────────────────────────────

function criarPeer(nomeRemoto) {
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  })

  // envia candidatos ICE conforme são descobertos
  peer.onicecandidate = (e) => {
    if (e.candidate) {
      enviarSignal(nomeRemoto, 'ice', e.candidate)
    }
  }

  // recebe canal de dados do lado remoto
  peer.ondatachannel = (e) => {
    configurarCanalChat(nomeRemoto, e.channel)
  }

  // recebe stream de áudio remoto
  peer.ontrack = (e) => {
    reproduzirAudio(nomeRemoto, e.streams[0])
  }

  peer.onconnectionstatechange = () => {
    if (['disconnected', 'failed', 'closed'].includes(peer.connectionState)) {
      limparConexao(nomeRemoto)
    }
  }

  conexoesPeer[nomeRemoto] = peer
  return peer
}

// ── INICIAR CHAT COM OUTRO USUÁRIO ────────────────────

async function iniciarChat(nomeRemoto) {
  if (conexoesPeer[nomeRemoto]) {
    abrirJanelaChat(nomeRemoto)
    return
  }

  const peer = criarPeer(nomeRemoto)

  // cria canal de dados para texto
  const canal = peer.createDataChannel('chat', { ordered: true })
  configurarCanalChat(nomeRemoto, canal)

  // cria oferta
  const oferta = await peer.createOffer()
  await peer.setLocalDescription(oferta)
  enviarSignal(nomeRemoto, 'oferta', oferta)

  abrirJanelaChat(nomeRemoto)
}

// ── RECEBER OFERTA DE OUTRO USUÁRIO ──────────────────

async function receberOferta(nomeRemoto, oferta) {
  // mostra notificação de chat recebido
  mostrarNotificacaoChat(nomeRemoto, async () => {

    const peer = criarPeer(nomeRemoto)
    await peer.setRemoteDescription(new RTCSessionDescription(oferta))

    const resposta = await peer.createAnswer()
    await peer.setLocalDescription(resposta)
    enviarSignal(nomeRemoto, 'resposta', resposta)

    abrirJanelaChat(nomeRemoto)

  }, () => {
    enviarSignal(nomeRemoto, 'recusado', {})
  })
}

async function receberResposta(nomeRemoto, resposta) {
  const peer = conexoesPeer[nomeRemoto]
  if (peer) {
    await peer.setRemoteDescription(new RTCSessionDescription(resposta))
  }
}

async function receberICE(nomeRemoto, candidato) {
  const peer = conexoesPeer[nomeRemoto]
  if (peer) {
    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidato))
    } catch (e) {}
  }
}

// ── CONFIGURAR CANAL DE CHAT ──────────────────────────

function configurarCanalChat(nomeRemoto, canal) {
  canaisChat[nomeRemoto] = canal

  canal.onopen = () => {
    adicionarMensagemChat(nomeRemoto, null, '— conexão estabelecida —', true)
  }

  canal.onclose = () => {
    adicionarMensagemChat(nomeRemoto, null, '— conexão encerrada —', true)
  }

  canal.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    adicionarMensagemChat(nomeRemoto, nomeRemoto, msg.texto)

    // limpa histórico após 15 minutos
    agendarLimpezaHistorico(nomeRemoto)
  }
}

// ── ENVIAR MENSAGEM ───────────────────────────────────

function enviarMensagem(nomeRemoto) {
  const input = document.getElementById(`chat-input-${nomeRemoto}`)
  const texto = input?.value?.trim()
  if (!texto) return

  const canal = canaisChat[nomeRemoto]
  if (!canal || canal.readyState !== 'open') {
    mostrarAviso('Conexão não estabelecida ainda.')
    return
  }

  canal.send(JSON.stringify({ texto }))
  adicionarMensagemChat(nomeRemoto, nomeLocal, texto)
  input.value = ''
}

// ── VOZ ───────────────────────────────────────────────

async function iniciarVoz(nomeRemoto) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamsLocais[nomeRemoto] = stream

    let peer = conexoesPeer[nomeRemoto]
    if (!peer) peer = criarPeer(nomeRemoto)

    stream.getTracks().forEach(track => peer.addTrack(track, stream))

    // renegocia se já havia conexão
    const oferta = await peer.createOffer()
    await peer.setLocalDescription(oferta)
    enviarSignal(nomeRemoto, 'oferta', oferta)

    atualizarBotaoVoz(nomeRemoto, true)

  } catch (e) {
    mostrarAviso('Não foi possível acessar o microfone.')
  }
}

function pararVoz(nomeRemoto) {
  const stream = streamsLocais[nomeRemoto]
  if (stream) {
    stream.getTracks().forEach(t => t.stop())
    delete streamsLocais[nomeRemoto]
  }
  atualizarBotaoVoz(nomeRemoto, false)
}

function reproduzirAudio(nomeRemoto, stream) {
  let audio = document.getElementById(`audio-${nomeRemoto}`)
  if (!audio) {
    audio = document.createElement('audio')
    audio.id = `audio-${nomeRemoto}`
    audio.autoplay = true
    document.body.appendChild(audio)
  }
  audio.srcObject = stream
}

// ── JANELA DE CHAT ────────────────────────────────────

function abrirJanelaChat(nomeRemoto) {
  chatAberto = nomeRemoto

  if (document.getElementById(`chat-${nomeRemoto}`)) {
    document.getElementById(`chat-${nomeRemoto}`).style.display = 'flex'
    return
  }

  const janela = document.createElement('div')
  janela.id = `chat-${nomeRemoto}`
  janela.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:9999;
    width:300px;height:420px;
    background:var(--bg,white);
    border:0.5px solid rgba(0,0,0,0.12);
    border-radius:16px;display:flex;
    flex-direction:column;overflow:hidden;
    box-shadow:0 8px 32px rgba(0,0,0,0.12);
  `

  janela.innerHTML = `
    <div style="
      padding:12px 14px;border-bottom:0.5px solid rgba(0,0,0,0.08);
      display:flex;align-items:center;justify-content:space-between;
      flex-shrink:0;
    ">
      <div>
        <div style="font-size:13px;font-weight:500;
          color:var(--text,#1a1a18)">${nomeRemoto}</div>
        <div style="font-size:11px;color:#9c9a92" id="status-${nomeRemoto}">
          conectando...
        </div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button onclick="toggleVoz('${nomeRemoto}')"
          id="btn-voz-${nomeRemoto}"
          title="Ligar / desligar voz"
          style="
            background:none;border:0.5px solid rgba(0,0,0,0.12);
            border-radius:20px;padding:4px 10px;font-size:11px;
            cursor:pointer;color:#6b6a65;font-family:system-ui;
          ">voz</button>
        <button onclick="fecharChat('${nomeRemoto}')" style="
          background:none;border:none;font-size:18px;
          cursor:pointer;color:#9c9a92;line-height:1;padding:0 2px;
        ">×</button>
      </div>
    </div>

    <div id="msgs-${nomeRemoto}" style="
      flex:1;overflow-y:auto;padding:12px;
      display:flex;flex-direction:column;gap:6px;
    "></div>

    <div style="
      padding:10px;border-top:0.5px solid rgba(0,0,0,0.08);
      display:flex;gap:6px;flex-shrink:0;
    ">
      <input id="chat-input-${nomeRemoto}"
        type="text"
        placeholder="Mensagem..."
        style="
          flex:1;padding:8px 12px;font-size:13px;
          border:0.5px solid rgba(0,0,0,0.12);
          border-radius:20px;outline:none;
          background:var(--bg2,#f5f4f0);
          font-family:system-ui;color:var(--text,#1a1a18);
        "
        onkeydown="if(event.key==='Enter') enviarMensagem('${nomeRemoto}')">
      <button onclick="enviarMensagem('${nomeRemoto}')" style="
        background:#185FA5;color:white;border:none;
        border-radius:20px;padding:8px 14px;
        font-size:12px;cursor:pointer;font-family:system-ui;
      ">enviar</button>
    </div>
  `

  document.body.appendChild(janela)
}

function fecharChat(nomeRemoto) {
  const janela = document.getElementById(`chat-${nomeRemoto}`)
  if (janela) janela.style.display = 'none'
}

function adicionarMensagemChat(nomeRemoto, autor, texto, sistema = false) {
  const container = document.getElementById(`msgs-${nomeRemoto}`)
  if (!container) return

  const souEu = autor === nomeLocal
  const div = document.createElement('div')

  if (sistema) {
    div.style.cssText = `
      text-align:center;font-size:11px;
      color:#9c9a92;padding:4px 0;
    `
    div.textContent = texto
  } else {
    div.style.cssText = `
      display:flex;flex-direction:column;
      align-items:${souEu ? 'flex-end' : 'flex-start'};
    `
    div.innerHTML = `
      <div style="
        background:${souEu ? '#185FA5' : '#f0ede8'};
        color:${souEu ? 'white' : '#1a1a18'};
        border-radius:${souEu ? '12px 12px 2px 12px' : '12px 12px 12px 2px'};
        padding:7px 11px;font-size:13px;line-height:1.4;
        max-width:220px;word-break:break-word;
      ">${texto}</div>
      <div style="font-size:10px;color:#9c9a92;margin-top:2px;
        padding:0 4px">
        ${new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}
      </div>
    `
  }

  container.appendChild(div)
  container.scrollTop = container.scrollHeight

  // atualiza status
  const status = document.getElementById(`status-${nomeRemoto}`)
  if (status && !sistema) status.textContent = 'online'
}

function atualizarBotaoVoz(nomeRemoto, ativo) {
  const btn = document.getElementById(`btn-voz-${nomeRemoto}`)
  if (!btn) return
  btn.style.background = ativo ? '#E1F5EE' : 'none'
  btn.style.color = ativo ? '#0F6E56' : '#6b6a65'
  btn.style.borderColor = ativo ? '#1D9E75' : 'rgba(0,0,0,0.12)'
  btn.textContent = ativo ? 'microfone on' : 'voz'
}

function toggleVoz(nomeRemoto) {
  if (streamsLocais[nomeRemoto]) {
    pararVoz(nomeRemoto)
  } else {
    iniciarVoz(nomeRemoto)
  }
}

// ── NOTIFICAÇÃO DE CHAT RECEBIDO ──────────────────────

function mostrarNotificacaoChat(nomeRemoto, aceitar, recusar) {
  const notif = document.createElement('div')
  notif.style.cssText = `
    position:fixed;top:20px;right:20px;z-index:99999;
    background:var(--bg,white);
    border:0.5px solid rgba(0,0,0,0.12);
    border-radius:12px;padding:14px 16px;
    box-shadow:0 4px 20px rgba(0,0,0,0.12);
    font-family:system-ui;min-width:240px;
  `
  notif.innerHTML = `
    <div style="font-size:13px;font-weight:500;
      color:var(--text,#1a1a18);margin-bottom:10px">
      ${nomeRemoto} quer conversar
    </div>
    <div style="display:flex;gap:8px">
      <button id="btn-aceitar" style="
        flex:1;padding:7px;font-size:12px;border-radius:8px;
        border:0.5px solid #1D9E75;background:#E1F5EE;
        color:#0F6E56;cursor:pointer;font-family:system-ui;
      ">Aceitar</button>
      <button id="btn-recusar" style="
        flex:1;padding:7px;font-size:12px;border-radius:8px;
        border:0.5px solid rgba(0,0,0,0.12);background:none;
        color:#6b6a65;cursor:pointer;font-family:system-ui;
      ">Recusar</button>
    </div>
  `

  document.body.appendChild(notif)

  notif.querySelector('#btn-aceitar').onclick = () => {
    notif.remove()
    aceitar()
  }
  notif.querySelector('#btn-recusar').onclick = () => {
    notif.remove()
    recusar()
  }

  // remove automaticamente após 30 segundos
  setTimeout(() => { notif.remove(); recusar() }, 30000)
}

// ── LIMPAR HISTÓRICO APÓS 15 MIN ──────────────────────

let timersLimpeza = {}

function agendarLimpezaHistorico(nomeRemoto) {
  if (timersLimpeza[nomeRemoto]) clearTimeout(timersLimpeza[nomeRemoto])

  timersLimpeza[nomeRemoto] = setTimeout(() => {
    const container = document.getElementById(`msgs-${nomeRemoto}`)
    if (container) {
      container.innerHTML = ''
      adicionarMensagemChat(nomeRemoto, null, '— histórico apagado (15min) —', true)
    }
  }, 15 * 60 * 1000)
}

// ── LIMPAR CONEXÃO ────────────────────────────────────

function limparConexao(nomeRemoto) {
  if (conexoesPeer[nomeRemoto]) {
    conexoesPeer[nomeRemoto].close()
    delete conexoesPeer[nomeRemoto]
  }
  if (canaisChat[nomeRemoto]) {
    delete canaisChat[nomeRemoto]
  }
  pararVoz(nomeRemoto)
}

// ── HELPERS ───────────────────────────────────────────

function mostrarAviso(texto) {
  const div = document.createElement('div')
  div.style.cssText = `
    position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
    background:#1a1a18;color:white;font-size:13px;
    padding:8px 16px;border-radius:20px;z-index:99999;
    font-family:system-ui;opacity:1;transition:opacity .3s;
  `
  div.textContent = texto
  document.body.appendChild(div)
  setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300) }, 3000)
}