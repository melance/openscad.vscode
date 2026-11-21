const vscode = require("vscode");
const { getBuiltinCatalog } = require("./builtins");
const { makeSession } = require("./symbols");

function registerBuiltinHighlighting(context) {
    const changed = new vscode.EventEmitter();
    const legend = new vscode.SemanticTokensLegend(["function", "variable"], ["defaultLibrary"]);
    const provider = {
        onDidChangeSemanticTokens: changed.event,
        async provideDocumentSemanticTokens(document, token) {
            const catalog = getBuiltinCatalog(document);
            const session = makeSession(token);
            const state = session.index(document);
            const builder = new vscode.SemanticTokensBuilder(legend);
            const occurrences = Array.from(state.occurrences).sort(([a], [b]) => a - b);
            for (const [offset, occurrence] of occurrences) {
                if (token?.isCancellationRequested) return;
                const { name } = occurrence;
                const kind = occurrence.symbol?.kind === "variable" ? "variable" : occurrence.kind;
                if (!catalog.has(kind + ":" + name)) continue;
                if (kind !== "variable" && await session.resolve(state, offset, occurrence)) continue;
                const range = new vscode.Range(document.positionAt(offset), document.positionAt(offset + name.length));
                builder.push(range, kind === "variable" ? "variable" : "function", ["defaultLibrary"]);
            }
            return builder.build();
        }
    };
    context.subscriptions.push(
        changed,
        vscode.languages.registerDocumentSemanticTokensProvider("openscad", provider, legend),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("openscad.targetVersion") ||
                event.affectsConfiguration("openscad.experimentalFeatures") ||
                event.affectsConfiguration("openscad.extraLibraryPaths")) changed.fire();
        })
    );
}

module.exports = { registerBuiltinHighlighting };
