const vscode = require("vscode");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const windows = process.platform === "win32";
const previews = new Map();
let pending = false;

function executableFor(settings) {
    const configured = settings.get("executablePath");
    if (configured) return configured;
    if (!windows) return "openscad";

    const roots = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
    const folders = settings.get("targetVersion") === "nightly"
        ? ["OpenSCAD (Nightly)", "OpenSCAD"] : ["OpenSCAD", "OpenSCAD (Nightly)"];
    return folders.flatMap(folder => roots.map(root => path.join(root, folder, "openscad.exe")))
        .find(candidate => fs.existsSync(candidate)) || "openscad.exe";
}

function launch(executable, filename, args = [filename]) {
    return new Promise((resolve, reject) => {
        const child = spawn(executable, args, { cwd: path.dirname(filename), detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => {
            child.unref();
            resolve(child);
        });
    });
}

async function previewWindow(executable, file, previous, launchedId) {
    const script = path.join(__dirname, "preview-windows.ps1");
    const request = {
        file, processName: path.basename(executable, path.extname(executable)),
        handle: previous?.handle, processId: previous?.processId,
        launchedId, wait: launchedId ? 9000 : 0
    };
    let response;
    try {
        const powershell = path.join(process.env.SystemRoot || "C:\\Windows",
            "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        const command = "& ([ScriptBlock]::Create([IO.File]::ReadAllText($env:OPENSCAD_PREVIEW_SCRIPT)))";
        const { stdout } = await run(powershell, ["-NoProfile", "-NonInteractive", "-STA", "-Command", command], {
            env: { ...process.env, OPENSCAD_PREVIEW_SCRIPT: script, OPENSCAD_PREVIEW_REQUEST: JSON.stringify(request) },
            windowsHide: true, timeout: 22000
        });
        response = JSON.parse(stdout.trim());
    } catch (error) {
        throw new Error(error.killed ? "Timed out waiting for OpenSCAD." : "Could not run the Windows preview helper.");
    }
    if (response.status === "error") throw new Error(response.message);
    return response;
}

async function previewOpenSCAD() {
    const editor = vscode.window.activeTextEditor;
    if (pending || editor?.document.languageId !== "openscad") return;
    pending = true;
    try {
        let { document } = editor;
        if (document.isUntitled) {
            await vscode.commands.executeCommand("workbench.action.files.save");
            document = vscode.window.activeTextEditor?.document;
        }
        if (!document || document.languageId !== "openscad" || document.isUntitled) return;
        if (document.uri.scheme !== "file") {
            vscode.window.showWarningMessage("OpenSCAD preview requires a local file.");
            return;
        }
        if (document.isDirty && !await document.save()) {
            vscode.window.showWarningMessage("Save the OpenSCAD file before previewing it.");
            return;
        }

        const filename = document.uri.fsPath;
        const settings = vscode.workspace.getConfiguration("openscad", document.uri);
        const executable = executableFor(settings);
        const key = document.uri.toString();
        if (windows) {
            let result = await previewWindow(executable, filename, previews.get(key));
            if (result.status === "missing") {
                const child = await launch(executable, filename);
                result = await previewWindow(executable, filename, undefined, child.pid);
            }
            if (result.status !== "previewed") throw new Error("OpenSCAD opened without a preview window.");
            previews.set(key, { handle: result.handle, processId: result.processId });
        } else if (!settings.get("executablePath") && process.platform === "darwin") {
            await run("/usr/bin/open", ["-a", "OpenSCAD", filename]);
        } else if (!previews.has(key)) {
            const child = await launch(executable, filename);
            previews.set(key, child);
            child.once("exit", () => previews.delete(key));
        }
    } catch (error) {
        const message = error.code === "ENOENT"
            ? "Set OpenSCAD: Executable Path to your OpenSCAD executable."
            : error.message;
        vscode.window.showErrorMessage("OpenSCAD preview failed. " + message);
    } finally {
        pending = false;
    }
}

module.exports = { previewOpenSCAD };
