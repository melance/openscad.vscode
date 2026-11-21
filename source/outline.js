const vscode = require("vscode");
const { indexDocument } = require("./symbols");

function provideDocumentSymbols(document, token) {
    if (token?.isCancellationRequested) return;
    const declarations = indexDocument(document).symbols.filter(symbol => symbol.outline)
        .sort((a, b) => a.outline.start - b.outline.start);
    const kinds = {
        module: vscode.SymbolKind.Module,
        function: vscode.SymbolKind.Function,
        variable: vscode.SymbolKind.Variable
    };
    const result = [];
    const parents = [];
    for (const { name, kind, offset, outline } of declarations) {
        if (token?.isCancellationRequested) return;
        const range = new vscode.Range(document.positionAt(outline.start), document.positionAt(outline.end));
        const selection = new vscode.Range(document.positionAt(offset), document.positionAt(offset + name.length));
        const entry = new vscode.DocumentSymbol(name, "", kinds[kind], range, selection);
        while (parents.length && parents[parents.length - 1].end < outline.end) parents.pop();

        const parent = parents[parents.length - 1];
        (parent ? parent.entry.children : result).push(entry);
        if (kind !== "variable") parents.push({ end: outline.end, entry });
    }
    return result;
}

module.exports = { provideDocumentSymbols };
