import sys
import os
import json
import time
import math
import threading

# Force UTF-8 on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Optional load_dotenv (Node.js already passes env vars)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Optional simple_chalk fallback
try:
    from simple_chalk import chalk
except ImportError:
    class ChalkFallback:
        def __getattr__(self, name):
            return lambda msg: str(msg)
    chalk = ChalkFallback()

from javascript import require, On, Once, AsyncTask, off

# Import the javascript libraries
mineflayer = require("mineflayer")
mineflayer_pathfinder = require("mineflayer-pathfinder")
vec3 = require("vec3")

CONFIG = {
    "host": os.getenv("MC_HOST", "id-1.zknesia.app"),
    "port": int(os.getenv("MC_PORT", "25675")),
    "username": os.getenv("MC_USERNAME", "Ritian223"),
    "version": os.getenv("MC_VERSION", "1.21.1"),
    "auth": os.getenv("MC_AUTH", "offline"),
    "owners": [s.strip().lower() for s in os.getenv("MC_OWNERS", "rukaajah").split(",") if s.strip()]
}

def vec3_to_str(v):
    if not v:
        return "x: ?, y: ?, z: ?"
    return f"x: {v['x']:.2f}, y: {v['y']:.2f}, z: {v['z']:.2f}"

def send_ipc(ipc_type, data):
    """Mengirim event ke Node.js Controller via stdout JSON IPC"""
    msg = json.dumps({"ipc_type": ipc_type, "data": data})
    print(f"__IPC_MESSAGE_START__{msg}__IPC_MESSAGE_END__", flush=True)

def is_owner(username):
    if not username:
        return False
    return username.lower() in CONFIG["owners"]


class MCBot:
    def __init__(self, bot_name):
        self.bot_args = {
            "host": CONFIG["host"],
            "port": CONFIG["port"],
            "username": bot_name,
            "version": CONFIG["version"],
            "auth": CONFIG["auth"],
            "hideErrors": False,
        }
        self.reconnect = True
        self.bot_name = bot_name
        self.bot = None
        self.following_player = None
        self.loop_follow = False

        self.start_bot()

    def log(self, message, color="cyan"):
        fn = getattr(chalk, color, getattr(chalk, "cyan", lambda m: m))
        print(fn(f"[{self.bot_name}] {message}"), flush=True)

    def pathfind_to_goal(self, goal_location, range_dist=1):
        try:
            self.bot.pathfinder.setGoal(
                mineflayer_pathfinder.pathfinder.goals.GoalNear(
                    goal_location["x"], goal_location["y"], goal_location["z"], range_dist
                )
            )
        except Exception as e:
            self.log(f"Error while trying to run pathfind_to_goal: {e}", "red")

    def run_and_jump(self):
        """Manuver lompat bertenaga ala MineflayerPython 12-jumper-bot."""
        def do_jump():
            try:
                self.bot.setControlState("forward", True)
                time.sleep(0.05)
                self.bot.setControlState("sprint", True)
                self.bot.setControlState("jump", True)
                time.sleep(0.5)
                self.bot.clearControlStates()
            except Exception as e:
                self.log(f"Error run_and_jump: {e}", "red")

        t = threading.Thread(target=do_jump, daemon=True)
        t.start()

    def start_bot(self):
        self.log(f"Menghubungkan ke {CONFIG['host']}:{CONFIG['port']}...", "yellow")
        self.bot = mineflayer.createBot(self.bot_args)
        self.bot.loadPlugin(mineflayer_pathfinder.pathfinder)

        self.start_events()

    def find_player(self, sender, message=""):
        if not self.bot or not self.bot.players:
            return None, None
        local_players = self.bot.players
        for el in local_players:
            p = local_players[el]
            if not p:
                continue
            p_uuid = str(p.get("uuid", ""))
            p_username = str(p.get("username", "")).lower()
            
            # Cek kecocokan UUID pengirim atau owner
            if p_uuid == str(sender) or is_owner(p_username) or p_username in message.lower():
                if p.get("entity") and p["entity"].get("position"):
                    pos = p["entity"]["position"]
                    loc = vec3(pos["x"], pos["y"], pos["z"])
                    return p, loc
        return None, None

    def start_follow_loop(self, player_data):
        self.stop_follow()
        self.loop_follow = True

        def follow_worker():
            while self.loop_follow and self.bot and self.bot.entity:
                try:
                    if player_data and player_data.get("entity") and player_data["entity"].get("position"):
                        bp = self.bot.entity.position
                        pp = player_data["entity"]["position"]
                        dx = pp["x"] - bp["x"]
                        dy = pp["y"] - bp["y"]
                        dz = pp["z"] - bp["z"]
                        dist = math.sqrt(dx*dx + dy*dy + dz*dz)

                        if dist > 3.0:
                            self.pathfind_to_goal(pp, range_dist=2)
                        elif dist <= 2.0:
                            if self.bot.pathfinder.isMoving():
                                self.bot.pathfinder.setGoal(None)
                            try:
                                self.bot.lookAt(vec3(pp["x"], pp["y"] + 1.6, pp["z"]))
                            except Exception:
                                pass
                except Exception:
                    pass
                time.sleep(1.0)

        t = threading.Thread(target=follow_worker, daemon=True)
        t.start()

    def stop_follow(self):
        self.loop_follow = False
        if self.bot and self.bot.pathfinder:
            try:
                self.bot.pathfinder.setGoal(None)
                self.bot.clearControlStates()
            except Exception:
                pass

    def start_events(self):
        # Login event
        @On(self.bot, "login")
        def login(this, *args):
            self.log(chalk.green(f"Login sukses ke server {CONFIG['host']}:{CONFIG['port']}"))
            send_ipc("login", {"status": "success", "username": self.bot_name})

        # Spawn event
        @On(self.bot, "spawn")
        def spawn(this, *args):
            pos = self.bot.entity.position
            self.log(chalk.green(f"Spawn di posisi: {vec3_to_str(pos)}"))
            self.bot.chat("Nn... Shiroko siap bertugas, Sensei.")
            send_ipc("spawn", {"x": pos.x if hasattr(pos, 'x') else pos['x'], 
                               "y": pos.y if hasattr(pos, 'y') else pos['y'], 
                               "z": pos.z if hasattr(pos, 'z') else pos['z']})

        # Kicked event
        @On(self.bot, "kicked")
        def kicked(this, reason=None, loggedIn=None, *args):
            self.log(chalk.redBright(f"Kicked dari server: {reason}"))
            send_ipc("kicked", {"reason": str(reason)})

        # Messagestr event (Chat & Commands)
        @On(self.bot, "messagestr")
        def messagestr(this, message=None, messagePosition=None, jsonMsg=None, sender=None, verified=None, *args):
            if not message or not isinstance(message, str):
                return

            msg_lower = message.strip().lower()
            self.log(f"Chat: {message}")

            # 1. QUIT
            if "quit" in msg_lower or "keluar" in msg_lower:
                for o in CONFIG["owners"]:
                    if o in msg_lower or is_owner(str(sender)):
                        self.bot.chat("Nn. Sampai jumpa, Sensei.")
                        self.reconnect = False
                        this.quit()
                        return

            # 2. IKUT / FOLLOW
            if any(k in msg_lower for k in ["ikut", "follow", "ikuti aku"]):
                p_data, p_loc = self.find_player(sender, msg_lower)
                if p_loc:
                    self.bot.chat("Nn. Siap mengikuti Sensei.")
                    self.log(chalk.magenta(f"Following player at {vec3_to_str(p_loc)}"))
                    self.start_follow_loop(p_data)
                else:
                    self.bot.chat("Nn. Posisi Sensei belum terlihat.")
                return

            # 3. COME TO ME / KESINI / MASUK
            if any(k in msg_lower for k in ["come to me", "kesini", "ke sini", "masuk", "sini"]):
                self.stop_follow()
                p_data, p_loc = self.find_player(sender, msg_lower)
                if p_loc:
                    self.bot.chat("Nn. Menuju posisimu.")
                    self.log(chalk.magenta(f"Pathfinding to {vec3_to_str(p_loc)}"))
                    self.pathfind_to_goal(p_loc, range_dist=1)
                else:
                    self.bot.chat("Nn. Posisi tidak ditemukan.")
                return

            # 4. LOOK AT ME / LIHAT AKU
            if any(k in msg_lower for k in ["look at me", "lihat aku", "tatap"]):
                p_data, p_loc = self.find_player(sender, msg_lower)
                if p_loc:
                    try:
                        self.bot.lookAt(vec3(p_loc["x"], p_loc["y"] + 1.6, p_loc["z"]))
                        self.bot.chat("Nn. Aku melihatmu, Sensei.")
                    except Exception:
                        pass
                return

            # 5. JUMP / LOMPAT
            if any(k in msg_lower for k in ["lompat", "jump"]):
                self.bot.chat("Nn. Melompat!")
                self.run_and_jump()
                return

            # 6. STOP / BERHENTI
            if any(k in msg_lower for k in ["stop", "berhenti", "diam", "standby"]):
                self.stop_follow()
                self.bot.chat("Nn. Standby.")
                return

            # 7. STATUS / POSISI
            if any(k in msg_lower for k in ["status", "posisi"]):
                if self.bot.entity and self.bot.entity.position:
                    pos = self.bot.entity.position
                    self.bot.chat(f"Nn. Posisi: {pos.x:.0f}, {pos.y:.0f}, {pos.z:.0f} | HP: {self.bot.health}/20 | Food: {self.bot.food}/20")
                return

            # 8. BUKA / TUTUP PINTU
            if "pintu" in msg_lower or "door" in msg_lower or "gate" in msg_lower:
                act = "tutup" if "tutup" in msg_lower or "close" in msg_lower else "buka"
                pintu = self.bot.findBlock({
                    "matching": lambda b: b is not None and ("door" in str(b.name) or "gate" in str(b.name)),
                    "maxDistance": 4
                })
                if pintu:
                    try:
                        self.bot.activateBlock(pintu)
                        self.bot.chat(f"Nn. Pintu sudah di-{act}.")
                    except Exception:
                        self.bot.chat("Nn. Tidak dapat menjangkau pintu.")
                else:
                    self.bot.chat("Nn. Tidak ada pintu di dekatku.")
                return

        # End event
        @On(self.bot, "end")
        def end(this, reason=None, *args):
            self.log(chalk.red(f"Disconnected: {reason}"))
            self.stop_follow()
            send_ipc("disconnected", {"reason": str(reason)})

            # Turn off old events
            off(self.bot, "login", login)
            off(self.bot, "spawn", spawn)
            off(self.bot, "kicked", kicked)
            off(self.bot, "messagestr", messagestr)

            # Reconnect
            if self.reconnect:
                self.log(chalk.cyanBright("Attempting to reconnect in 5s..."))
                time.sleep(5)
                self.start_bot()

            off(self.bot, "end", end)


def start_ipc_listener(bot_instance):
    """Mendengarkan stdin dari Controller Node.js untuk command WhatsApp"""
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            cmd_data = json.loads(line)
            cmd = cmd_data.get("cmd")

            if cmd == "chat":
                msg = cmd_data.get("msg", "")
                if bot_instance.bot:
                    bot_instance.bot.chat(msg)
            elif cmd == "status":
                if bot_instance.bot and bot_instance.bot.entity and bot_instance.bot.entity.position:
                    pos = bot_instance.bot.entity.position
                    send_ipc("status_response", {
                        "online": True,
                        "health": bot_instance.bot.health,
                        "food": bot_instance.bot.food,
                        "x": pos.x if hasattr(pos, 'x') else pos['x'],
                        "y": pos.y if hasattr(pos, 'y') else pos['y'],
                        "z": pos.z if hasattr(pos, 'z') else pos['z']
                    })
            elif cmd == "stop":
                bot_instance.reconnect = False
                if bot_instance.bot:
                    bot_instance.bot.quit()
                break
        except Exception:
            pass


if __name__ == "__main__":
    bot_app = MCBot(CONFIG["username"])
    ipc_thread = threading.Thread(target=start_ipc_listener, args=(bot_app,), daemon=True)
    ipc_thread.start()
