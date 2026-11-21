const vscode = require("vscode");
const { parseGroups } = require("./syntax");
const { importDirective, maskNonCode } = require("./imports");
const { resolveCall } = require("./hover");
const { readParameterDocs } = require("./parameter-docs");

const identifier = /^\$?[A-Za-z_]\w*$/;
const nonCalls = new Set(["if", "for", "let", "each", "intersection_for", "function"]);
function splitArguments(group) {
    const segments = [[]];
    for (const item of group.items) {
        if (item.value === ",") segments.push([]);
        else segments[segments.length - 1].push(item);
    }
    return segments;
}

function declaredSignature(declaration, document) {
    const { signature, offset, description } = declaration;
    const group = parseGroups(maskNonCode(signature))[1];
    const documentation = new Map(readParameterDocs(document.getText(), offset)
        .map(entry => [entry.name, entry.description]));
    const boundaries = group.items.filter(item => item.value === ",").map(item => item.start);
    boundaries.push(group.end);
    let start = group.start + 1;
    const parameters = [];
    for (const end of boundaries) {
        const raw = signature.slice(start, end);
        const name = /^\s*(\$?[A-Za-z_]\w*)/.exec(maskNonCode(raw))?.[1];
        if (name) {
            const label = raw.replace(/("(?:\\[\s\S]|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
                (_, quoted) => quoted || " ").trim().replace(/[ \t]*(?:\r\n?|\n)[ \t]*/g, " ");
            parameters.push({ name, label,
                description: documentation.get(name) });
        }
        start = end + 1;
    }
    return { title: signature.slice(0, group.start).trim().replace(/\s+/g, " "), description, parameters };
}

function activeParameter(group, offset, parameters) {
    const segments = splitArguments(group);
    const argumentIndex = group.items.filter(item => item.value === "," && item.start < offset).length;
    const current = segments[argumentIndex];
    if (current[1]?.value === "=") {
        const named = parameters.findIndex(parameter => parameter.name === current[0].value);
        if (named >= 0) return { index: named };
    }
    const position = segments.slice(0, argumentIndex).filter(segment => segment[1]?.value !== "=").length;
    const positional = parameters.map((parameter, index) => parameter.namedOnly ? -1 : index)
        .filter(index => index >= 0);
    return {
        index: positional[Math.min(position, positional.length - 1)] ?? 0,
        position: position < positional.length && current[1]?.value !== "=" ? position + 1 : undefined
    };
}

async function provideSignatureHelp(document, position, token) {
    const offset = document.offsetAt(position);
    const code = maskNonCode(document.getText());
    const groups = parseGroups(code.replace(importDirective, match => match.replace(/[^\r\n]/g, " ")));
    for (const group of groups.reverse()) {
        if (token?.isCancellationRequested) return;
        if (group.value !== "(" || offset <= group.start || offset > group.end) continue;
        const name = group.previous?.value;
        if (!identifier.test(name || "") || nonCalls.has(name)) continue;
        const previous = group.parent.items[group.parent.items.indexOf(group) - 2]?.value;
        if (previous === "function" || previous === "module") continue;

        const call = await resolveCall(document, document.positionAt(group.previous.start), token);
        if (token?.isCancellationRequested) return;
        const signature = call?.builtin ? { ...call.builtin, title: call.builtin.name } :
            call?.declaration ? declaredSignature(call.declaration, call.targetDocument) : undefined;
        if (!signature) continue;

        const { title, description, parameters } = signature;
        const active = activeParameter(group, offset, parameters);
        let label = title + "(";
        const info = new vscode.SignatureInformation("",
            description ? new vscode.MarkdownString(description) : undefined);
        info.parameters = parameters.map((parameter, index) => {
            if (index) label += ", ";
            const start = label.length;
            label += parameter.label;
            const positionalLabel = index === active.index && active.position !== undefined
                ? `Positional argument ${active.position} → ${parameter.name}` : undefined;
            const documentation = new vscode.MarkdownString();
            if (positionalLabel) documentation.appendText(positionalLabel);
            if (parameter.description) {
                if (positionalLabel) documentation.appendMarkdown("\n\n");
                if (call.builtin) documentation.appendText(parameter.description);
                else documentation.appendMarkdown(parameter.description);
            }
            return new vscode.ParameterInformation([start, label.length], documentation.value ? documentation : undefined);
        });
        info.label = label + ")";
        const help = new vscode.SignatureHelp();
        help.signatures = [info];
        help.activeSignature = 0;
        help.activeParameter = active.index;
        return help;
    }
}

module.exports = { provideSignatureHelp };
