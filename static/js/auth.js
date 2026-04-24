// ─────────────────────────────────────────────────────
// auth.js — autenticação e perfil com Supabase
// ─────────────────────────────────────────────────────

// ── FUNÇÕES DE AUTENTICAÇÃO ───────────────────────────

async function login() {
  const email = document.getElementById('email').value.trim()
  const senha = document.getElementById('senha').value

  if (!email || !senha) {
    mostrarMensagem('Preencha email e senha.', 'erro')
    return
  }

  const { data, error } = await db.auth.signInWithPassword({
    email,
    password: senha
  })

  if (error) {
    mostrarMensagem('Email ou senha incorretos.', 'erro')
    return
  }

  mostrarMapa(data.user)
}

async function cadastrar() {
  const email = document.getElementById('email-cad').value.trim()
  const senha = document.getElementById('senha-cad').value

  if (!email || !senha) {
    mostrarMensagem('Preencha todos os campos.', 'erro')
    return
  }

  if (senha.length < 6) {
    mostrarMensagem('Senha deve ter pelo menos 6 caracteres.', 'erro')
    return
  }

  const { error } = await db.auth.signUp({ email, password: senha })

  if (error) {
    mostrarMensagem('Erro: ' + error.message, 'erro')
    return
  }

  mostrarMensagem('Conta criada! Verifique seu email para confirmar.', 'sucesso')
}

async function loginGoogle() {
  await db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  })
}

async function sair() {
  // avisa o servidor Flask que saiu
  const { data: { user } } = await db.auth.getUser()
  if (user) {
    try {
      await fetch(SERVIDOR + '/leave', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: user.email.split('@')[0] })
      })
    } catch (e) {}
  }

  await db.auth.signOut()
  location.reload()
}

// ── FUNÇÕES DE PERFIL ─────────────────────────────────

async function carregarPerfil() {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return null

  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) return null
  return data
}

async function salvarPerfil(dados) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  const { error } = await db
    .from('profiles')
    .upsert({
      id:      user.id,
      nome:    dados.nome,
      bio:     dados.bio,
      foto:    dados.foto,
      links:   dados.links,
      spotify: dados.spotify,
    })

  if (error) {
    alert('Erro ao salvar perfil: ' + error.message)
    return
  }

  // fecha o modal de perfil
  fecharPerfil()
}

async function salvarPosicao(x, y) {
  const { data: { user } } = await db.auth.getUser()
  if (!user) return

  await db
    .from('profiles')
    .update({ mapa_x: Math.round(x), mapa_y: Math.round(y) })
    .eq('id', user.id)
}

// ── MODAL DE PERFIL ───────────────────────────────────

async function abrirPerfil() {
  const perfil = await carregarPerfil()
  if (!perfil) return

  // cria o modal se não existir
  if (!document.getElementById('modal-perfil')) {
    criarModalPerfil()
  }

  // preenche os campos com dados atuais
  document.getElementById('p-nome').value    = perfil.nome    || ''
  document.getElementById('p-bio').value     = perfil.bio     || ''
  document.getElementById('p-foto').value    = perfil.foto    || ''
  document.getElementById('p-spotify').value = perfil.spotify || ''

  // links
  const linksContainer = document.getElementById('p-links')
  linksContainer.innerHTML = ''
  const links = perfil.links || ['']
  links.forEach(l => adicionarCampoLink(l))

  document.getElementById('modal-perfil').style.display = 'flex'
}

function fecharPerfil() {
  const modal = document.getElementById('modal-perfil')
  if (modal) modal.style.display = 'none'
}

function criarModalPerfil() {
  const modal = document.createElement('div')
  modal.id = 'modal-perfil'
  modal.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0,0,0,0.4);
    display: none; align-items: center; justify-content: center;
    padding: 24px;
  `

  modal.innerHTML = `
    <div style="
      background: var(--bg);
      border-radius: 16px;
      padding: 28px;
      width: 100%;
      max-width: 400px;
      max-height: 90vh;
      overflow-y: auto;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <span style="font-size:16px;font-weight:500;color:var(--text)">Editar perfil</span>
        <button onclick="fecharPerfil()" style="
          background:none;border:none;font-size:20px;
          color:var(--text2);cursor:pointer;line-height:1
        ">×</button>
      </div>

      <label class="campo-label">Nome</label>
      <input class="campo-input" id="p-nome" type="text" placeholder="Seu nome" maxlength="30">

      <label class="campo-label">Bio <span style="font-weight:400;color:var(--text2)" id="bio-count"></span></label>
      <textarea class="campo-input" id="p-bio" rows="3"
        placeholder="Uma frase curta sobre você"
        maxlength="120"
        oninput="document.getElementById('bio-count').textContent='('+this.value.length+'/120)'"
        style="resize:none"></textarea>

      <label class="campo-label">Foto (URL)</label>
      <input class="campo-input" id="p-foto" type="url" placeholder="https://...">

      <label class="campo-label">Links</label>
      <div id="p-links"></div>
      <button onclick="adicionarCampoLink('')" style="
        background:none;border:none;
        font-size:12px;color:var(--blue);
        cursor:pointer;padding:0;margin-bottom:14px;
        font-family:inherit;
      ">+ adicionar link</button>

      <label class="campo-label">Spotify (link de uma música)</label>
      <input class="campo-input" id="p-spotify" type="url" placeholder="https://open.spotify.com/track/...">

      <button class="btn btn-primary" onclick="coletarESalvarPerfil()">Salvar perfil</button>
    </div>
  `

  document.body.appendChild(modal)

  // fecha ao clicar fora
  modal.addEventListener('click', (e) => {
    if (e.target === modal) fecharPerfil()
  })
}

function adicionarCampoLink(valor = '') {
  const container = document.getElementById('p-links')
  const row = document.createElement('div')
  row.style.cssText = 'display:flex;gap:6px;margin-bottom:8px'
  row.innerHTML = `
    <input class="campo-input" type="url"
      value="${valor}"
      placeholder="https://github.com/voce"
      style="margin-bottom:0;flex:1">
    <button onclick="this.parentElement.remove()" style="
      background:none;border:0.5px solid var(--border);
      border-radius:8px;padding:0 10px;
      color:var(--text2);cursor:pointer;font-size:16px;
      flex-shrink:0;
    ">×</button>
  `
  container.appendChild(row)
}

async function coletarESalvarPerfil() {
  const links = [...document.querySelectorAll('#p-links input')]
    .map(i => i.value.trim())
    .filter(Boolean)

  await salvarPerfil({
    nome:    document.getElementById('p-nome').value.trim(),
    bio:     document.getElementById('p-bio').value.trim(),
    foto:    document.getElementById('p-foto').value.trim(),
    links,
    spotify: document.getElementById('p-spotify').value.trim(),
  })
}

// ── HELPERS ───────────────────────────────────────────

function mostrarMensagem(texto, tipo) {
  const el = document.getElementById('mensagem')
  if (!el) return
  el.textContent = texto
  el.className = 'mensagem ' + tipo
}

function mostrarCadastro() {
  document.getElementById('form-login').style.display = 'none'
  document.getElementById('form-cadastro').style.display = 'block'
  document.getElementById('login-sub').textContent = 'Crie sua conta gratuitamente'
  document.getElementById('mensagem').className = 'mensagem'
}

function mostrarLogin() {
  document.getElementById('form-cadastro').style.display = 'none'
  document.getElementById('form-login').style.display = 'block'
  document.getElementById('login-sub').textContent = 'Entre para explorar o mapa'
  document.getElementById('mensagem').className = 'mensagem'
}