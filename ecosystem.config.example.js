module.exports = {
  apps: [
    {
      name: "shiroko-api-tunnel",
      script: "C:\\Path\\To\\cloudflared.exe",
      args: [
        "tunnel",
        "run",
        "--token-file",
        "C:\\Path\\To\\cloudflared\\shiroko-api.token"
      ],
      interpreter: "none",
      autorestart: true,
      windowsHide: true
    }
  ]
};
