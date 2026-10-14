/**
 * Terminal de demonstração — shell embutido no painel, para gravação.
 *
 * DESLIGADO por padrão: só sobe com DEMO_TERMINAL=1.
 *
 * Isto expõe um shell REAL da máquina que roda o hub. As defesas são:
 *   1. flag de ambiente explícita (default off);
 *   2. sessão de admin válida, exigida na primeira mensagem do socket
 *      (não vai token na querystring, que vaza em log de proxy);
 *   3. checagem de mesma origem — WebSocket não respeita CORS, então sem
 *      isso qualquer página aberta no navegador poderia abrir um shell;
 *   4. teto de sessões simultâneas.
 *
 * Nunca deixe DEMO_TERMINAL=1 numa instalação alcançável pela internet.
 */

import type { Server, IncomingMessage } from "http";
import type { Duplex } from "stream";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { isValidSession } from "./security";

const ENABLED = process.env.DEMO_TERMINAL === "1";
const CWD = process.env.DEMO_TERMINAL_CWD || path.join(__dirname, "..");
const WS_PATH = "/ws/terminal";
const MAX_SESSIONS = 2;
const AUTH_TIMEOUT_MS = 5000;
const SCROLLBACK_COLS = 120;
const SCROLLBACK_ROWS = 30;

let live = 0;

export function isTerminalEnabled(): boolean {
  return ENABLED;
}

/** Só aceita upgrade vindo da própria origem do hub. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // cliente não-browser (curl/wscat) — não é alvo de CSWSH
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function pickShell(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    return { file: process.env.COMSPEC ? "powershell.exe" : "cmd.exe", args: [] };
  }
  return { file: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

export function attachTerminal(server: Server, adminAuthEnabled: boolean): void {
  if (!ENABLED) return;

  let pty: any;
  try {
    // require, não import: node-pty é devDependency e pode não existir em produção
    pty = require("node-pty");
  } catch {
    console.warn("  demo terminal: node-pty ausente — painel desligado (npm i -D node-pty)");
    return;
  }

  if (!adminAuthEnabled) {
    console.warn("  demo terminal: RECUSADO — exige ADMIN_PASSWORD definido (open mode abriria shell sem senha)");
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    let pathname = "";
    try {
      pathname = new URL(req.url || "", `http://${req.headers.host}`).pathname;
    } catch {
      return;
    }
    if (pathname !== WS_PATH) return; // outro upgrade — não é nosso

    if (!sameOrigin(req)) {
      socket.destroy();
      return;
    }
    if (live >= MAX_SESSIONS) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    let shell: any = null;
    let authed = false;

    const authTimer = setTimeout(() => {
      if (!authed) ws.close(4001, "AUTH_TIMEOUT");
    }, AUTH_TIMEOUT_MS);

    const closeShell = () => {
      if (shell) {
        try {
          shell.kill();
        } catch {
          /* já morreu */
        }
        shell = null;
        live = Math.max(0, live - 1);
      }
    };

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (!authed) {
        if (msg.type !== "auth" || !isValidSession(String(msg.token || ""))) {
          ws.close(4003, "UNAUTHORIZED");
          return;
        }
        authed = true;
        clearTimeout(authTimer);
        live++;

        const { file, args } = pickShell();
        shell = pty.spawn(file, args, {
          name: "xterm-color",
          cols: Number(msg.cols) || SCROLLBACK_COLS,
          rows: Number(msg.rows) || SCROLLBACK_ROWS,
          cwd: CWD,
          env: process.env,
        });
        shell.onData((d: string) => {
          if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "out", data: d }));
        });
        shell.onExit(() => {
          if (ws.readyState === ws.OPEN) ws.close(1000, "SHELL_EXIT");
          closeShell();
        });
        ws.send(JSON.stringify({ type: "ready", cwd: CWD, shell: file }));
        return;
      }

      if (!shell) return;
      if (msg.type === "in" && typeof msg.data === "string") shell.write(msg.data);
      else if (msg.type === "resize") shell.resize(Number(msg.cols) || SCROLLBACK_COLS, Number(msg.rows) || SCROLLBACK_ROWS);
    });

    ws.on("close", () => {
      clearTimeout(authTimer);
      closeShell();
    });
    ws.on("error", () => {
      clearTimeout(authTimer);
      closeShell();
    });
  });

  console.log(`  demo terminal: ON  ${WS_PATH}  (cwd ${CWD})`);
}
