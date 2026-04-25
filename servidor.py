from gevent import monkey
monkey.patch_all()

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sock import Sock
import time, json, logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins="*")
sock = Sock(app)

usuarios = {}  # { nome: { x, y, foto, visto } }
conexoes = {}  # { nome: ws }

# ── HTTP ──────────────────────────────────────────────

@app.route("/")
def index():
    return jsonify({"status": "ok", "usuarios": len(usuarios)})

@app.route("/register", methods=["POST"])
def registrar():
    dados = request.get_json()
    if not dados or "nome" not in dados:
        return jsonify({"erro": "nome obrigatorio"}), 400
    nome = dados["nome"].strip()
    usuarios[nome] = {
        "x":     dados.get("x", 2500),
        "y":     dados.get("y", 2500),
        "foto":  dados.get("foto", ""),
        "visto": time.time()
    }
    log.info(f"registrado: {nome}")
    return jsonify({"ok": True})

@app.route("/users", methods=["GET"])
def listar():
    agora  = time.time()
    ativos = {n: i for n, i in usuarios.items() if agora - i["visto"] < 120}
    return jsonify(ativos)

@app.route("/leave", methods=["DELETE"])
def sair():
    dados = request.get_json()
    nome  = dados.get("nome", "") if dados else ""
    usuarios.pop(nome, None)
    log.info(f"saiu: {nome}")
    return jsonify({"ok": True})

# ── WEBSOCKET ─────────────────────────────────────────

@sock.route("/ws/<nome>")
def websocket(ws, nome):
    nome = nome.strip()
    conexoes[nome] = ws
    log.info(f"ws conectou: {nome} | online: {list(conexoes.keys())}")

    try:
        while True:
            # timeout de 30s — se não receber nada, envia ping
            msg = ws.receive(timeout=30)

            if msg is None:
                try:
                    ws.send(json.dumps({"tipo": "ping"}))
                    continue
                except Exception:
                    break

            try:
                dados = json.loads(msg)
            except Exception:
                continue

            tipo    = dados.get("tipo", "")
            destino = dados.get("para", "").strip()

            # ignora pings
            if tipo == "ping":
                continue

            log.info(f"sinal: {nome} → {destino} [{tipo}]")

            if destino and destino in conexoes:
                try:
                    conexoes[destino].send(msg)
                except Exception as e:
                    log.warning(f"erro repassando para {destino}: {e}")
                    conexoes.pop(destino, None)
            else:
                log.warning(f"destino nao encontrado: '{destino}' | online: {list(conexoes.keys())}")

    except Exception as e:
        log.warning(f"ws [{nome}] erro: {e}")
    finally:
        conexoes.pop(nome, None)
        log.info(f"ws desconectou: {nome}")

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)