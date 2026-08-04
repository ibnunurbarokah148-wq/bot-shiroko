import sys
import os
import time

# Pastikan path folder utils dapat diakses
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Optional load_dotenv
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

from utils.vec3_conversion import vec3_to_str
from javascript import require, On, Once, AsyncTask, once, off

# Import javascript libraries
mineflayer = require("mineflayer")
mineflayer_pathfinder = require("mineflayer-pathfinder")
vec3 = require("vec3")

# Global bot parameters
server_host = os.getenv("MC_HOST", "id-1.zknesia.app")
server_port = int(os.getenv("MC_PORT", "25675"))
bot_username = os.getenv("MC_USERNAME", "Ritian223")
mc_version = os.getenv("MC_VERSION", "1.21.1")
mc_auth = os.getenv("MC_AUTH", "offline")
auth_password = os.getenv("MC_AUTHME_PASSWORD", "citah12345")
mc_owners = [s.strip().lower() for s in os.getenv("MC_OWNERS", "rukaajah").split(",") if s.strip()]
reconnect = True


def is_owner(username):
    if not username:
        return False
    u = str(username).lower().strip().replace("*", "").replace(".", "").replace("_", "")
    return any(u == str(o).lower().strip().replace("*", "").replace(".", "").replace("_", "") or str(username).lower() == str(o).lower() for o in mc_owners)


class MCBot:

    def __init__(self, bot_name):
        self.bot_args = {
            "host": server_host,
            "port": server_port,
            "username": bot_name,
            "version": mc_version,
            "auth": mc_auth,
            "hideErrors": False,
        }
        self.reconnect = reconnect
        self.bot_name = bot_name
        self.start_bot()

    def log(self, message):
        print(f"[{self.bot_name}] {message}", flush=True)

    def pathfind_to_goal(self, goal_location):
        try:
            gx = getattr(goal_location, "x", None) if hasattr(goal_location, "x") else goal_location.get("x", 0)
            gy = getattr(goal_location, "y", None) if hasattr(goal_location, "y") else goal_location.get("y", 0)
            gz = getattr(goal_location, "z", None) if hasattr(goal_location, "z") else goal_location.get("z", 0)

            goal = mineflayer_pathfinder.pathfinder.goals.GoalNear(gx, gy, gz, 1)
            self.bot.pathfinder.setGoal(goal)
        except Exception as e:
            self.log(f"Error while trying to run pathfind_to_goal: {e}")

    def start_bot(self):
        self.log(chalk.yellow(f"Connecting to {server_host}:{server_port} (Version: {mc_version})..."))
        self.bot = mineflayer.createBot(self.bot_args)
        self.bot.loadPlugin(mineflayer_pathfinder.pathfinder)

        self.start_events()

    def start_events(self):

        # Login event: Triggers on bot login
        @On(self.bot, "login")
        def login(*args):
            self.bot_socket = getattr(self.bot, "_client", None)
            socket_obj = getattr(self.bot_socket, "socket", None) if self.bot_socket else None
            server_info = getattr(socket_obj, "server", None) or getattr(socket_obj, "_host", server_host) if socket_obj else server_host
            self.log(chalk.green(f"Logged in to {server_info}"))

        # Spawn event: Triggers on bot entity spawn
        @On(self.bot, "spawn")
        def spawn(*args):
            pos = getattr(self.bot.entity, "position", None)
            self.log(chalk.green(f"Spawned at {vec3_to_str(pos)}"))
            
            # AuthMe Auto-Login / Register
            if auth_password:
                self.log(chalk.cyan(f"Sending auto-login / auth commands..."))
                try:
                    self.bot.chat(f"/login {auth_password}")
                    self.bot.chat(f"/register {auth_password} {auth_password}")
                except Exception as e:
                    self.log(f"Error sending auth commands: {e}")

            self.bot.chat("Hi! Ready.")

        # Kicked event: Triggers on kick from server
        @On(self.bot, "kicked")
        def kicked(*args):
            reason = args[0] if len(args) > 0 else "Unknown reason"
            self.log(chalk.redBright(f"Kicked from server: {reason}"))

        # Chat & Message event
        @On(self.bot, "messagestr")
        def messagestr(*args):
            # JSPyBridge mengirim arguments event
            # Deteksi string pesan obrolan asli
            msg_clean = ""
            msg_pos = "chat"

            if len(args) == 1:
                msg_clean = str(args[0])
            elif len(args) >= 2:
                # Cek apakah args[1] adalah 'chat' / 'system' / 'game_info'
                if str(args[1]) in ["chat", "system", "game_info"]:
                    msg_clean = str(args[0])
                    msg_pos = str(args[1])
                else:
                    msg_clean = str(args[1])
                    msg_pos = str(args[2]) if len(args) >= 3 else "chat"

            if not msg_clean:
                return

            msg_lower = msg_clean.lower().strip()
            self.log(f"[{msg_pos.upper()}] {msg_clean}")

            # Auto AuthMe jika ada perintah login dari server
            if auth_password and any(k in msg_lower for k in ["/login", "/register", "login with", "register with", "gunakan /login"]):
                try:
                    self.bot.chat(f"/login {auth_password}")
                    self.bot.chat(f"/register {auth_password} {auth_password}")
                except Exception:
                    pass

            # 1. Quit command
            if "quit" in msg_lower:
                self.bot.chat("Goodbye!")
                self.reconnect = False
                try:
                    self.bot.quit()
                except Exception:
                    pass
                return

            # 2. Look at me / Lihat aku
            if "look at me" in msg_lower or "lihat aku" in msg_lower or "hadap sini" in msg_lower:
                target_entity = None
                
                # Cari target player dari self.bot.players
                try:
                    players = self.bot.players
                    if players:
                        for name in players:
                            p_name = str(name).lower()
                            if is_owner(p_name) or p_name in msg_lower:
                                p_data = players[name]
                                if p_data and getattr(p_data, "entity", None):
                                    target_entity = p_data.entity
                                    break
                except Exception as e:
                    self.log(f"Error reading players list: {e}")

                # Fallback: cari player terdekat
                if not target_entity:
                    try:
                        target_entity = self.bot.nearestEntity(lambda entity: entity.type == 'player' and entity.username != self.bot.username)
                    except Exception:
                        pass

                if target_entity and getattr(target_entity, "position", None):
                    tpos = target_entity.position
                    look_pos = vec3(tpos.x, tpos.y + 1.6, tpos.z)
                    self.log(chalk.magenta(f"Looking at player at {vec3_to_str(look_pos)}"))
                    try:
                        self.bot.lookAt(look_pos, True)
                        self.bot.chat("Looking at you!")
                    except Exception as e:
                        self.log(f"Error lookAt: {e}")
                else:
                    self.log("Player not found nearby.")
                    self.bot.chat("Sensei tidak terlihat di sekitar.")
                return

            # 3. Come to me / Kesini
            if "come to me" in msg_lower or "kesini" in msg_lower or "ke sini" in msg_lower:
                target_entity = None

                try:
                    players = self.bot.players
                    if players:
                        for name in players:
                            p_name = str(name).lower()
                            if is_owner(p_name) or p_name in msg_lower:
                                p_data = players[name]
                                if p_data and getattr(p_data, "entity", None):
                                    target_entity = p_data.entity
                                    break
                except Exception as e:
                    self.log(f"Error reading players list: {e}")

                if not target_entity:
                    try:
                        target_entity = self.bot.nearestEntity(lambda entity: entity.type == 'player' and entity.username != self.bot.username)
                    except Exception:
                        pass

                if target_entity and getattr(target_entity, "position", None):
                    tpos = target_entity.position
                    target_vec = vec3(tpos.x, tpos.y, tpos.z)
                    self.log(chalk.magenta(f"Pathfinding to player at {vec3_to_str(target_vec)}"))
                    self.bot.chat("Going to your position!")
                    self.pathfind_to_goal(target_vec)
                else:
                    self.log("Player not found nearby.")
                    self.bot.chat("Sensei tidak terlihat di sekitar.")
                return

        # End event: Triggers on disconnect from server
        @On(self.bot, "end")
        def end(*args):
            reason = args[0] if len(args) > 0 else "Disconnected"
            self.log(chalk.red(f"Disconnected: {reason}"))

            # Turn off old events
            try:
                off(self.bot, "login", login)
                off(self.bot, "spawn", spawn)
                off(self.bot, "kicked", kicked)
                off(self.bot, "messagestr", messagestr)
            except Exception:
                pass

            # Reconnect
            if self.reconnect:
                self.log(chalk.cyanBright("Attempting to reconnect in 5 seconds..."))
                time.sleep(5)
                self.start_bot()

            # Last event listener
            try:
                off(self.bot, "end", end)
            except Exception:
                pass


if __name__ == "__main__":
    bot = MCBot(bot_username)
