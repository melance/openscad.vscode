const vscode = require("vscode");
const path = require("node:path");
const { getBuiltinCatalog } = require("./builtins");
const { importDirective, maskNonCode } = require("./imports");
const { makeSession } = require("./symbols");

const identifier = /^\$?[A-Za-z_]\w*$/;
const control = new Set(["if", "for", "let", "each", "intersection_for", "assign", "function"]);
function argumentContext(groups, offset) {
    const group = groups.findLast(group => group.start < offset && offset <= group.end);
    const name = group?.previous?.value;
    if (group?.value !== "(" || !name || !identifier.test(name) || control.has(name)) return;
    const declarationKeyword = group.parent.items[group.parent.items.indexOf(group) - 2]?.value;
    if (declarationKeyword === "module" || declarationKeyword === "function") return;
    const args = [];
    let current = [];
    for (const item of group.items) {
        if (item.start >= offset) break;
        if (item.value === ",") {
            args.push(current);
            current = [];
        } else {
            current.push(item);
        }
    }
    if (current.length > 1 || (current.length === 1 && !identifier.test(current[0].value))) return;
    const named = new Set(args.filter(arg => arg[1]?.value === "=").map(arg => arg[0].value));
    return { name, start: group.previous.start, named, positional: args.length - named.size };
}

async function provideCompletionItems(document, position, token) {
    const source = document.getText();
    const offset = document.offsetAt(position);
    const code = maskNonCode(source);
    // A sentinel also detects a cursor at the end of an unfinished string or line comment.
    if (maskNonCode(source.slice(0, offset) + "x").at(-1) !== "x") return;
    const imports = Array.from(code.matchAll(importDirective));
    if (imports.some(match => offset > match.index + match[0].indexOf("<") &&
        offset < match.index + match[0].length)) return;
    const session = makeSession(token);
    const state = session.index(document);
    const symbols = new Map();
    const add = symbol => symbols.set(symbol.kind + ":" + symbol.name, symbol);
    const catalog = getBuiltinCatalog(document);
    for (const builtin of catalog.values()) add(builtin);
    const context = argumentContext(state.groups, offset);
    for (const symbol of (await session.visibleAt(state, offset)).values()) {
        if (symbol.document !== document && symbol.name.startsWith("_")) continue;
        add(symbol);
    }
    if (token?.isCancellationRequested) return;

    const before = /\$?\w*$/.exec(source.slice(0, offset))[0];
    const after = /^\w*/.exec(source.slice(offset))[0];
    const range = new vscode.Range(document.positionAt(offset - before.length), document.positionAt(offset + after.length));
    const items = [];
    const kinds = vscode.CompletionItemKind;
    for (const { name, kind, document: origin, experimental, description } of symbols.values()) {
        const item = new vscode.CompletionItem(completionLabel(name, origin), {
            function: kinds.Function, module: kinds.Module, variable: kinds.Variable
        }[kind]);
        item.range = range;
        if (description) item.documentation = new vscode.MarkdownString(description);
        item.detail = experimental ? kind + " · experimental" : kind;
        items.push(item);
    }
    if (context) {
        const occurrence = state.occurrences.get(context.start);
        const symbol = occurrence && await session.resolve(state, context.start, occurrence);
        const builtin = occurrence && catalog.get(occurrence.kind + ":" + occurrence.name);
        const names = symbol?.parameters ? Array.from(symbol.parameters.keys()).slice(context.positional) :
            (builtin?.parameters || []).filter((parameter, index) =>
                !parameter.variadic && (parameter.namedOnly || index >= context.positional)).map(parameter => parameter.name);
        if (symbol && symbol.document !== document && symbol.name.startsWith("_")) return items;
        for (const name of names) {
            if (context.named.has(name)) continue;
            const item = new vscode.CompletionItem(completionLabel(name, symbol?.document), kinds.Property);
            item.range = range;
            item.insertText = /^\s*=/.test(source.slice(offset + after.length)) ? name : name + " = ";
            item.sortText = "0" + name;
            item.detail = "named parameter";
            items.push(item);
        }
    }
    return items;
}

function completionLabel(name, origin) {
    const filename = origin && path.basename(origin.uri.fsPath || origin.uri.path || "");
    return { label: name, description: origin ? filename || "Untitled" : "Built-in" };
}

module.exports = { provideCompletionItems };
