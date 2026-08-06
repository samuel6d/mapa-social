const CONFIG = {
  // Supabase — painel em supabase.com → Project Settings → API
  SUPABASE_URL: 'https://fkjllotmvxsrawzavchd.supabase.co',
  SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZramxsb3RtdnhzcmF3emF2Y2hkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTA4NTEsImV4cCI6MjA5MjAyNjg1MX0.eyo_tM8MqIT07CiGLGPuIXcDdrfbcTw-dEM6ZyFWhh0',

  // Railway — URL gerada em Settings → Networking
  SERVIDOR: 'https://mapa-social.up.railway.app',
}

const { createClient } = supabase
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY)
const SERVIDOR = CONFIG.SERVIDOR