// ─────────────────────────────────────────────────────
// posts.js — cards de postagem fixados no mapa
// 1 post por usuário + story 48h
// ─────────────────────────────────────────────────────

let postsMarcadores = {}
let tipoAtual       = 'link'

// ── CARREGAR POSTS ────────────────────────────────────

async function carregarPosts() {
  if (!mapa) return

  const b     = mapa.getBounds()
  const agora = new Date().toISOString()

  const { data: posts, error } = await db
    .from('posts')
    .select('*')
    .gte('pos_x', Math.round(b.getWest()))
    .lte('pos_x', Math.round(b.getEast()))
    .gte('pos_y', Math.round(b.getSouth()))
    .lte('pos_y', Math.round(b.getNorth()))
    .or(`expires_at.is.null,expires_at.gt.${agora}`)

  if (error || !posts) return

  // remove marcadores que não estão mais na área
  for (const id in postsMarcadores) {
    if (!posts.find(p => p.id === id)) {
      mapa.removeLayer(postsMarcadores[id])
      delete postsMarcadores[id]
    }
  }

  // adiciona novos
  for (const post of posts) {
    if (!postsMarcadores[post.id]) {
      const m = criarMarcadorPost(post)
      if (m) { m.addTo(mapa); postsMarcadores[post.id] = m }
    }
  }
}

// ── MARCADOR NO MAPA ──────────────────────────────────

function criarMarcadorPost(post) {
  const html = cardMini(post)
  if (!html) return null

  const icone = L.divIcon({
    className: '',
    html,
    iconSize:   [200, 'auto'],
    iconAnchor: [100, 0],
  })

  const m = L.marker([post.pos_y, post.pos_x], { icon: icone })
  m.bindPopup(() => cardCompleto(post), { maxWidth: 280 })
  return m
}

// ── CARD MINI ─────────────────────────────────────────

function cardMini(post) {
  const isStory = !!post.expires_at
  const tempo   = isStory ? tempoRestante(post.expires_at) : null

  const badge = isStory ? `
    <div style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.55);
      color:white;font-size:10px;padding:2px 6px;border-radius:20px;
      font-family:system-ui;font-weight:500;z-index:1">${tempo}</div>` : ''

  const base = `position:relative;border-radius:10px;overflow:hidden;
    border:${isStory ? '2px solid #7C3AED' : '0.5px solid rgba(0,0,0,0.12)'};
    background:white;width:200px;font-family:system-ui;cursor:pointer;
    box-shadow:0 2px 10px rgba(0,0,0,0.08);`

  switch (post.tipo) {

    case 'link':
      return `<div style="${base}">
        ${post.imagem_url
          ? `<img src="${post.imagem_url}" style="width:100%;height:100px;object-fit:cover">`
          : `<div style="height:40px;background:#EFF6FF;display:flex;align-items:center;
              padding:0 10px;font-size:11px;color:#2563EB;font-weight:500">
              ${tryHost(post.conteudo)}</div>`}
        <div style="padding:8px 10px">
          <div style="font-size:12px;font-weight:500;color:#1a1a18;line-height:1.4;
            margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;
            -webkit-box-orient:vertical;overflow:hidden">
            ${post.titulo || post.conteudo}
          </div>
          <div style="font-size:10px;color:#9c9a92">${tryHost(post.conteudo)}</div>
        </div>${badge}</div>`

    case 'imagem':
      return `<div style="${base}">
        <img src="${post.conteudo}" style="width:100%;height:120px;object-fit:cover;display:block"
          onerror="this.style.display='none'">
        ${post.titulo ? `<div style="padding:6px 10px;font-size:12px;color:#1a1a18">${post.titulo}</div>` : ''}
        ${badge}</div>`

    case 'texto':
      return `<div style="${base}padding:10px 12px;">
        <div style="font-size:13px;color:#1a1a18;line-height:1.5;
          display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden">
          ${post.conteudo}
        </div>${badge}</div>`

    case 'youtube': {
      const id = ytId(post.conteudo)
      return `<div style="${base}">
        <div style="position:relative">
          ${id ? `<img src="https://img.youtube.com/vi/${id}/mqdefault.jpg"
            style="width:100%;height:110px;object-fit:cover;display:block">`
            : `<div style="height:110px;background:#FF0000;display:flex;
                align-items:center;justify-content:center;color:white;font-size:24px">▶</div>`}
          <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,0.65);
            color:white;border-radius:4px;padding:2px 6px;font-size:10px">YouTube</div>
        </div>
        ${post.titulo ? `<div style="padding:6px 10px;font-size:12px;color:#1a1a18">${post.titulo}</div>` : ''}
        ${badge}</div>`
    }

    case 'spotify':
      return `<div style="${base}padding:10px 12px;display:flex;align-items:center;gap:8px;">
        <div style="width:32px;height:32px;border-radius:50%;background:#1DB954;
          display:flex;align-items:center;justify-content:center;
          flex-shrink:0;color:white;font-size:14px">♪</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:500;color:#1a1a18;
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
            ${post.titulo || 'música'}
          </div>
          <div style="font-size:10px;color:#9c9a92">Spotify</div>
        </div>${badge}</div>`

    default: return null
  }
}

// ── CARD COMPLETO (popup) ─────────────────────────────

function cardCompleto(post) {
  const el = document.createElement('div')
  el.style.cssText = 'font-family:system-ui;font-size:13px;padding:14px;min-width:240px'

  if (post.expires_at) {
    el.innerHTML = `<div style="display:inline-flex;align-items:center;gap:4px;
      background:#EDE9FE;color:#7C3AED;font-size:11px;padding:3px 8px;
      border-radius:20px;margin-bottom:10px;font-weight:500">
      story · expira em ${tempoRestante(post.expires_at)}</div>`
  }

  switch (post.tipo) {
    case 'link':
      el.innerHTML += `<a href="${post.conteudo}" target="_blank" style="text-decoration:none">
        ${post.imagem_url ? `<img src="${post.imagem_url}" style="width:100%;height:140px;
          object-fit:cover;border-radius:8px;margin-bottom:8px;display:block">` : ''}
        <div style="font-size:13px;font-weight:500;color:#2563EB;line-height:1.4;margin-bottom:4px">
          ${post.titulo || 'abrir link'}</div>
        <div style="font-size:11px;color:#9c9a92">${tryHost(post.conteudo)}</div>
      </a>`
      break

    case 'imagem':
      el.innerHTML += `<img src="${post.conteudo}"
        style="width:100%;border-radius:8px;display:block;margin-bottom:8px">
        ${post.titulo ? `<div style="font-size:13px;color:#1a1a18">${post.titulo}</div>` : ''}`
      break

    case 'texto':
      el.innerHTML += `<div style="font-size:14px;color:#1a1a18;line-height:1.6">
        ${post.conteudo}</div>`
      break

    case 'youtube': {
      const id = ytId(post.conteudo)
      el.innerHTML += id
        ? `<div style="position:relative;padding-bottom:56.25%;height:0;
            overflow:hidden;border-radius:8px">
            <iframe src="https://www.youtube.com/embed/${id}" frameborder="0"
              style="position:absolute;top:0;left:0;width:100%;height:100%"
              allowfullscreen></iframe></div>`
        : `<a href="${post.conteudo}" target="_blank">${post.conteudo}</a>`
      break
    }

    case 'spotify': {
      const id = spotifyId(post.conteudo)
      el.innerHTML += id
        ? `<iframe src="https://open.spotify.com/embed/track/${id}"
            width="100%" height="80" frameborder="0"
            allow="encrypted-media" style="border-radius:8px"></iframe>`
        : `<a href="${post.conteudo}" target="_blank">${post.conteudo}</a>`
      break
    }
  }

  // botão deletar só para o autor
  db.auth.getUser().then(({ data: { user } }) => {
    if (user && post.user_id === user.id) {
      const btn = document.createElement('button')
      btn.textContent = 'remover post'
      btn.style.cssText = `
        margin-top:10px;width:100%;padding:6px;font-size:12px;
        border:0.5px solid rgba(220,38,38,.3);border-radius:8px;
        background:#FEF2F2;color:#DC2626;cursor:pointer;font-family:system-ui`
      btn.onclick = () => deletarPost(post.id)
      el.appendChild(btn)
    }
  })

  return el
}

// ── MODAL DE NOVO POST ────────────────────────────────

function abrirModalPost() {
  if (!document.getElementById('modal-post')) criarModalPost()
  verificarPostExistente()
  document.getElementById('modal-post').classList.add('aberto')
}

function fecharModalPost() {
  document.getElementById('modal-post')?.classList.remove('aberto')
}

function criarModalPost() {
  const modal = document.createElement('div')
  modal.id = 'modal-post'
  modal.className = 'modal-overlay'

  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <span class="modal-titulo">novo post no mapa</span>
        <button class="modal-fechar" onclick="fecharModalPost()">×</button>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
        ${['link','imagem','texto','youtube','spotify'].map(t => `
          <button onclick="selecionarTipo('${t}')" id="tipo-${t}" style="
            padding:5px 12px;font-size:12px;font-weight:500;border-radius:20px;
            border:0.5px solid var(--border2);background:none;
            color:var(--text2);cursor:pointer;font-family:var(--font);
            transition:all .15s">${t}</button>`).join('')}
        <button onclick="selecionarTipo('story')" id="tipo-story" style="
          padding:5px 12px;font-size:12px;font-weight:500;border-radius:20px;
          border:0.5px solid #7C3AED;background:#EDE9FE;color:#7C3AED;
          cursor:pointer;font-family:var(--font)">story 48h ✦</button>
      </div>

      <div id="post-campos"></div>

      <div id="aviso-unico" style="display:none;font-size:12px;color:#D97706;
        background:#FFFBEB;border:0.5px solid rgba(217,119,6,.2);
        border-radius:8px;padding:8px 10px;margin-bottom:10px">
        você já tem um post. publicar vai substituir o anterior.
      </div>

      <button onclick="publicarPost()" style="
        width:100%;padding:10px;font-size:13px;font-weight:500;
        border-radius:var(--radius);border:0.5px solid var(--blue);
        background:var(--blue-bg);color:var(--blue);cursor:pointer;
        font-family:var(--font);transition:all .15s"
        onmouseover="this.style.background=getComputedStyle(document.documentElement).getPropertyValue('--blue');this.style.color='white'"
        onmouseout="this.style.background=getComputedStyle(document.documentElement).getPropertyValue('--blue-bg');this.style.color=getComputedStyle(document.documentElement).getPropertyValue('--blue')">
        publicar no mapa
      </button>
    </div>
  `

  document.body.appendChild(modal)
  modal.addEventListener('click', e => { if (e.target === modal) fecharModalPost() })
  selecionarTipo('link')
}

async function verificarPostExistente() {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return
  const { data } = await db.from('posts').select('id').eq('user_id', user.id).limit(1)
  const aviso = document.getElementById('aviso-unico')
  if (aviso) aviso.style.display = (data?.length > 0) ? 'block' : 'none'
}

function selecionarTipo(tipo) {
  tipoAtual = tipo

  // reset visual
  document.querySelectorAll('[id^="tipo-"]').forEach(b => {
    b.style.background  = 'none'
    b.style.color       = 'var(--text2)'
    b.style.borderColor = 'var(--border2)'
  })

  // destaque selecionado
  const btn = document.getElementById('tipo-' + tipo)
  if (btn) {
    if (tipo === 'story') {
      btn.style.background  = '#EDE9FE'
      btn.style.color       = '#7C3AED'
      btn.style.borderColor = '#7C3AED'
    } else {
      btn.style.background  = 'var(--blue-bg)'
      btn.style.color       = 'var(--blue)'
      btn.style.borderColor = 'var(--blue)'
    }
  }

  const campos = document.getElementById('post-campos')
  const input  = `width:100%;padding:10px 12px;font-size:13px;
    border:0.5px solid var(--border2);border-radius:var(--radius);
    background:var(--bg);color:var(--text);font-family:var(--font);
    margin-bottom:10px;outline:none;box-sizing:border-box;`

  const ph = {
    link:    'cole a url (ex: g1.globo.com/...)',
    youtube: 'cole o link do youtube',
    spotify: 'cole o link do spotify',
  }

  if (tipo === 'texto') {
    campos.innerHTML = `<textarea id="post-conteudo"
      placeholder="o que você quer dizer?"
      style="${input}resize:none;" rows="4"></textarea>`

  } else if (tipo === 'story') {
    campos.innerHTML = `
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.6">
        cole um link, url de imagem ou escreva um texto.<br>
        some automaticamente após <strong>48 horas</strong>.
      </div>
      <input id="post-conteudo" type="text"
        placeholder="link, url de imagem ou texto curto"
        style="${input}">
      <input id="post-titulo" type="text"
        placeholder="legenda (opcional)" style="${input}">`

  } else if (tipo === 'imagem') {
    campos.innerHTML = `
      <input id="post-conteudo" type="url"
        placeholder="url da imagem (ex: i.imgur.com/...)" style="${input}">
      <input id="post-titulo" type="text"
        placeholder="legenda (opcional)" style="${input}">`

  } else {
    campos.innerHTML = `<input id="post-conteudo" type="url"
      placeholder="${ph[tipo] || 'url'}" style="${input}">`
  }
}

async function publicarPost() {
  const conteudo = document.getElementById('post-conteudo')?.value?.trim()
  if (!conteudo) { mostrarToast('preencha o conteúdo do post.'); return }

  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  // remove post anterior
  await db.from('posts').delete().eq('user_id', user.id)
  for (const id in postsMarcadores) {
    mapa.removeLayer(postsMarcadores[id])
    delete postsMarcadores[id]
  }

  const centro = mapa.getCenter()
  const pos_x  = Math.round(centro.lng) + Math.round((Math.random() - .5) * 160)
  const pos_y  = Math.round(centro.lat) + Math.round((Math.random() - .5) * 160)

  let titulo     = document.getElementById('post-titulo')?.value?.trim() || ''
  let imagem_url = ''

  // Open Graph para links
  if (tipoAtual === 'link' || (tipoAtual === 'story' && conteudo.startsWith('http'))) {
    try {
      const og = await openGraph(conteudo)
      if (!titulo) titulo = og.titulo
      imagem_url = og.imagem
    } catch (e) {}
  }

  // thumbnail YouTube
  if (tipoAtual === 'youtube') {
    const id = ytId(conteudo)
    if (id) imagem_url = `https://img.youtube.com/vi/${id}/mqdefault.jpg`
  }

  const expires_at = tipoAtual === 'story'
    ? new Date(Date.now() + 48 * 3600000).toISOString()
    : null

  const tipoReal = tipoAtual === 'story'
    ? (conteudo.startsWith('http') ? 'link' : 'texto')
    : tipoAtual

  const { error } = await db.from('posts').insert({
    user_id: user.id, tipo: tipoReal,
    conteudo, titulo, imagem_url, pos_x, pos_y, expires_at,
  })

  if (error) { mostrarToast('erro ao publicar.'); return }

  fecharModalPost()
  mostrarToast('post publicado!')
  await carregarPosts()
}

async function deletarPost(id) {
  const { error } = await db.from('posts').delete().eq('id', id)
  if (!error && postsMarcadores[id]) {
    mapa.removeLayer(postsMarcadores[id])
    delete postsMarcadores[id]
    mostrarToast('post removido.')
  }
}

// ── OPEN GRAPH ────────────────────────────────────────

async function openGraph(url) {
  try {
    const res  = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`)
    const json = await res.json()
    return { titulo: json.data?.title || '', imagem: json.data?.image?.url || '' }
  } catch { return { titulo: '', imagem: '' } }
}

// ── HELPERS ───────────────────────────────────────────

function tempoRestante(expiresAt) {
  const diff = new Date(expiresAt) - new Date()
  if (diff <= 0) return 'expirado'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  return h > 0 ? `${h}h` : `${m}min`
}

function ytId(url) {
  try {
    const u = new URL(url)
    return u.searchParams.get('v') ||
      (u.hostname === 'youtu.be' ? u.pathname.slice(1) : null)
  } catch { return null }
}

function spotifyId(url) {
  try {
    const p = new URL(url).pathname.split('/')
    const i = p.indexOf('track')
    return i !== -1 ? p[i + 1] : null
  } catch { return null }
}

function tryHost(url) {
  try { return new URL(url).hostname } catch { return url }
}