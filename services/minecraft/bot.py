import sys
import os
import time

# Pastikan path folder utils dapat diakses
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Optional load_dotenv jika ada
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

# Import the javascript libraries
mineflayer = require("mineflayer")
mineflayer_pathfinder = require("mineflayer-pathfinder")
vec3 = require("vec3")

# Global bot parameters
server_host = os.getenv("MC_HOST", "id-1.zknesia.app")
server_port = int(os.getenv("MC_PORT", "25675"))
bot_username = os.getenv("MC_USERNAME", "Ritian223")
mc_version = os.getenv("MC_VERSION", "1.21.1")
mc_auth = os.getenv("MC_AUTH", "offline")
mc_owners = [s.strip().lower() for s in os.getenv("MC_OWNERS", "rukaajah").split(",") if s.strip()]
reconnect = True


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

    # Tags bot username before console messages
    def log(self, message):
        print(f"[{self.bot_name}] {message}", flush=True)

    # Mineflayer: Pathfind to goal (Pure GoalNear)
    def pathfind_to_goal(self, goal_location):
        try:
            self.bot.pathfinder.setGoal(
                mineflayer_pathfinder.pathfinder.goals.GoalNear(
                    goal_location["x"], goal_location["y"], goal_location["z"], 1
                )
            )
        except Exception as e:
            self.log(f"Error while trying to run pathfind_to_goal: {e}")

    # Start mineflayer bot
    def start_bot(self):
        self.log(chalk.yellow(f"Connecting to {server_host}:{server_port} (Version: {mc_version})..."))
        self.bot = mineflayer.createBot(self.bot_args)
        self.bot.loadPlugin(mineflayer_pathfinder.pathfinder)

        self.start_events()

    # Attach mineflayer events to bot
    def start_events(self):

        # Login event: Triggers on bot login
        @On(self.bot, "login")
        def login(this=None, *args):
            self.bot_socket = getattr(self.bot, "_client", None)
            socket_obj = getattr(self.bot_socket, "socket", None) if self.bot_socket else None
            server_info = getattr(socket_obj, "server", None) or getattr(socket_obj, "_host", server_host) if socket_obj else server_host
            self.log(chalk.green(f"Logged in to {server_info}"))

        # Spawn event: Triggers on bot entity spawn
        @On(self.bot, "spawn")
        def spawn(this=None, *args):
            pos = getattr(self.bot.entity, "position", None)
            self.log(chalk.green(f"Spawned at {vec3_to_str(pos)}"))
            self.bot.chat("Hi! Ready.")

        # Kicked event: Triggers on kick from server
        @On(self.bot, "kicked")
        def kicked(this=None, reason=None, loggedIn=None, *args):
            self.log(chalk.redBright(f"Kicked from server: {reason}"))

        # Chat event: Triggers on chat message
        @On(self.bot, "messagestr")
        def messagestr(this=None, message=None, messagePosition=None, jsonMsg=None, sender=None, verified=None, *args):
            if not message or not isinstance(message, str):
                return

            msg_clean = message.strip()
            msg_lower = msg_clean.lower()
            self.log(f"Chat: {msg_clean}")

            # 1. Quit command
            if "quit" in msg_lower:
                self.bot.chat("Goodbye!")
                self.reconnect = False
                this.quit()
                return

            # 2. Come to me / Kesini command
            if "come to me" in msg_lower or "kesini" in msg_lower or "ke sini" in msg_lower:
                local_players = self.bot.players
                player_location = None

                if local_players:
                    for el in local_players:
                        player_data = local_players[el]
                        if not player_data:
                            continue
                        
                        p_uuid = str(player_data.get("uuid", ""))
                        p_username = str(player_data.get("username", "")).lower()

                        # Cocokkan via UUID pengirim, username di chat, atau daftar owner
                        if (sender and p_uuid == str(sender)) or (p_username and p_username in msg_lower) or (p_username in mc_owners):
                            if player_data.get("entity") and player_data["entity"].get("position"):
                                vec3_temp = player_data["entity"]["position"]
                                player_location = vec3(
                                    vec3_temp["x"], vec3_temp["y"], vec3_temp["z"]
                                )
                                break

                # Feedback & Navigasi
                if player_location:
                    self.log(chalk.magenta(f"Pathfinding to player at {vec3_to_str(player_location)}"))
                    self.bot.chat("Going to your position!")
                    self.pathfind_to_goal(player_location)
                else:
                    self.log("Player not found nearby.")
                    self.bot.chat("Player not found nearby.")
                return

            # 3. Look at me / Lihat aku command
            if "look at me" in msg_lower or "lihat aku" in msg_lower:
                local_players = self.bot.players
                player_location = None

                if local_players:
                    for el in local_players:
                        player_data = local_players[el]
                        if not player_data:
                            continue

                        p_uuid = str(player_data.get("uuid", ""))
                        p_username = str(player_data.get("username", "")).lower()

                        if (sender and p_uuid == str(sender)) or (p_username and p_username in msg_lower) or (p_username in mc_owners):
                            if player_data.get("entity") and player_data["entity"].get("position"):
                                vec3_temp = player_data["entity"]["position"]
                                player_location = vec3(
                                    vec3_temp["x"], vec3_temp["y"] + 1.6, vec3_temp["z"]
                                )
                                break

                if player_location:
                    self.log(chalk.magenta(f"Looking at player at {vec3_to_str(player_location)}"))
                    try:
                        self.bot.lookAt(player_location)
                        self.bot.chat("Looking at you!")
                    except Exception as e:
                        self.log(f"Error lookAt: {e}")
                else:
                    self.log("Player not found.")
                return

        # End event: Triggers on disconnect from server
        @On(self.bot, "end")
        def end(this=None, reason=None, *args):
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
