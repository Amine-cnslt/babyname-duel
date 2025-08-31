import os
from flask import Flask, send_from_directory

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, "dist")

app = Flask(__name__, static_folder=os.path.join(DIST_DIR, "assets"), static_url_path="/assets")

@app.route("/")
def index():
    return send_from_directory(DIST_DIR, "index.html")

@app.route("/<path:path>")
def catch_all(path):
    full = os.path.join(DIST_DIR, path)
    if os.path.isfile(full):
        return send_from_directory(DIST_DIR, os.path.relpath(full, DIST_DIR))
    return send_from_directory(DIST_DIR, "index.html")

application = app
