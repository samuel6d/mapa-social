from gevent import monkey
monkey.patch_all()

from gevent import pywsgi
from geventwebsocket.handler import WebSocketHandler
from geventwebsocket.websocket import WebSocketError
from flask import Flask, request, jsonify
from flask_cors import CORS
import time, json, logging, os

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins="*")

usuarios = {}
conexoes = {}

# ── HTTP via Flask ────────────────────────────────────

@app.route("/")
def index():
    return jsonify({"status": "ok", "online": len(conexoes)})

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
    return jsonify({"ok": True})

# ── WEBSOCKET via geventwebsocket direto ──────────────

def handle_websocket(ws, nome):
    nome = nome.strip()
    conexoes[nome] = ws
    log.info(f"ws conectou: {nome} | online: {list(conexoes.keys())}")

    try:
        while not ws.closed:
            msg = ws.receive()
            if msg is None:
                break
            if not msg.strip():
                continue
            try:
                dados   = json.loads(msg)
                tipo    = dados.get("tipo", "")
                destino = dados.get("para", "").strip()
            except json.JSONDecodeError:
                continue
            if tipo == "ping":
                continue
            log.info(f"sinal: {nome} -> {destino} [{tipo}]")
            if destino and destino in conexoes:
                try:
                    conexoes[destino].send(msg)
                    log.info(f"repassado para: {destino}")
                except Exception as e:
                    log.warning(f"erro ao repassar: {e}")
                    conexoes.pop(destino, None)
            else:
                log.warning(
                    f"destino '{destino}' nao encontrado "
                    f"| online: {list(conexoes.keys())}"
                )
    except WebSocketError as e:
        log.warning(f"ws [{nome}] erro: {e}")
    except Exception as e:
        log.warning(f"ws [{nome}] excecao: {e}")
    finally:
        conexoes.pop(nome, None)
        log.info(f"ws desconectou: {nome}")

# ── ROTEADOR PRINCIPAL ────────────────────────────────
# Intercepta /ws/* para WebSocket, resto vai para Flask

def application(environ, start_response):
    path = environ.get("PATH_INFO", "")

    # rota WebSocket
    if path.startswith("/ws/"):
        ws = environ.get("wsgi.websocket")
        if ws:
            nome = path.replace("/ws/", "")
            handle_websocket(ws, nome)
            return []
        else:
            # requisição HTTP normal na rota WebSocket
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [b"use WebSocket"]

    # todas as outras rotas vão para o Flask
    return app(environ, start_response)

# ── INICIAR SERVIDOR ──────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info(f"iniciando servidor na porta {port}")
    server = pywsgi.WSGIServer(
        ("0.0.0.0", port),
        application,
        handler_class=WebSocketHandler
    )
    server.serve_forever()