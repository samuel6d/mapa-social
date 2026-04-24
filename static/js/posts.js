// ─────────────────────────────────────────────────────
// posts.js — cards de postagem fixados no mapa
// último post por usuário + stories 48h
// ─────────────────────────────────────────────────────

let postsMarcadores = {}

// ── CARREGAR POSTS DA ÁREA VISÍVEL ───────────────────

async function carregarPosts() {
  if (!mapa) return

  const bounds = mapa.getBounds()
  const x1 = Math.round(bounds.getWest())
  const x2 = Math.round(bounds.getEast())
  const y1 = Math.round(bounds.getSouth())
  const y2 = Math.round(bounds.getNorth())
  const agora = new Date().toISOString()

  const { data: posts, error } = await db
    .from('posts')
    .select('*')
    .gte('pos_x', x1).lte('pos_x', x2)
    .gte('pos_y', y1).lte('pos_y', y2)
    .or(`expires_at.is.null,expires_at.gt.${agora}`)

  if (error || !posts) return

  // remove posts que saíram da tela ou expiraram
  for (const id in postsMarcadores) {
    if (!posts.find(p => p.id === id)) {
      mapa.removeLayer(postsMarcadores[id])
      delete postsMarcadores[id]
    }
  }

  // adiciona posts novos
  for (const post of posts) {
    if (!postsMarcadores[post.id]) {
      const marcador = criarMarcadorPost(post)
      if (marcador) {
        marcador.addTo(mapa)
        postsMarcadores[post.id] = marcador
      }
    }
  }
}

// ── CRIAR MARCADOR DE POST NO MAPA ───────────────────

function criarMarcadorPost(post) {
  const html = renderizarCardMini(post)
  if (!html) return null

  const icone = L.divIcon({
    className: '',
    html,
    iconSize: [200, 'auto'],
    iconAnchor: [100, 0],
    popupAnchor: [0, 0],
  })

  const marcador = L.marker([post.pos_y, post.pos_x], {
    icon: icone,
    interactive: true,
  })

  marcador.bindPopup(() => criarCardCompleto(post), { maxWidth: 280 })
  return marcador
}

// ── CARD MINI (aparece no mapa) ───────────────────────

function renderizarCardMini(post) {
  const isStory = !!post.expires_at
  const tempoRestante = isStory ? calcularTempoRestante(post.expires_at) : null

  const badgeStory = isStory ? `
    <div style="
      position:absolute;top:6px;right:6px;
      background:rgba(0,0,0,0.6);color:white;
      font-size:10px;padding:2px 6px;border-radius:20px;
      font-family:system-ui;font-weight:500;
    ">${tempoRestante}</div>` : ''

  const base = `
    position:relative;border-radius:10px;overflow:hidden;
    border:${isStory ? '2px solid #7F77DD' : '0.5px solid rgba(0,0,0,0.12)'};
    background:white;width:200px;font-family:system-ui;
    cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.08);
  `

  switch (post.tipo) {

    case 'link':
      return `<div style="${base}">
        ${post.imagem_url
          ? `<img src="${post.imagem_url}"
              style="width:100%;height:100px;object-fit:cover">`
          : `<div style="height:40px;background:#E6F1FB;display:flex;
              align-items:center;padding:0 10px;
              font-size:11px;color:#185FA5;font-weight:500">
              ${tryHostname(post.conteudo)}
            </div>`
        }
        <div style="padding:8px 10px">
          <div style="font-size:12px;font-weight:500;color:#1a1a18;
            line-height:1.4;margin-bottom:3px;
            display:-webkit-box;-webkit-line-clamp:2;
            -webkit-box-orient:vertical;overflow:hidden">
            ${post.titulo || post.conteudo}
          </div>
          <div style="font-size:10px;color:#9c9a92">
            ${tryHostname(post.conteudo)}
          </div>
        </div>
        ${badgeStory}
      </div>`

    case 'imagem':
      return `<div style="${base}">
        <img src="${post.conteudo}"
          style="width:100%;height:120px;object-fit:cover;display:block"
          onerror="this.style.display='none'">
        ${post.titulo
          ? `<div style="padding:6px 10px;font-size:12px;color:#1a1a18">
              ${post.titulo}
            </div>`
          : ''}
        ${badgeStory}
      </div>`

    case 'texto':
      return `<div style="${base}padding:10px 12px;">
        <div style="font-size:13px;color:#1a1a18;line-height:1.5;
          display:-webkit-box;-webkit-line-clamp:4;
          -webkit-box-orient:vertical;overflow:hidden">
          ${post.conteudo}
        </div>
        ${badgeStory}
      </div>`

    case 'youtube': {
      const thumbId = extrairIdYoutube(post.conteudo)
      return `<div style="${base}">
        <div style="position:relative">
          ${thumbId
            ? `<img src="https://img.youtube.com/vi/${thumbId}/mqdefault.jpg"
                style="width:100%;height:110px;object-fit:cover;display:block">`
            : `<div style="height:110px;background:#FF0000;display:flex;
                align-items:center;justify-content:center;
                color:white;font-size:24px">▶</div>`
          }
          <div style="position:absolute;bottom:6px;right:6px;
            background:rgba(0,0,0,0.7);color:white;
            border-radius:4px;padding:2px 6px;font-size:10px">YouTube</div>
        </div>
        ${post.titulo
          ? `<div style="padding:6px 10px;font-size:12px;color:#1a1a18;
              line-height:1.4">${post.titulo}</div>`
          : ''}
        ${badgeStory}
      </div>`
    }

    case 'spotify':
      return `<div style="${base}padding:10px 12px;
        display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;border-radius:50%;
          background:#1DB954;display:flex;align-items:center;
          justify-content:center;flex-shrink:0;color:white;font-size:14px">♪</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:#1a1a18;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${post.titulo || 'Música'}
          </div>
          <div style="font-size:10px;color:#9c9a92">Spotify</div>
        </div>
        ${badgeStory}
      </div>`

    default:
      return null
  }
}

// ── CARD COMPLETO (popup ao clicar) ───────────────────

function criarCardCompleto(post) {
  const container = document.createElement('div')
  container.style.cssText = 'font-family:system-ui;font-size:13px;min-width:240px'

  const isStory = !!post.expires_at
  if (isStory) {
    const badge = document.createElement('div')
    badge.style.cssText = `
      display:inline-flex;align-items:center;gap:4px;
      background:#EEEDFE;color:#3C3489;font-size:11px;
      padding:3px 8px;border-radius:20px;margin-bottom:10px;font-weight:500;
    `
    badge.textContent = 'Story — expira em ' + calcularTempoRestante(post.expires_at)
    container.appendChild(badge)
  }

  switch (post.tipo) {

    case 'link':
      container.innerHTML += `
        <a href="${post.conteudo}" target="_blank" style="text-decoration:none">
          ${post.imagem_url
            ? `<img src="${post.imagem_url}" style="width:100%;height:140px;
                object-fit:cover;border-radius:6px;margin-bottom:8px;display:block">`
            : ''}
          <div style="font-size:13px;font-weight:500;color:#185FA5;
            line-height:1.4;margin-bottom:4px">
            ${post.titulo || 'Abrir link'}
          </div>
          <div style="font-size:11px;color:#9c9a92">
            ${tryHostname(post.conteudo)}
          </div>
        </a>`
      break

    case 'imagem':
      container.innerHTML += `
        <img src="${post.conteudo}"
          style="width:100%;border-radius:6px;display:block;margin-bottom:8px">
        ${post.titulo
          ? `<div style="font-size:13px;color:#1a1a18">${post.titulo}</div>`
          : ''}`
      break

    case 'texto':
      container.innerHTML += `
        <div style="font-size:14px;color:#1a1a18;line-height:1.6">
          ${post.conteudo}
        </div>`
      break

    case 'youtube': {
      const id = extrairIdYoutube(post.conteudo)
      container.innerHTML += id
        ? `<div style="position:relative;padding-bottom:56.25%;
            height:0;overflow:hidden;border-radius:6px">
            <iframe src="https://www.youtube.com/embed/${id}" frameborder="0"
              style="position:absolute;top:0;left:0;width:100%;height:100%"
              allowfullscreen></iframe>
          </div>`
        : `<a href="${post.conteudo}" target="_blank">${post.conteudo}</a>`
      break
    }

    case 'spotify': {
      const id = extrairIdSpotify(post.conteudo)
      container.innerHTML += id
        ? `<iframe src="https://open.spotify.com/embed/track/${id}"
            width="100%" height="80" frameborder="0"
            allow="encrypted-media"></iframe>`
        : `<a href="${post.conteudo}" target="_blank">${post.conteudo}</a>`
      break
    }
  }

  // botão deletar (só para o autor)
  db.auth.getUser().then(({ data: { user } }) => {
    if (user && post.user_id === user.id) {
      const btn = document.createElement('button')
      btn.textContent = 'Remover post'
      btn.style.cssText = `
        margin-top:10px;width:100%;padding:6px;font-size:12px;
        border:0.5px solid #faece7;border-radius:8px;
        background:#faece7;color:#712b13;cursor:pointer;font-family:system-ui;
      `
      btn.onclick = () => deletarPost(post.id)
      container.appendChild(btn)
    }
  })

  return container
}

// ── MODAL DE NOVO POST ────────────────────────────────

function abrirModalPost() {
  if (!document.getElementById('modal-post')) criarModalPost()
  verificarPostExistente()
  document.getElementById('modal-post').style.display = 'flex'
}

function fecharModalPost() {
  const modal = document.getElementById('modal-post')
  if (modal) modal.style.display = 'none'
}

function criarModalPost() {
  const modal = document.createElement('div')
  modal.id = 'modal-post'
  modal.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    background:rgba(0,0,0,0.4);
    display:none;align-items:center;justify-content:center;padding:24px;
  `

  modal.innerHTML = `
    <div style="background:var(--bg,white);border-radius:16px;
      padding:24px;width:100%;max-width:400px;">

      <div style="display:flex;justify-content:space-between;
        align-items:center;margin-bottom:16px">
        <span style="font-size:15px;font-weight:500">Novo post no mapa</span>
        <button onclick="fecharModalPost()" style="background:none;border:none;
          font-size:20px;cursor:pointer;color:#6b6a65;line-height:1">×</button>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        ${['link','imagem','texto','youtube','spotify'].map(t => `
          <button onclick="selecionarTipo('${t}')" id="tipo-${t}" style="
            padding:5px 12px;font-size:12px;border-radius:20px;
            border:0.5px solid rgba(0,0,0,0.15);background:none;
            cursor:pointer;font-family:system-ui;transition:all .15s">${t}
          </button>`).join('')}
        <button onclick="selecionarTipo('story')" id="tipo-story" style="
          padding:5px 12px;font-size:12px;border-radius:20px;
          border:0.5px solid #7F77DD;background:#EEEDFE;color:#3C3489;
          cursor:pointer;font-family:system-ui;font-weight:500">
          story 48h
        </button>
      </div>

      <div id="post-campos"></div>

      <div id="aviso-unico" style="
        font-size:12px;color:#633806;background:#FAEEDA;
        border-radius:8px;padding:8px 10px;margin-bottom:10px;display:none">
        Você já tem um post no mapa. Publicar vai substituir o anterior.
      </div>

      <button onclick="publicarPost()" style="
        width:100%;padding:10px;font-size:13px;font-weight:500;
        border-radius:10px;border:0.5px solid #185FA5;
        background:#E6F1FB;color:#185FA5;cursor:pointer;font-family:system-ui;
      ">Publicar no mapa</button>
    </div>
  `

  document.body.appendChild(modal)
  modal.addEventListener('click', e => { if (e.target === modal) fecharModalPost() })
  selecionarTipo('link')
}

async function verificarPostExistente() {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return
  const { data } = await db
    .from('posts').select('id').eq('user_id', user.id).limit(1)
  const aviso = document.getElementById('aviso-unico')
  if (aviso) aviso.style.display = (data && data.length > 0) ? 'block' : 'none'
}

let tipoAtual = 'link'

function selecionarTipo(tipo) {
  tipoAtual = tipo

  document.querySelectorAll('[id^="tipo-"]').forEach(b => {
    b.style.background = 'none'
    b.style.color = '#1a1a18'
    b.style.borderColor = 'rgba(0,0,0,0.15)'
    b.style.fontWeight = '400'
  })

  const btn = document.getElementById('tipo-' + tipo)
  if (btn) {
    btn.style.background = tipo === 'story' ? '#EEEDFE' : '#E6F1FB'
    btn.style.color      = tipo === 'story' ? '#3C3489' : '#185FA5'
    btn.style.borderColor = tipo === 'story' ? '#7F77DD' : '#185FA5'
    btn.style.fontWeight = '500'
  }

  const campos = document.getElementById('post-campos')
  const inputBase = `
    width:100%;padding:10px 12px;font-size:13px;
    border:0.5px solid rgba(0,0,0,0.12);border-radius:10px;
    background:white;font-family:system-ui;margin-bottom:10px;
    outline:none;box-sizing:border-box;
  `

  if (tipo === 'texto') {
    campos.innerHTML = `
      <textarea id="post-conteudo" placeholder="O que você quer dizer?"
        style="${inputBase}resize:none;" rows="4"></textarea>`

  } else if (tipo === 'story') {
    campos.innerHTML = `
      <div style="font-size:12px;color:#6b6a65;margin-bottom:10px;line-height:1.6">
        Cole um link, URL de imagem ou escreva um texto curto.<br>
        Some automaticamente após <strong>48 horas</strong>.
      </div>
      <input id="post-conteudo" type="text"
        placeholder="Link, URL de imagem ou texto curto"
        style="${inputBase}">
      <input id="post-titulo" type="text"
        placeholder="Legenda (opcional)" style="${inputBase}">`

  } else if (tipo === 'imagem') {
    campos.innerHTML = `
      <input id="post-conteudo" type="url"
        placeholder="URL da imagem (ex: i.imgur.com/...)" style="${inputBase}">
      <input id="post-titulo" type="text"
        placeholder="Legenda (opcional)" style="${inputBase}">`

  } else {
    const ph = {
      link:    'Cole a URL (ex: g1.globo.com/...)',
      youtube: 'Cole o link do YouTube',
      spotify: 'Cole o link do Spotify',
    }
    campos.innerHTML = `
      <input id="post-conteudo" type="url"
        placeholder="${ph[tipo] || 'URL'}" style="${inputBase}">`
  }
}

async function publicarPost() {
  const conteudo = document.getElementById('post-conteudo')?.value?.trim()
  if (!conteudo) { alert('Preencha o conteúdo do post.'); return }

  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  // apaga post anterior do usuário — mantém só o mais recente
  await db.from('posts').delete().eq('user_id', user.id)

  // remove marcadores antigos do mapa
  for (const id in postsMarcadores) {
    mapa.removeLayer(postsMarcadores[id])
    delete postsMarcadores[id]
  }

  const centro = mapa.getCenter()
  const pos_x = Math.round(centro.lng) + Math.round((Math.random() - 0.5) * 160)
  const pos_y = Math.round(centro.lat) + Math.round((Math.random() - 0.5) * 160)

  let titulo = document.getElementById('post-titulo')?.value?.trim() || ''
  let imagem_url = ''

  // Open Graph para links
  if (tipoAtual === 'link' || (tipoAtual === 'story' && conteudo.startsWith('http'))) {
    try {
      const og = await buscarOpenGraph(conteudo)
      if (!titulo) titulo = og.titulo || ''
      imagem_url = og.imagem || ''
    } catch (e) {}
  }

  // thumbnail YouTube
  if (tipoAtual === 'youtube') {
    const id = extrairIdYoutube(conteudo)
    if (id) imagem_url = `https://img.youtube.com/vi/${id}/mqdefault.jpg`
  }

  // expiração para stories
  const expires_at = tipoAtual === 'story'
    ? new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    : null

  // tipo real no banco
  const tipoReal = tipoAtual === 'story'
    ? (conteudo.startsWith('http') ? 'link' : 'texto')
    : tipoAtual

  const { error } = await db.from('posts').insert({
    user_id: user.id,
    tipo: tipoReal,
    conteudo,
    titulo,
    imagem_url,
    pos_x,
    pos_y,
    expires_at,
  })

  if (error) { alert('Erro ao publicar: ' + error.message); return }

  fecharModalPost()
  await carregarPosts()
}

async function deletarPost(id) {
  const { error } = await db.from('posts').delete().eq('id', id)
  if (!error) {
    if (postsMarcadores[id]) {
      mapa.removeLayer(postsMarcadores[id])
      delete postsMarcadores[id]
    }
  }
}

// ── OPEN GRAPH ────────────────────────────────────────

async function buscarOpenGraph(url) {
  try {
    const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
    const json = await res.json()
    return { titulo: json.data?.title || '', imagem: json.data?.image?.url || '' }
  } catch (e) {
    return { titulo: '', imagem: '' }
  }
}

// ── HELPERS ───────────────────────────────────────────

function calcularTempoRestante(expiresAt) {
  const diff = new Date(expiresAt) - new Date()
  if (diff <= 0) return 'expirado'
  const horas = Math.floor(diff / 3600000)
  const minutos = Math.floor((diff % 3600000) / 60000)
  return horas > 0 ? `${horas}h restantes` : `${minutos}min restantes`
}

function extrairIdYoutube(url) {
  try {
    const u = new URL(url)
    return u.searchParams.get('v') ||
      (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null)
  } catch { return null }
}

function extrairIdSpotify(url) {
  try {
    const partes = new URL(url).pathname.split('/')
    const idx = partes.indexOf('track')
    return idx !== -1 ? partes[idx + 1] : null
  } catch { return null }
}

function tryHostname(url) {
  try { return new URL(url).hostname } catch { return url }
}