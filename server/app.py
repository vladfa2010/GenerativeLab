"""Расслоение — сервер диалогов. Состояние в памяти процесса."""
import asyncio
import json
import random
import time
import uuid
from pathlib import Path

from aiohttp import web

STATIC_DIR = Path(__file__).resolve().parent.parent
STATE_FILE = Path(__file__).resolve().parent / "rooms.json"
rooms: dict[str, dict] = {}


def persist():
    data = [{k: v for k, v in r.items() if k != "clients"} for r in rooms.values()]
    STATE_FILE.write_text(json.dumps(data, ensure_ascii=False))


def load_rooms():
    if STATE_FILE.exists():
        try:
            for r in json.loads(STATE_FILE.read_text()):
                r["clients"] = {}
                rooms[r["id"]] = r
        except Exception:
            pass


def new_room_id() -> str:
    while True:
        rid = "".join(str(random.randrange(10)) for _ in range(14))
        if rid not in rooms:
            return rid


def now_hhmm() -> str:
    t = time.localtime()
    return f"{t.tm_hour:02d}:{t.tm_min:02d}"


def make_room(title: str) -> dict:
    rid = new_room_id()
    room = {
        "id": rid,
        "title": title or f"Диалог ···{rid[-4:]}",
        "createdAt": int(time.time()),
        "notes": [],
        "theses": [],
        "clients": {},  # ws -> {name, dept, role}
    }
    rooms[rid] = room
    return room


def room_state(room: dict, include_notes: bool) -> dict:
    state = {
        "id": room["id"],
        "title": room["title"],
        "createdAt": room["createdAt"],
        "presence": list(room["clients"].values()),
        "theses": room["theses"],
    }
    if include_notes:
        state["notes"] = room["notes"]
    return state


async def broadcast(room: dict):
    dead = []
    for ws, info in room["clients"].items():
        try:
            await ws.send_json(
                {"t": "state", "room": room_state(room, include_notes=info.get("role") == "admin")}
            )
        except Exception:
            dead.append(ws)
    for ws in dead:
        room["clients"].pop(ws, None)


# ---------- HTTP API ----------

async def list_rooms(request: web.Request) -> web.Response:
    return web.json_response([
        {
            "id": r["id"],
            "title": r["title"],
            "createdAt": r["createdAt"],
            "theses": len(r["theses"]),
            "online": len(r["clients"]),
        }
        for r in sorted(rooms.values(), key=lambda r: -r["createdAt"])
    ])


async def create_room(request: web.Request) -> web.Response:
    data = await request.json() if request.can_read_body else {}
    room = make_room((data.get("title") or "").strip())
    persist()
    return web.json_response({"id": room["id"], "title": room["title"]})


async def delete_room(request: web.Request) -> web.Response:
    rid = request.match_info["id"]
    room = rooms.pop(rid, None)
    if room:
        for ws in list(room["clients"]):
            try:
                await ws.close()
            except Exception:
                pass
        persist()
    return web.json_response({"ok": room is not None})


# ---------- WebSocket ----------

async def ws_handler(request: web.Request) -> web.WebSocketResponse:
    rid = request.query.get("room", "")
    room = rooms.get(rid)
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    if not room:
        await ws.send_json({"t": "error", "error": "no_room"})
        await ws.close()
        return ws

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            t = data.get("t")

            if t == "join":
                room["clients"][ws] = {
                    "name": (data.get("name") or "?")[:40],
                    "dept": (data.get("dept") or "")[:40],
                    "role": data.get("role") if data.get("role") in ("admin", "participant") else "participant",
                }

            elif t == "note.add":
                room["notes"].insert(0, {
                    "id": uuid.uuid4().hex[:12],
                    "text": (data.get("text") or "")[:2000],
                    "time": now_hhmm(),
                    "published": False,
                    "fromName": (data.get("fromName") or "")[:40],
                    "fromDept": (data.get("fromDept") or "")[:40],
                })

            elif t == "note.publish":
                for n in room["notes"]:
                    if n["id"] == data.get("id") and not n["published"]:
                        n["published"] = True
                        room["theses"].insert(0, {
                            "id": uuid.uuid4().hex[:12],
                            "text": n["text"],
                            "author": n["fromName"] or "Админ",
                            "status": "draft",
                            "votes": {},
                            "comments": [],
                        })
                        break

            elif t == "propose":
                info = room["clients"].get(ws, {})
                room["notes"].insert(0, {
                    "id": uuid.uuid4().hex[:12],
                    "text": (data.get("text") or "")[:2000],
                    "time": now_hhmm(),
                    "published": False,
                    "fromName": info.get("name", "?"),
                    "fromDept": info.get("dept", ""),
                })

            elif t == "vote":
                info = room["clients"].get(ws, {})
                name = info.get("name")
                if not name:
                    continue
                for th in room["theses"]:
                    if th["id"] == data.get("id") and th["status"] != "closed":
                        v = data.get("v")
                        if v in (1, -1, 0):
                            th["votes"][name] = v
                        else:
                            th["votes"].pop(name, None)
                        break

            elif t == "status":
                info = room["clients"].get(ws, {})
                if info.get("role") != "admin":
                    continue
                order = {"draft": "vote", "vote": "final", "final": "draft"}
                for th in room["theses"]:
                    if th["id"] == data.get("id") and th["status"] != "closed":
                        th["status"] = order.get(th["status"], "draft")
                        break

            elif t in ("thesis.rename", "thesis.delete", "thesis.close"):
                info = room["clients"].get(ws, {})
                if info.get("role") != "admin":
                    continue
                tid = data.get("id")
                if t == "thesis.delete":
                    room["theses"] = [th for th in room["theses"] if th["id"] != tid]
                else:
                    for th in room["theses"]:
                        if th["id"] == tid:
                            if t == "thesis.rename":
                                txt = (data.get("text") or "").strip()[:2000]
                                if txt:
                                    th["text"] = txt
                            elif t == "thesis.close":
                                th["status"] = "closed" if th["status"] != "closed" else "vote"
                            break

            elif t == "comment":
                info = room["clients"].get(ws, {})
                for th in room["theses"]:
                    if th["id"] == data.get("id") and th["status"] != "closed":
                        th["comments"].append({
                            "who": info.get("name", "?"),
                            "dept": info.get("dept", ""),
                            "text": (data.get("text") or "")[:2000],
                            "type": data.get("ctype") if data.get("ctype") in ("pro", "con", "q") else "pro",
                        })
                        break

            persist()
            await broadcast(room)
    finally:
        room["clients"].pop(ws, None)
        await broadcast(room)
    return ws


# ---------- app ----------

async def index(request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


app = web.Application()
app.router.add_get("/api/rooms", list_rooms)
app.router.add_post("/api/rooms", create_room)
app.router.add_delete("/api/rooms/{id}", delete_room)
app.router.add_get("/ws", ws_handler)
app.router.add_get("/", index)
app.router.add_static("/", STATIC_DIR)

load_rooms()

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=8787)
