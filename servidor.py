from flask import Flask, request, jsonify
from flask_cors import CORS
from simple_websocket import Server, ConnectionClosed
import time, json, logging, threading

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins="*")

usuarios = {}   # { nome: { x, y, foto, visto } }
conexoes = {}   # { nome: ws }
lock     = threading.Lock()

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
    with lock:
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
    agora = time.time()
    with lock:
        ativos = {n: i for n, i in usuarios.items() if agora - i["visto"] < 120}
    return jsonify(ativos)

@app.route("/leave", methods=["DELETE"])
def sair():
    dados = request.get_json()
    nome  = dados.get("nome", "") if dados else ""
    with lock:
        usuarios.pop(nome, None)
    log.info(f"saiu: {nome}")
    return jsonify({"ok": True})

# ── WEBSOCKET ─────────────────────────────────────────

@app.route("/ws/<nome>")
def websocket(nome):
    nome = nome.strip()
    ws   = Server.accept(request.environ)

    with lock:
        conexoes[nome] = ws
    log.info(f"ws conectou: {nome} | online: {list(conexoes.keys())}")

    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break

            try:
                dados   = json.loads(msg)
                tipo    = dados.get("tipo", "")
                destino = dados.get("para", "").strip()
            except Exception:
                continue

            if tipo == "ping":
                continue

            log.info(f"sinal: {nome} → {destino} [{tipo}]")

            with lock:
                dest_ws = conexoes.get(destino)

            if dest_ws:
                try:
                    dest_ws.send(msg)
                except Exception as e:
                    log.warning(f"erro repassando para {destino}: {e}")
                    with lock:
                        conexoes.pop(destino, None)
            else:
                log.warning(
                    f"destino nao encontrado: '{destino}' "
                    f"| online: {list(conexoes.keys())}"
                )

    except ConnectionClosed:
        log.info(f"ws desconectou: {nome}")
    except Exception as e:
        log.warning(f"ws [{nome}] erro: {e}")
    finally:
        with lock:
            conexoes.pop(nome, None)
        log.info(f"ws removido: {nome}")

    return ""

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True, port=5000)