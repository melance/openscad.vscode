const vscode = require("vscode");
const { importDirective, sourceTokens, importCandidates } = require("./imports");
const { parseGroups } = require("./syntax");

const identifier = /^\$?[A-Za-z_]\w*$/;
const expressionPrefixes = new Set(["let", "assert", "echo", "function"]);
const importBoundary = "\x01";

function checkTerminators(code, stringEnds, add) {
    for (const scope of parseGroups(code)) {
        if (scope.parent && scope.value !== "{") continue;
        let pending;
        const items = scope.items;
        const finish = () => {
            if (!pending?.last || pending.needsAssignment) return;
            const { last, previous } = pending;
            if (!last.close && !/^[\w$.]/.test(last.value)) return;
            if (last.value === "(" && expressionPrefixes.has(previous?.value) && pending.expression) return;
            const end = stringEnds.get(last.start) ?? (last.close ? last.end + 1 : last.start + last.value.length);
            add(end - 1, 1, 'Expected ";" after statement.');
            pending = undefined;
        };

        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const next = items[index + 1];
            const args = items[index + 2];
            if (item.value === ";" || item.value === "{" || item.value === importBoundary || item.value === "else") {
                if (item.value === importBoundary || item.value === "else" || (item.value === "{" && pending?.expression)) finish();
                pending = undefined;
                continue;
            }

            const declaration = ["function", "module"].includes(item.value) &&
                identifier.test(next?.value || "") && args?.value === "(";
            const assignment = identifier.test(item.value) && next?.value === "=";
            const call = identifier.test(item.value) && next?.value === "(";
            if (declaration || assignment) {
                finish();
                pending = { expression: assignment || item.value === "function",
                    needsAssignment: declaration && item.value === "function" };
                // The declaration's name is part of its header rather than a separate call.
                if (declaration) index++;
            } else if (call) {
                if (pending?.expression) finish();
                pending ||= { expression: false };
            }
            if (pending) {
                if (item.value === "=") pending.needsAssignment = false;
                pending.previous = pending.last;
                pending.last = items[index];
            }
        }
        finish();
    }
}

async function collectDiagnostics(document, cancelled = () => false) {
    const source = document.getText();
    const diagnostics = [];
    const add = (offset, length, message, severity = vscode.DiagnosticSeverity.Error) => {
        const range = new vscode.Range(document.positionAt(offset), document.positionAt(offset + length));
        const diagnostic = new vscode.Diagnostic(range, message, severity);
        diagnostic.source = "OpenSCAD";
        diagnostics.push(diagnostic);
    };

    const imports = [];
    const stringEnds = new Map();
    let offset = 0;
    const segments = [];
    let unterminated = false;
    for (const match of source.matchAll(sourceTokens)) {
        const [token, nonCode] = match;
        const blank = token.replace(/[^\r\n]/g, " ");
        const marker = !nonCode ? importBoundary : token.startsWith('"') ? "0" : "";
        segments.push(source.slice(offset, match.index), marker ? marker + blank.slice(1) : blank);
        offset = match.index + token.length;
        if (marker === "0") stringEnds.set(match.index, offset);
        if (!nonCode) {
            const directive = Array.from(token.matchAll(importDirective))[0];
            imports.push({ filename: directive[2], offset: match.index + token.indexOf("<") + 1 });
        } else if (token.startsWith('"') && !/^"(?:\\[\s\S]|[^"\\])*"$/.test(token)) {
            add(match.index, 1, "Unterminated string.");
            unterminated = true;
        } else if (token.startsWith("/*") && (token.length < 4 || !token.endsWith("*/"))) {
            add(match.index, 2, "Unterminated block comment.");
            unterminated = true;
        }
    }
    segments.push(source.slice(offset));
    const code = segments.join("");
    for (const directive of code.matchAll(/(?<!\$)\b(?:include|use)\b/g)) {
        add(directive.index, directive[0].length, "Expected a file path in angle brackets.");
    }

    const closing = { "(": ")", "[": "]", "{": "}" };
    const stack = [];
    for (const match of code.matchAll(/[{}()[\]]/g)) {
        const token = match[0];
        if (closing[token]) {
            stack.push({ offset: match.index, open: token, close: closing[token] });
            continue;
        }
        if (stack[stack.length - 1]?.close === token) {
            stack.pop();
        } else {
            const opener = stack[stack.length - 1];
            add(match.index, 1, opener ? 'Expected "' + opener.close + '" before "' + token + '".' :
                'Unexpected closing delimiter "' + token + '".');
            const matching = stack.findLastIndex(entry => entry.close === token);
            if (matching >= 0) stack.length = matching;
        }
    }
    if (!unterminated) {
        for (const { offset, open, close } of stack) {
            add(offset, 1, 'Unclosed "' + open + '". Expected "' + close + '".');
        }
    }

    if (!diagnostics.length) checkTerminators(code, stringEnds, add);

    const checked = new Map();
    for (const { filename, offset } of imports) {
        if (cancelled()) return [];
        if (!checked.has(filename)) checked.set(filename, await importExists(document, filename));
        if (!checked.get(filename)) {
            add(offset, filename.length, "Cannot resolve OpenSCAD file " + JSON.stringify(filename) + ".",
                vscode.DiagnosticSeverity.Warning);
        }
    }
    return diagnostics;
}

async function importExists(document, filename) {
    for (const uri of importCandidates(document, filename)) {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type & vscode.FileType.File) return true;
        } catch {
            // Try the next library location.
        }
    }
    return false;
}

function registerDiagnostics(context, output) {
    const collection = vscode.languages.createDiagnosticCollection("openscad");
    const pending = new Map();
    const cancel = uri => {
        const key = uri.toString();
        const ticket = pending.get(key);
        if (ticket) clearTimeout(ticket.timer);
        pending.delete(key);
    };
    const schedule = document => {
        if (document.languageId !== "openscad") return;
        const key = document.uri.toString();
        cancel(document.uri);
        const ticket = {};
        pending.set(key, ticket);
        const cancelled = () => pending.get(key) !== ticket || document.isClosed;
        ticket.timer = setTimeout(async () => {
            try {
                const diagnostics = await collectDiagnostics(document, cancelled);
                if (!cancelled()) collection.set(document.uri, diagnostics);
            } catch (error) {
                if (!cancelled()) output.appendLine("OpenSCAD diagnostics failed: " + error.message);
            } finally {
                if (pending.get(key) === ticket) pending.delete(key);
            }
        }, 250);
    };
    const refresh = () => vscode.workspace.textDocuments.forEach(schedule);
    context.subscriptions.push(
        collection,
        vscode.workspace.onDidOpenTextDocument(schedule),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.contentChanges.length) schedule(event.document);
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            cancel(document.uri);
            collection.delete(document.uri);
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (["executablePath", "userLibraryPath", "installationLibraryPath", "extraLibraryPaths"]
                .some(setting => event.affectsConfiguration("openscad." + setting))) refresh();
        }),
        vscode.workspace.onDidCreateFiles(refresh),
        vscode.workspace.onDidDeleteFiles(refresh),
        vscode.workspace.onDidRenameFiles(refresh),
        { dispose() {
            for (const ticket of pending.values()) clearTimeout(ticket.timer);
            pending.clear();
        } }
    );
    refresh();
}

module.exports = { collectDiagnostics, registerDiagnostics };
