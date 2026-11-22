const vscode = require("vscode");
const { importDirective, maskNonCode, openImport } = require("./imports");
const { makeSession, occurrenceAt } = require("./symbols");
const { getBuiltinCatalog } = require("./builtins");

function readLibraryHeader(source) {
    const preamble = /^(?:[ \t]*(?:\/\/[^\r\n]*)?(?:\r?\n|$))*/.exec(source)[0];
    const header = /^[ \t]*\/\/[ \t]*LibFile:[ \t]*\S[^\r\n]*/m.exec(preamble);
    if (!header) return;

    const lines = [header[0].trimStart().slice(2).trim()];
    const following = preamble.slice(header.index + header[0].length).split(/\r?\n/);
    for (const line of following.slice(1)) {
        const continuation = /^[ \t]*\/\/[ \t]{2,}(.*)$/.exec(line);
        if (!continuation) break;
        lines.push(continuation[1].trimEnd());
    }
    return lines.join("\n").trimEnd();
}

function readDescription(source, start, name, kind) {
    const lines = source.slice(0, start).trimEnd().split(/\r?\n/);
    const comments = [];
    while (lines.length && /^\s*\/\//.test(lines[lines.length - 1])) {
        comments.push(lines.pop().trimStart().slice(2));
    }

    let matchesDeclaration = false;
    let inDescription = false;
    const description = [];
    const body = [];
    for (const line of comments.reverse()) {
        const title = /^ *(Function&Module|Function|Module):\s*(\w+)/.exec(line);
        if (title) {
            matchesDeclaration = title[2] === name &&
                (title[1] === "Function&Module" || title[1].toLowerCase() === kind);
            description.length = 0;
            body.length = 0;
        }
        const section = /^ ?([\w& ]+):[ \t]*(.*)$/.exec(line);
        if (section) {
            inDescription = section[1].trim() === "Description";
            if (inDescription && section[2]) description.push(section[2]);
        } else if (inDescription && matchesDeclaration && (/^[ \t]{2}/.test(line) || !line.trim())) {
            body.push(line);
        }
    }
    if (!matchesDeclaration) return "";

    const indent = body.reduce((width, line) => line.trim()
        ? Math.min(width, line.length - line.trimStart().length) : width, Infinity);
    description.push(...body.map(line => line.trim() ? line.slice(indent) : ""));

    // Markdown collapses ordinary line endings in paragraphs. Keep comment line
    // breaks visible without adding trailing spaces to fenced code.
    let fence;
    return description.map((line, index) => {
        const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
            if (marker && marker[1].startsWith(fence) && !marker[2].trim()) fence = undefined;
            return line;
        }
        if (marker) {
            fence = marker[1];
            return line;
        }
        if (!line.trim() || !description[index + 1]?.trim() || /(?:\\| {2})$/.test(line)) return line;
        return line.trimEnd() + "  ";
    }).join("\n").trimEnd();
}

async function resolveImportAtPosition(document, position) {
    const offset = document.offsetAt(position);
    const code = maskNonCode(document.getText());
    for (const directive of code.matchAll(importDirective)) {
        const start = directive.index + directive[0].indexOf("<") + 1;
        const end = start + directive[2].length;
        if (offset < start || offset >= end) continue;

        const targetDocument = await openImport(document, directive[2]);
        if (targetDocument) return { targetDocument, start, end };
        return;
    }
}

async function provideImportHover(document, position) {
    const imported = await resolveImportAtPosition(document, position);
    if (!imported) return;

    const { targetDocument, start, end } = imported;
    const header = readLibraryHeader(targetDocument.getText());
    if (!header) return;

    const contents = new vscode.MarkdownString();
    contents.appendMarkdown(header);
    const range = new vscode.Range(document.positionAt(start), document.positionAt(end));
    return new vscode.Hover(contents, range);
}

async function resolveCall(document, position, token) {
    const session = makeSession(token);
    const state = session.index(document);
    const selected = occurrenceAt(state, position);
    if (!selected) return;
    const [offset, occurrence] = selected;
    if (occurrence.kind !== "function" && occurrence.kind !== "module" && !occurrence.symbol?.declaration) return;
    const symbol = await session.resolve(state, offset, occurrence);
    if (token?.isCancellationRequested) return;

    const range = new vscode.Range(document.positionAt(offset), document.positionAt(offset + occurrence.name.length));
    if (!symbol) {
        const builtin = getBuiltinCatalog(document).get(occurrence.kind + ":" + occurrence.name);
        if (builtin?.parameters) return { range, builtin };
    }
    if (!symbol?.declaration) return;
    const targetDocument = symbol.document;
    const declaration = { ...symbol.declaration,
        description: readDescription(targetDocument.getText(), symbol.declaration.offset, symbol.name, symbol.kind) };
    return { range, declaration, targetDocument };
}

module.exports = {
    resolveCall,

    async provideHover(document, position) {
        const importHover = await provideImportHover(document, position);
        if (importHover) return importHover;

        const call = await resolveCall(document, position);
        if (!call) return;
        if (call.builtin) {
            const { builtin, range } = call;
            const contents = new vscode.MarkdownString();
            contents.appendCodeblock(builtin.name + "(" + builtin.parameters.map(parameter => parameter.label).join(", ") + ")", "openscad");
            contents.appendText(builtin.experimental ? "Experimental OpenSCAD " + builtin.kind : "Built-in OpenSCAD " + builtin.kind);
            if (builtin.description) contents.appendMarkdown("\n\n" + builtin.description);
            return new vscode.Hover(contents, range);
        }

        const { range, declaration, targetDocument } = call;
        const contents = new vscode.MarkdownString();
        contents.baseUri = targetDocument.uri;
        const signature = declaration.signature.replace(/[ \t]*(?:\r\n?|\n)[ \t]*/g, " ")
            .replace(/\(\s+/, "(")
            .replace(/\s+\)$/, ")");
        contents.appendCodeblock(signature, "openscad");

        if (declaration.description) {
            contents.appendMarkdown("\n\n");
            contents.appendMarkdown(declaration.description);
        }

        return new vscode.Hover(contents, range);
    },

    async provideDefinition(document, position) {
        const imported = await resolveImportAtPosition(document, position);
        if (imported) {
            const { targetDocument } = imported;
            return new vscode.Location(targetDocument.uri, targetDocument.positionAt(0));
        }

        const call = await resolveCall(document, position);
        if (!call?.declaration) return;

        const target = call.targetDocument.positionAt(call.declaration.nameOffset);
        return new vscode.Location(call.targetDocument.uri, target);
    }
};
