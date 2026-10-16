# som-blocks

Blocks editor for School of Makers classes: Blockly → Arduino C++ → compile server → Web Serial flash. ESP32-C3 SuperMini, Arduino UNO and NANO.

Start at `CLAUDE.md`. Code arrives through the PR plan in `_config/greploop-method.md`.

Local compile server (until `server/` ships its own image):
```
docker run -d --platform linux/amd64 --name duinoapp-server --restart unless-stopped -p 3030:3030 \
  -e SERVER_INFO_NAME="SoM Compile (local)" -e SERVER_INFO_OWNER="School of Makers" -e SERVER_INFO_COUNTRY=CL \
  duinoapp/duinoapp-server:latest
```
