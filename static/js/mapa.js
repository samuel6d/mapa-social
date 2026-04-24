// ─────────────────────────────────────────────────────
// mapa.js — mapa navegável com avatares em tempo real
// ─────────────────────────────────────────────────────

let mapa = null
let marcadores = {}
let intervaloUsers = null
let intervaloHeartbeat = null
let usuarioAtual = null

// ── INICIAR O MAPA ────────────────────────────────────

async function iniciarMapa(user) {
  usuarioAtual = user

  // carrega o perfil do Supabase para pegar posição salva
  const perfil = await carregarPerfil()
  const posInicial = {
    x: perfil?.mapa_x ?? 2500,
    y: perfil?.mapa_y ?? 2500
  }

  // cria o mapa com coordenadas simples (não geográficas)
  mapa = L.map('mapa', {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 3,
    zoomControl: true,
  })

  // tamanho do mundo: 5000x5000
  const bounds = [[0, 0], [5000, 5000]]
  mapa.fitBounds(bounds)

  // fundo do mapa
  L.rectangle(bounds, {
    color: 'transparent',
    fillColor: '#f0ede8',
    fillOpacity: 1,
    weight: 0,
    interactive: false,
  }).addTo(mapa)

  // grade visual de fundo (opcional — dá sensação de espaço)
  desenharGrade()

  // posiciona câmera na última posição do usuário
  mapa.setView([posInicial.y, posInicial.x], 0)

  // registra presença no servidor
  await registrarPosicao(posInicial.x, posInicial.y)

  // atualiza lista de usuários a cada 5 segundos
  await atualizarUsuarios()
  intervaloUsers = setInterval(atualizarUsuarios, 5000)

  // carrega posts ao iniciar e ao mover o mapa
  await carregarPosts()
  mapa.on('moveend', carregarPosts)

  // heartbeat: confirma que ainda está online a cada 30s
  intervaloHeartbeat = setInterval(() => {
    const centro = mapa.getCenter()
    registrarPosicao(Math.round(centro.lng), Math.round(centro.lat))
  }, 30000)

  // ao clicar no mapa, move o avatar do usuário
  mapa.on('click', async (e) => {
    const x = Math.round(e.latlng.lng)
    const y = Math.round(e.latlng.lat)
    await registrarPosicao(x, y)
    await salvarPosicao(x, y) // salva no Supabase
  })
}

// ── REGISTRAR POSIÇÃO NO SERVIDOR FLASK ──────────────

async function registrarPosicao(x, y) {
  const perfil = await carregarPerfil()
  const nome = perfil?.nome || usuarioAtual.email.split('@')[0]
  const foto = perfil?.foto || ''

  try {
    await fetch(SERVIDOR + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nome, x, y, foto })
    })
  } catch (e) {
    console.log('Servidor offline — tentando reconectar...')
  }
}

// ── ATUALIZAR LISTA DE USUÁRIOS ONLINE ───────────────

async function atualizarUsuarios() {
  try {
    const res = await fetch(SERVIDOR + '/users')
    if (!res.ok) return
    const usuarios = await res.json()

    // remove marcadores de quem saiu
    for (const nome in marcadores) {
      if (!usuarios[nome]) {
        mapa.removeLayer(marcadores[nome])
        delete marcadores[nome]
      }
    }

    // adiciona ou atualiza cada usuário
    for (const nome in usuarios) {
      const u = usuarios[nome]
      const pos = [u.y, u.x]
      const perfil = await carregarPerfil()
      const meuNome = perfil?.nome || usuarioAtual.email.split('@')[0]
      const souEu = nome === meuNome

      if (marcadores[nome]) {
        // atualiza posição suavemente
        marcadores[nome].setLatLng(pos)
      } else {
        // cria novo marcador
        const marcador = criarMarcador(nome, u.foto, pos, souEu)
        marcador.addTo(mapa)
        marcadores[nome] = marcador
      }
    }
  } catch (e) {
    console.log('Erro ao buscar usuários:', e)
  }
}

// ── CRIAR MARCADOR (AVATAR) ───────────────────────────

function criarMarcador(nome, foto, pos, souEu) {
  const cor = souEu ? '#185FA5' : '#1D9E75'
  const inicial = nome[0].toUpperCase()

  // avatar com foto ou inicial
  const htmlAvatar = foto
    ? `<img src="${foto}" style="
        width:40px;height:40px;border-radius:50%;
        object-fit:cover;border:2px solid white;
        cursor:pointer;display:block;
      " onerror="this.style.display='none'">`
    : `<div style="
        background:${cor};color:white;border-radius:50%;
        width:40px;height:40px;display:flex;
        align-items:center;justify-content:center;
        font-size:15px;font-weight:500;font-family:system-ui;
        border:2px solid white;cursor:pointer;
        ${souEu ? 'box-shadow:0 0 0 2px ' + cor + '44;' : ''}
      ">${inicial}</div>`

  // label com nome abaixo do avatar
  const htmlLabel = `<div style="
    margin-top:4px;font-size:11px;font-family:system-ui;
    font-weight:500;color:#1a1a18;text-align:center;
    background:rgba(255,255,255,0.85);
    padding:1px 6px;border-radius:20px;
    white-space:nowrap;
  ">${souEu ? 'você' : nome}</div>`

  const icone = L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center">
      ${htmlAvatar}${htmlLabel}
    </div>`,
    iconSize: [60, 60],
    iconAnchor: [30, 20],
    popupAnchor: [0, -24],
  })

  const marcador = L.marker(pos, { icon: icone })

  // popup ao clicar no avatar
  if (!souEu) {
    marcador.bindPopup(() => criarPopupPerfil(nome, foto), {
      maxWidth: 220,
      className: 'popup-perfil'
    })
  }

  return marcador
}

// ── POPUP DE PERFIL ───────────────────────────────────

function criarPopupPerfil(nome, foto) {
  const container = document.createElement('div')
  container.style.cssText = 'font-family:system-ui;font-size:13px;min-width:160px'

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      ${foto
        ? `<img src="${foto}" style="width:36px;height:36px;border-radius:50%;object-fit:cover">`
        : `<div style="width:36px;height:36px;border-radius:50%;background:#1D9E75;
            display:flex;align-items:center;justify-content:center;
            color:white;font-size:14px;font-weight:500">${nome[0].toUpperCase()}</div>`
      }
      <div>
        <div style="font-weight:500;color:#1a1a18">${nome}</div>
        <div style="font-size:11px;color:#6b6a65">online agora</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <button onclick="iniciarChat('${nome}')" style="
        padding:5px 10px;font-size:11px;border-radius:20px;
        border:0.5px solid #185FA5;background:#E6F1FB;
        color:#185FA5;cursor:pointer;font-family:system-ui;
      ">Chat</button>
      <button onclick="iniciarVoz('${nome}')" style="
        padding:5px 10px;font-size:11px;border-radius:20px;
        border:0.5px solid #1D9E75;background:#E1F5EE;
        color:#0F6E56;cursor:pointer;font-family:system-ui;
      ">Voz</button>
    </div>
  `

  // busca bio do perfil no Supabase e adiciona
  buscarPerfilPublico(nome).then(perfil => {
    if (perfil?.bio) {
      const bio = document.createElement('div')
      bio.style.cssText = 'font-size:12px;color:#6b6a65;margin-bottom:10px;line-height:1.5'
      bio.textContent = perfil.bio
      container.insertBefore(bio, container.lastElementChild)
    }
  })

  return container
}

// ── BUSCAR PERFIL PÚBLICO DE OUTRO USUÁRIO ────────────

async function buscarPerfilPublico(nome) {
  const { data } = await db
    .from('profiles')
    .select('nome, bio, foto, links, spotify')
    .eq('nome', nome)
    .single()
  return data
}

// ── GRADE VISUAL DE FUNDO ─────────────────────────────

function desenharGrade() {
  const passo = 200
  const linhaEstilo = { color: '#dddbd5', weight: 0.5, opacity: 0.6, interactive: false }

  for (let x = 0; x <= 5000; x += passo) {
    L.polyline([[0, x], [5000, x]], linhaEstilo).addTo(mapa)
  }
  for (let y = 0; y <= 5000; y += passo) {
    L.polyline([[y, 0], [y, 5000]], linhaEstilo).addTo(mapa)
  }
}

// ── LIMPAR AO SAIR ────────────────────────────────────

function pararMapa() {
  if (intervaloUsers) clearInterval(intervaloUsers)
  if (intervaloHeartbeat) clearInterval(intervaloHeartbeat)
}

// ── PLACEHOLDERS (implementados no chat.js) ───────────

function iniciarChat(nome) {
  alert('Chat com ' + nome + ' — vem na próxima etapa!')
}

function iniciarVoz(nome) {
  alert('Voz com ' + nome + ' — vem na próxima etapa!')
}