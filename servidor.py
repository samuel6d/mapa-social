from gevent import monkey
monkey.patch_all()

from flask import Flask, request, jsonify
from flask_cors import CORS
from geventwebsocket.handler import WebSocketHandler
from geventwebsocket.websocket import WebSocketError
import time, json, logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app, origins="*")

usuarios = {}
conexoes = {}

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

@app.route("/ws/<nome>")
def websocket(nome):
    log.info(f"requisicao recebida em /ws/{nome}")
    ws = request.environ.get("wsgi.websocket")
    log.info(f"wsgi.websocket = {ws}")

    if not ws:
        return "use WebSocket", 200

    nome = nome.strip()
    conexoes[nome] = ws
    log.info(f"ws conectou: {nome} | online: {list(conexoes.keys())}")

    try:
        while True:
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
                    log.warning(f"erro: {e}")
                    conexoes.pop(destino, None)
            else:
                log.warning(f"destino '{destino}' nao encontrado | online: {list(conexoes.keys())}")
    except WebSocketError as e:
        log.warning(f"ws [{nome}] erro: {e}")
    except Exception as e:
        log.warning(f"ws [{nome}] excecao: {e}")
    finally:
        conexoes.pop(nome, None)
        log.info(f"ws desconectou: {nome}")

    return ""