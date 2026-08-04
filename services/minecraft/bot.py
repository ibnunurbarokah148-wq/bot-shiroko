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
from dotenv import load_dotenv
from simple_chalk import chalk
from javascript import require, On, Once, AsyncTask, off

# Load environment variables
load_dotenv()

# Resolve project root
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../'))
HAWKEYE_PATH = os.path.join(ROOT_DIR, 'node_modules', 'minecrafthawkeye', 'dist', 'index.js').replace('\\', '/')

# Require Node.js modules via JSPyBridge
mineflayer = require('mineflayer')
mineflayer_pathfinder = require('mineflayer-pathfinder')
vec3 = require('vec3')
hawkeye_plugin = require(HAWKEYE_PATH)
minecraft_data = require('minecraft-data')

CONFIG = {
    "host": os.getenv("MC_HOST", "id-1.zknesia.app"),
    "port": int(os.getenv("MC_PORT", "25675")),
    "username": os.getenv("MC_USERNAME", "Ritian223"),
    "version": os.getenv("MC_VERSION", "1.21.1"),
    "auth": os.getenv("MC_AUTH", "offline"),
    "owners": [s.strip().lower() for s in os.getenv("MC_OWNERS", "rukaajah").split(",") if s.strip()]
}

CONFIG_RUMAH = {
    "petiX": int(os.getenv("MC_HOME_X", "82")),
    "petiY": int(os.getenv("MC_HOME_Y", "72")),
    "petiZ": int(os.getenv("MC_HOME_Z", "37")),
    "radiusAman": int(os.getenv("MC_HOME_RADIUS", "20"))
}

HOSTILE_MOBS = [
    'zombie', 'zombie_villager', 'skeleton', 'creeper', 'spider', 'cave_spider',
    'enderman', 'witch', 'slime', 'phantom', 'drowned', 'husk', 'stray',
    'pillager', 'vindicator', 'evoker'
]

DAFTAR_MAKANAN = [
    'apple', 'bread', 'cooked_beef', 'cooked_chicken',
    'cooked_porkchop', 'cooked_mutton', 'cooked_rabbit',
    'cooked_salmon', 'carrot', 'baked_potato', 'golden_apple'
]

KAMUS_BLOK = {
    "tanah": "dirt",
    "batu": "stone",
    "cobblestone": "cobblestone",
    "kayu": "oak_log",
    "pasir": "sand",
    "arang": "coal_ore",
    "besi": "iron_ore",
    "emas": "gold_ore",
    "berlian": "diamond_ore"
}

def is_owner(username):
    if not username:
        return False
    clean_user = username.lower().lstrip(".*_").strip()
    for o in CONFIG["owners"]:
        if clean_user == o or username.lower() == o:
            return True
    return False

def send_ipc(msg_type, data):
    """Kirim event terstruktur ke Node.js (index.js) via stdout JSON line."""
    payload = json.dumps({"ipc_type": msg_type, "data": data})
    print(f"__IPC_MESSAGE_START__{payload}__IPC_MESSAGE_END__", flush=True)

class ShirokoPythonBot:
    def __init__(self):
        self.bot = None
        self.reconnect = True
        self.mode_mandiri = False
        self.fokus_mandiri = None
        self.sedang_kerja = False
        self.sedang_makan = False
        self.target_serangan = None
        self.loop_serangan = None
        self.loop_ikut = None
        self.loop_mandiri = None
        self.loop_radar = None
        self.loop_unstuck = None
        self.default_movements = None
        self.mc_data = None
        self.waktu_spawn = None

    def log(self, message, color="cyan"):
        fn = getattr(chalk, color, chalk.cyan)
        print(fn(f"[{CONFIG['username']} Py] {message}"), flush=True)

    def start(self):
        self.log(f"Menghubungkan ke {CONFIG['host']}:{CONFIG['port']} (Versi {CONFIG['version']})...", "yellow")
        self.bot = mineflayer.createBot({
            "host": CONFIG["host"],
            "port": CONFIG["port"],
            "username": CONFIG["username"],
            "version": CONFIG["version"],
            "auth": CONFIG["auth"],
            "hideErrors": False
        })
        self.bot.loadPlugin(mineflayer_pathfinder.pathfinder)
        try:
            self.bot.loadPlugin(hawkeye_plugin['default'] or hawkeye_plugin)
        except Exception as e:
            self.log(f"Warning: HawkEye plugin load skipped: {e}", "yellow")
        self.register_events()

    def run_and_jump(self):
        """Manuver lompat rintangan bertenaga (preset 12-jumper-bot.py)."""
        try:
            @AsyncTask(start=True)
            def async_jump(task):
                self.bot.setControlState("forward", True)
                self.bot.waitForTicks(1)
                self.bot.setControlState("sprint", True)
                self.bot.setControlState("jump", True)
                self.bot.waitForTicks(10)
                self.bot.setControlState("jump", False)
                self.bot.setControlState("sprint", False)
        except Exception as e:
            self.log(f"Error run_and_jump: {e}", "red")

    def register_events(self):
        @On(self.bot, "login")
        def on_login(this, *args):
            self.log(f"Login sukses ke server!", "green")
            send_ipc("login", {"status": "success", "username": CONFIG["username"]})

        @On(self.bot, "spawn")
        def on_spawn(this, *args):
            self.waktu_spawn = time.time()
            self.mc_data = minecraft_data(self.bot.version or "1.21.1")
            
            Movements = mineflayer_pathfinder.Movements
            movements = Movements(self.bot, self.mc_data)
            movements.canDig = False
            movements.canOpenDoors = True
            movements.allowParkour = True
            movements.allowSprinting = True
            movements.allow1by1towers = False
            movements.allowEntityDetection = True
            movements.allowFreeMotion = False
            movements.maxDropDown = 4
            movements.jumpCost = 1.0
            movements.scafoldingBlocks = []

            self.bot.pathfinder.setMovements(movements)
            self.default_movements = movements

            pos = self.bot.entity.position
            self.log(f"Spawn di posisi: x={pos.x:.1f}, y={pos.y:.1f}, z={pos.z:.1f}", "green")
            send_ipc("spawn", {"x": pos.x, "y": pos.y, "z": pos.z})

            self.start_radar()
            self.start_unstuck_checker()

        @On(self.bot, "death")
        def on_death(this, *args):
            self.log("Bot mati! Respawning...", "red")
            self.stop_all_loops()
            send_ipc("death", {})

        @On(self.bot, "kicked")
        def on_kicked(this, reason=None, loggedIn=None, *args):
            self.log(f"Kicked dari server: {reason}", "redBright")
            send_ipc("kicked", {"reason": str(reason)})

        @On(self.bot, "end")
        def on_end(this, reason=None, *args):
            self.log(f"Koneksi terputus: {reason}", "red")
            self.stop_all_loops()
            send_ipc("disconnected", {"reason": str(reason)})
            if self.reconnect:
                self.log("Mencoba menghubungkan ulang dalam 5 detik...", "cyanBright")
                time.sleep(5)
                self.start()

        @On(self.bot, "health")
        def on_health(this, *args):
            if not self.bot or not self.bot.entity:
                return
            health = self.bot.health
            food = self.bot.food
            if food < 14 and not self.sedang_makan:
                self.auto_eat()

        @On(self.bot, "chat")
        def on_chat(this, username=None, message=None, *args):
            self.handle_chat(username, message)

        @On(self.bot, "messagestr")
        def on_messagestr(this, message=None, messagePosition=None, jsonMsg=None, sender=None, verified=None, *args):
            if not message or not isinstance(message, str):
                return
            for owner_name in CONFIG["owners"]:
                if owner_name in message.lower():
                    parts = message.split(":")
                    if len(parts) >= 2:
                        user_candidate = parts[0].strip().split()[-1]
                        msg_body = ":".join(parts[1:]).strip()
                        if is_owner(user_candidate):
                            self.handle_chat(user_candidate, msg_body)

    def handle_chat(self, username, message):
        if not message or not username:
            return
        clean_msg = message.strip()
        self.log(f"Chat [{username}]: {clean_msg}", "magenta")
        send_ipc("chat", {"username": username, "message": clean_msg})

        if not is_owner(username):
            return

        pk = clean_msg.lower()
        goals = mineflayer_pathfinder.goals

        # 1. IKUT
        if "ikut" in pk:
            self.mode_mandiri = False
            self.sedang_kerja = False
            self.stop_follow()
            player = self.find_player(username)
            if player and player.entity:
                self.bot.chat("Nn. Mengikutimu dari dekat, Sensei.")
                self.start_follow(player)
            else:
                self.bot.chat("Nn. Terlalu jauh. Menunggumu mendekat, Sensei.")
            return

        # 2. BERHENTI / DIAM / TUNGGU
        if any(k in pk for k in ["berhenti", "tunggu", "diam"]):
            self.mode_mandiri = False
            self.sedang_kerja = False
            self.stop_follow()
            self.berhenti_serang()
            self.bot.pathfinder.setGoal(None)
            self.bot.clearControlStates()
            self.bot.chat("Nn. Aku berhenti dan standby di sini.")
            return

        # 3. LOMPAT (Run and jump)
        if "lompat" in pk or "jump" in pk:
            self.bot.chat("Nn. Melompat.")
            self.run_and_jump()
            return

        # 4. KESINI / MASUK
        if any(k in pk for k in ["masuk", "ke sini", "kesini"]):
            self.stop_follow()
            player = self.find_player(username)
            if player and player.entity:
                self.bot.chat("Nn. Menuju posisimu, Sensei.")
                p = player.entity.position
                self.bot.pathfinder.setGoal(goals.GoalNear(p.x, p.y, p.z, 1.5))
            else:
                self.bot.chat("Nn. Posisi Sensei belum terlihat di radar.")
            return

        # 5. TEROBOS / MAJU
        if any(k in pk for k in ["terobos", "maju", "sini"]):
            player = self.find_player(username)
            if player and player.entity:
                self.bot.lookAt(player.entity.position.offset(0, 1.6, 0), True)
            self.bot.chat("Nn. Menerobos maju.")
            self.bot.setControlState("forward", True)
            time.sleep(1.2)
            self.bot.setControlState("forward", False)
            return

        # 6. TUTUP / BUKA PINTU
        if "tutup pintu" in pk or "buka pintu" in pk:
            action_name = "tutup" if "tutup" in pk else "buka"
            pintu = self.bot.findBlock({
                "matching": lambda b: b is not None and ("door" in b.name or "gate" in b.name),
                "maxDistance": 4
            })
            if pintu:
                try:
                    self.bot.activateBlock(pintu)
                    self.bot.chat(f"Nn. Pintu sudah di-{action_name}.")
                except Exception:
                    self.bot.chat("Nn. Tidak dapat menjangkau pintu.")
            else:
                self.bot.chat("Nn. Tidak ada pintu di dekatku.")
            return

        # 7. STATUS
        if "status" in pk or "posisi" in pk:
            pos = self.bot.entity.position
            self.bot.chat(f"Nn. Posisi: {pos.x:.0f}, {pos.y:.0f}, {pos.z:.0f} | Darah: {self.bot.health}/20 | Makanan: {self.bot.food}/20")
            return

        # 8. MANDIRI
        if "mandiri" in pk or "kerja" in pk:
            self.mode_mandiri = True
            self.fokus_mandiri = "kayu" if "kayu" in pk else "bebas"
            self.bot.chat(f"Nn. Mode mandiri aktif (Fokus: {self.fokus_mandiri}).")
            return

    def find_player(self, username):
        if not self.bot or not self.bot.players:
            return None
        players = self.bot.players
        for name in players:
            if is_owner(name) or username.lower() in name.lower():
                return players[name]
        return None

    def start_follow(self, player_target):
        self.stop_follow()
        goals = mineflayer_pathfinder.goals

        def follow_worker():
            while self.loop_ikut and self.bot and self.bot.entity:
                if player_target and player_target.entity:
                    dist = self.bot.entity.position.distanceTo(player_target.entity.position)
                    if dist > 3.2:
                        p = player_target.entity.position
                        try:
                            self.bot.pathfinder.setGoal(goals.GoalNear(p.x, p.y, p.z, 2.0))
                        except Exception:
                            pass
                    elif dist <= 2.2:
                        if self.bot.pathfinder.isMoving():
                            self.bot.pathfinder.setGoal(None)
                        try:
                            self.bot.lookAt(player_target.entity.position.offset(0, 1.6, 0), True)
                        except Exception:
                            pass
                time.sleep(0.6)

        self.loop_ikut = True
        t = threading.Thread(target=follow_worker, daemon=True)
        t.start()

    def stop_follow(self):
        self.loop_ikut = False

    def start_radar(self):
        def radar_worker():
            while self.bot:
                try:
                    if self.bot.entity and not self.target_serangan:
                        nearest_mob = self.bot.nearestEntity(
                            lambda e: e.name and e.name.lower() in HOSTILE_MOBS and e.position.distanceTo(self.bot.entity.position) < 8
                        )
                        if nearest_mob:
                            self.mulai_serang(nearest_mob)
                except Exception:
                    pass
                time.sleep(1.0)

        t = threading.Thread(target=radar_worker, daemon=True)
        t.start()

    def start_unstuck_checker(self):
        def unstuck_worker():
            last_pos = None
            stuck_count = 0
            while self.bot:
                try:
                    if self.bot.entity and self.bot.pathfinder and self.bot.pathfinder.isMoving() and self.bot.pathfinder.goal:
                        current_pos = self.bot.entity.position
                        if last_pos and current_pos.distanceTo(last_pos) < 0.15:
                            stuck_count += 1
                            if stuck_count >= 4:
                                self.log(f"Anti-stuck: terhalang di {current_pos}, micro-recovery...", "yellow")
                                self.run_and_jump()
                                stuck_count = 0
                        else:
                            stuck_count = 0
                            last_pos = current_pos.clone()
                    else:
                        stuck_count = 0
                        last_pos = None
                except Exception:
                    pass
                time.sleep(1.0)

        t = threading.Thread(target=unstuck_worker, daemon=True)
        t.start()

    def mulai_serang(self, target):
        self.target_serangan = target
        self.pasang_senjata_terbaik()
        goals = mineflayer_pathfinder.goals

        def combat_worker():
            while self.target_serangan and self.bot and self.bot.entity:
                try:
                    if not self.target_serangan.isValid or (self.target_serangan.health and self.target_serangan.health <= 0):
                        self.bot.chat("Nn. Ancaman berhasil dieliminasi.")
                        self.berhenti_serang()
                        break

                    jarak = self.bot.entity.position.distanceTo(self.target_serangan.position)
                    self.bot.pathfinder.setGoal(goals.GoalFollow(self.target_serangan, 2.0), True)

                    if jarak < 3.5:
                        self.bot.lookAt(self.target_serangan.position.offset(0, self.target_serangan.height or 1, 0), True)
                        self.bot.attack(self.target_serangan)

                except Exception as e:
                    self.log(f"Combat error: {e}", "red")
                    break
                time.sleep(0.5)

        t = threading.Thread(target=combat_worker, daemon=True)
        t.start()

    def berhenti_serang(self):
        self.target_serangan = None
        if self.bot and self.bot.hawkEye:
            try:
                self.bot.hawkEye.stop()
            except Exception:
                pass

    def pasang_senjata_terbaik(self):
        urutan = ['netherite_sword', 'diamond_sword', 'iron_sword', 'golden_sword', 'stone_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe']
        items = self.bot.inventory.items()
        for pedang in urutan:
            found = next((i for i in items if pedang in i.name), None)
            if found:
                try:
                    self.bot.equip(found, 'hand')
                    break
                except Exception:
                    pass
        # Shield offhand
        shield = next((i for i in items if 'shield' in i.name), None)
        if shield:
            try:
                self.bot.equip(shield, 'off-hand')
            except Exception:
                pass

    def auto_eat(self):
        self.sedang_makan = True
        items = self.bot.inventory.items()
        makanan = next((i for i in items if any(f in i.name for f in DAFTAR_MAKANAN)), None)
        if makanan:
            try:
                self.bot.equip(makanan, 'hand')
                self.bot.consume()
            except Exception:
                pass
        self.sedang_makan = False

    def stop_all_loops(self):
        self.stop_follow()
        self.berhenti_serang()
        self.mode_mandiri = False
        self.sedang_kerja = False

def listen_node_ipc(bot_instance):
    """Mendengar perintah dari Node.js via stdin JSON."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            cmd = req.get("cmd")
            if cmd == "chat":
                msg = req.get("msg", "")
                if bot_instance.bot and msg:
                    bot_instance.bot.chat(msg)
            elif cmd == "stop":
                bot_instance.reconnect = False
                if bot_instance.bot:
                    bot_instance.bot.quit()
                sys.exit(0)
            elif cmd == "status":
                if bot_instance.bot and bot_instance.bot.entity:
                    pos = bot_instance.bot.entity.position
                    send_ipc("status_response", {
                        "online": True,
                        "x": pos.x,
                        "y": pos.y,
                        "z": pos.z,
                        "health": bot_instance.bot.health,
                        "food": bot_instance.bot.food
                    })
                else:
                    send_ipc("status_response", {"online": False})
        except Exception as e:
            bot_instance.log(f"IPC Parse error: {e}", "red")

if __name__ == "__main__":
    bot_app = ShirokoPythonBot()
    ipc_thread = threading.Thread(target=listen_node_ipc, args=(bot_app,), daemon=True)
    ipc_thread.start()
    bot_app.start()
