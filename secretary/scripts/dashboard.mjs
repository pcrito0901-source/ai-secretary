#!/usr/bin/env node
// Local browser dashboard. Binds to 127.0.0.1 only and rejects requests whose Host
// header is not this server, which blocks DNS-rebinding attacks from other websites.

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as lib from "./lib.mjs";

const ASSETS_DIR = fileURLToPath(new URL("../assets/", import.meta.url));
const ASSETS = {
  "/": ["dashboard.html", "text/html; charset=utf-8"],
  "/dashboard.css": ["dashboard.css", "text/css; charset=utf-8"],
  "/dashboard.js": ["dashboard.js", "text/javascript; charset=utf-8"],
};
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const MAX_BODY_BYTES = 16 * 1024;

function send(res, status, body, type) {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new lib.UserError("リクエストが大きすぎます。"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new lib.UserError("JSONを読み取れません。"));
      }
    });
    req.on("error", reject);
  });
}

// fs.watch reports paths relative to `home`, so hidden temp/lock files are filtered
// by their own names — never by the parent folder's name.
function watchHome(home, onChange) {
  let timer = null;
  const trigger = (name) => {
    if (name && /(^|[\\/])\.|\.tmp$/.test(String(name))) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, 250);
  };
  try {
    const watcher = fs.watch(home, { recursive: true }, (_event, name) => trigger(name));
    watcher.on("error", () => {});
    return { close: () => { clearTimeout(timer); watcher.close(); } };
  } catch {
    const signature = () => lib.listMarkdown(home).map((file) => `${file.path}:${file.mtime}`).join("|");
    let last = signature();
    const interval = setInterval(() => {
      const next = signature();
      if (next !== last) {
        last = next;
        onChange();
      }
    }, 2000);
    return { close: () => clearInterval(interval) };
  }
}

export function createDashboard(home) {
  lib.readConfig(home);
  const clients = new Set();
  let allowedHosts = new Set();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) return res.end();
      if (error instanceof lib.UserError) return sendJson(res, 400, { error: error.message });
      console.error(error);
      return sendJson(res, 500, { error: "サーバーでエラーが発生しました。" });
    });
  });

  server.on("listening", () => {
    const { port } = server.address();
    allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  });

  async function handle(req, res) {
    const host = req.headers.host ?? "";
    if (!allowedHosts.has(host)) return sendJson(res, 403, { error: "このアドレスからのアクセスは許可されていません。" });
    const url = new URL(req.url, `http://${host}`);

    if (req.method === "GET" && ASSETS[url.pathname]) {
      const [file, type] = ASSETS[url.pathname];
      return send(res, 200, fs.readFileSync(path.join(ASSETS_DIR, file)), type);
    }
    if (req.method === "GET" && url.pathname === "/api/state") return sendJson(res, 200, lib.dashboardState(home));
    if (req.method === "GET" && url.pathname === "/api/file") {
      const file = lib.readSafeMarkdown(home, url.searchParams.get("path"));
      return file ? sendJson(res, 200, file) : sendJson(res, 404, { error: "ファイルが見つかりません。" });
    }
    if (req.method === "GET" && url.pathname === "/api/search") return sendJson(res, 200, lib.searchNotes(home, url.searchParams.get("q")));
    if (req.method === "GET" && url.pathname === "/api/department") {
      const result = lib.departmentFiles(home, url.searchParams.get("id") ?? "");
      return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "部署が見つかりません。" });
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("retry: 3000\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return undefined;
    }
    if (req.method === "POST" && url.pathname === "/api/todo") {
      // A custom header plus JSON content type forces a CORS preflight, which this server never approves.
      const origin = req.headers.origin;
      if (req.headers["x-secretary"] !== "1" || (origin && origin !== `http://${host}`)) {
        return sendJson(res, 403, { error: "許可されていないリクエストです。" });
      }
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
        return sendJson(res, 415, { error: "JSONで送信してください。" });
      }
      const body = await readJsonBody(req);
      if (!Number.isInteger(body?.line) || typeof body.text !== "string" || typeof body.done !== "boolean" || typeof body.date !== "string") {
        return sendJson(res, 400, { error: "パラメータが不正です。" });
      }
      return sendJson(res, 200, lib.setTodoDone(home, { date: body.date, line: body.line, text: body.text, done: body.done }));
    }
    return sendJson(res, 404, { error: "見つかりません。" });
  }

  const watcher = watchHome(home, () => {
    for (const client of clients) client.write("event: update\ndata: {}\n\n");
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 25_000);
  server.on("close", () => {
    watcher.close();
    clearInterval(heartbeat);
  });
  server.closeClients = () => {
    for (const client of clients) client.end();
    clients.clear();
  };
  return server;
}

function listen(server, port, attempts = 10) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      if (error.code === "EADDRINUSE" && attempts > 1) resolve(listen(server, port + 1, attempts - 1));
      else reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address().port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Opening the browser is a convenience; the URL is printed anyway.
  }
}

async function main(argv) {
  const options = { port: 3940, open: true, home: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log("使い方: node dashboard.mjs [--port 3940] [--home <データフォルダ>] [--no-open]");
      return;
    }
    if (arg === "--no-open") options.open = false;
    else if (arg === "--port") options.port = Number(argv[++index]);
    else if (arg === "--home") options.home = argv[++index];
    else throw new lib.UserError(`不明なオプションです: ${arg}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new lib.UserError("--port には 1〜65535 の数字を指定してください。");

  const home = lib.resolveHome(options.home);
  const server = createDashboard(home);
  const port = await listen(server, options.port);
  const url = `http://127.0.0.1:${port}/`;
  console.log(`AI秘書ダッシュボード: ${url}`);
  console.log(`データフォルダ: ${home}`);
  console.log("終了するには Ctrl+C を押してください。");
  if (options.open) openBrowser(url);
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof lib.UserError ? error.message : error);
    process.exitCode = 1;
  });
}
