from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sock import Sock
import time, json

app = Flask(__name__)
CORS(app)
sock = Sock(app)

# usuários online ficam aqui na memória
usuarios = {}
# conexões WebSocket abertas (para sinalização WebRTC)
conexoes = {}

# ── rota 1: registrar / atualizar posição ──────────────
@app.route("/register", methods=["POST"])
def registrar():
    dados = request.get_json()
    nome = dados["nome"]
    usuarios[nome] = {
        "x":    dados["x"],
        "y":    dados["y"],
        "foto": dados.get("foto", ""),
        "visto": time.time()
    }
    return jsonify({"ok": True})

# ── rota 2: listar quem está online ───────────────────
@app.route("/users", methods=["GET"])
def listar():
    agora = time.time()
    ativos = {
        nome: info for nome, info in usuarios.items()
        if agora - info["visto"] < 120  # ativo nos últimos 2min
    }
    return jsonify(ativos)

# ── rota 3: sair do mapa ──────────────────────────────
@app.route("/leave", methods=["DELETE"])
def sair():
    nome = request.get_json().get("nome")
    usuarios.pop(nome, None)
    return jsonify({"ok": True})

# ── rota 4: sinalização WebRTC via WebSocket ──────────
@sock.route("/ws/<nome>")
def websocket(ws, nome):
    conexoes[nome] = ws
    try:
        while True:
            msg = ws.receive()
            if msg is None:
                break
            dados = json.loads(msg)
            destino = dados.get("para")
            if destino and destino in conexoes:
                conexoes[destino].send(msg)
    finally:
        conexoes.pop(nome, None)
        usuarios.pop(nome, None)

if __name__ == "__main__":
    app.run(debug=True, port=5000)