const { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const python = process.env.CAREER_PYTHON || (process.platform === "win32" ? "python" : "python3");
let service;
let origin;
let window;

function startDashboard() {
  return new Promise((resolve, reject) => {
    service = spawn(python, ["scripts/dashboard.py", "--port", "0"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let errors = "";
    const timer = setTimeout(() => reject(new Error("The dashboard did not start.")), 10000);
    service.stderr.on("data", chunk => { errors = (errors + chunk).slice(-2000); });
    service.stdout.on("data", chunk => {
      output += chunk;
      if (!output.includes("\n")) return;
      clearTimeout(timer);
      const address = output.trim();
      if (/^http:\/\/127\.0\.0\.1:\d+$/.test(address)) resolve(address);
      else reject(new Error("Unexpected dashboard startup output."));
    });
    service.once("error", error => { clearTimeout(timer); reject(error); });
    service.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(errors.trim() || "Run python3 scripts/setup.py before launching."));
      if (window && !window.isDestroyed()) window.close();
    });
  });
}

function safeResume(event, relative) {
  if (event.sender !== window?.webContents || event.senderFrame?.url !== origin + "/"
      || typeof relative !== "string" || path.isAbsolute(relative)) throw new Error("Invalid resume path.");
  const workspace = fs.realpathSync(path.join(root, "workspace"));
  const candidate = fs.realpathSync(path.resolve(workspace, relative));
  const remainder = path.relative(workspace, candidate);
  if (remainder.startsWith(".." + path.sep) || path.isAbsolute(remainder) ||
      !/\.(pdf|docx)$/i.test(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error("Choose a PDF or DOCX inside the workspace.");
  }
  return candidate;
}

function openWindow() {
  window = new BrowserWindow({
    title: "Career Search Dashboard", width: 1220, height: 860,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true,
      contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (["https:", "http:"].includes(target.protocol) && !target.username && !target.password) {
      shell.openExternal(target.href).catch(console.error);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (target !== origin + "/") event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.loadURL(origin);
}

ipcMain.handle("resume:reveal", (event, relative) => {
  try {
    shell.showItemInFolder(safeResume(event, relative));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.on("resume:drag", (event, relative) => {
  try {
    const file = safeResume(event, relative);
    const pixels = Buffer.alloc(24 * 24 * 4, 255);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 90;
      pixels[i + 1] = 116;
      pixels[i + 2] = 62;
    }
    event.sender.startDrag({ file, icon: nativeImage.createFromBitmap(pixels, { width: 24, height: 24 }) });
  } catch (error) {
    dialog.showErrorBox("Cannot drag resume", error.message);
  }
});

app.whenReady().then(async () => {
  try {
    origin = await startDashboard();
    openWindow();
  } catch (error) {
    dialog.showErrorBox("Cannot open dashboard", error.message);
    app.quit();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => service?.kill());
