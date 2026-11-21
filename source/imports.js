const vscode = require("vscode");
const os = require("node:os");
const path = require("node:path");

const importDirective = /\b(use|include)\s*<([^<>\r\n]+)>/g;
const sourceTokens = /("(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*)|\b(?:use|include)\s*<[^<>\r\n]+>/g;

function maskNonCode(source) {
    return source.replace(sourceTokens, (token, nonCode) =>
        nonCode ? token.replace(/[^\r\n]/g, " ") : token);
}

function libraryDirectories(document) {
    const settings = vscode.workspace.getConfiguration("openscad", document.uri);
    const userLibrary = settings.get("userLibraryPath") || (process.platform === "linux"
        ? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "OpenSCAD", "libraries")
        : path.join(os.homedir(), "Documents", "OpenSCAD", "libraries"));
    let installationLibraries;
    const configured = settings.get("installationLibraryPath");
    const executable = settings.get("executablePath");
    if (configured) {
        installationLibraries = [configured];
    } else if (executable && path.isAbsolute(executable)) {
        const directory = path.dirname(executable);
        if (process.platform === "win32") {
            installationLibraries = [path.join(directory, "libraries"), path.join(directory, "../share/openscad/libraries")];
        } else if (process.platform === "darwin") {
            installationLibraries = [path.join(directory, "../Resources/libraries")];
        } else {
            installationLibraries = [
                path.join(directory, "../share/openscad/libraries"),
                path.join(directory, "../../share/openscad/libraries"),
                path.join(directory, "libraries")
            ];
        }
    } else if (process.platform === "win32") {
        installationLibraries = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
            .filter(Boolean).map(directory => path.join(directory, "OpenSCAD", "libraries"));
    } else if (process.platform === "darwin") {
        installationLibraries = ["/Applications/OpenSCAD.app/Contents/Resources/libraries"];
    } else {
        installationLibraries = ["/usr/local/share/openscad/libraries", "/usr/share/openscad/libraries"];
    }
    const environment = (process.env.OPENSCADPATH || "").split(path.delimiter).filter(Boolean);
    const extraPaths = settings.get("extraLibraryPaths");
    const extraLibraries = Array.isArray(extraPaths)
        ? extraPaths.filter(directory => typeof directory === "string" && path.isAbsolute(directory))
        : [];
    return [...environment, ...extraLibraries, userLibrary, ...installationLibraries];
}

function* importCandidates(document, filename, relativeOnly) {
    if (relativeOnly && /^(?:[\\/]|[A-Za-z]:)/.test(filename)) return;
    if (path.isAbsolute(filename)) {
        const base = document.uri.scheme === "file" ? path.dirname(document.uri.fsPath) : process.cwd();
        yield vscode.Uri.file(path.resolve(base, filename));
        return;
    }

    const relative = filename.replace(/\\/g, "/");
    yield vscode.Uri.joinPath(document.uri, "..", relative);
    if (relativeOnly) return;
    for (const directory of libraryDirectories(document)) {
        yield vscode.Uri.file(path.resolve(directory, relative));
    }
}

async function openImport(document, filename, opened = new Map(), relativeOnly = false) {
    for (const uri of importCandidates(document, filename, relativeOnly)) {
        const key = uri.toString();
        if (!opened.has(key)) {
            let target;
            try {
                target = await vscode.workspace.openTextDocument(uri);
            } catch {
                // Keep searching when a candidate cannot be opened.
            }
            opened.set(key, target);
        }
        const target = opened.get(key);
        if (target) return target;
    }
}

async function* importedDocuments(document, code, token, relativeOnly = false) {
    const seen = new Set([document.uri.toString()]);
    const opened = new Map();
    const imports = Array.from(code.matchAll(importDirective),
        directive => ({ owner: document, filename: directive[2], included: directive[1] === "include" }));
    const includedFiles = new Set();
    for (const { owner, filename, included } of imports) {
        if (token?.isCancellationRequested) return;
        const imported = await openImport(owner, filename, opened, relativeOnly);
        if (!imported) continue;
        const key = imported.uri.toString();
        if (key === document.uri.toString() || includedFiles.has(key) || (!included && seen.has(key))) continue;
        seen.add(key);
        if (included) includedFiles.add(key);
        const importedCode = maskNonCode(imported.getText());
        for (const directive of importedCode.matchAll(importDirective)) {
            if (directive[1] === "include") {
                imports.push({ owner: imported, filename: directive[2], included });
            }
        }
        yield { document: imported, code: importedCode, included };
    }
}

module.exports = { importDirective, sourceTokens, maskNonCode, importCandidates, openImport, importedDocuments };
