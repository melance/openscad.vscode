const vscode = require("vscode");
const { indexDocument } = require("./symbols");
const { precedingLineComments } = require("./parameter-docs");

function documentationPrefixes(editor) {
    if (editor?.document.languageId !== "openscad") return [];
    const { document, selections } = editor;
    const prefixes = selections.map(({ start, end }) => {
        if (start.line !== end.line) return;
        const line = document.lineAt(start.line);
        const prefix = /^([ \t]*)\/\/([ \t]*)/.exec(line.text);
        if (!prefix || start.character < prefix[1].length + 2) return;

        const heading = /^[ \t]*\/\/[ \t]+(?:Function&Module|Function|Module|Description|Arguments|Usage|Example):/;
        const continuation = /^[ \t]*\/\/(?:[ \t]{2,}|[ \t]*$)/;
        let first = start.line;
        while (first > 0 && continuation.test(document.lineAt(first).text) &&
            !heading.test(document.lineAt(first).text)) first--;
        if (!heading.test(document.lineAt(first).text)) return;

        const offset = document.offsetAt(line.range.start) + prefix[1].length;
        const tokens = /"(?:\\[\s\S]|[^"\\])*(?:"|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g;
        for (const token of document.getText().matchAll(tokens)) {
            if (token.index >= offset) {
                if (token.index === offset) return prefix[1] + "//" +
                    (prefix[2].length >= 2 ? prefix[2] : "   ");
                return;
            }
        }
    });
    return prefixes.every(Boolean) ? prefixes : [];
}

function registerDocumentationContinuation(context) {
    const updateContext = () => vscode.commands.executeCommand("setContext", "openscad.inDocumentationComment",
        documentationPrefixes(vscode.window.activeTextEditor).length > 0);

    context.subscriptions.push(
        vscode.commands.registerCommand("openscad.continueDocumentationComment", () => {
            const editor = vscode.window.activeTextEditor;
            const prefixes = documentationPrefixes(editor);
            if (!prefixes.length) return vscode.commands.executeCommand("default:type", { text: "\n" });
            return editor.edit(edit => editor.selections.forEach((selection, index) => {
                edit.replace(selection, "\n" + prefixes[index]);
            }));
        }),
        vscode.window.onDidChangeActiveTextEditor(updateContext),
        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor === vscode.window.activeTextEditor) updateContext();
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === vscode.window.activeTextEditor?.document) updateContext();
        })
    );
    updateContext();
}

async function generateDocumentation() {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId !== "openscad") return;

    const { document } = editor;
    const cursor = editor.selection.active;
    const offset = document.offsetAt(cursor);
    const declarations = indexDocument(document).symbols.filter(symbol => symbol.declaration);
    const onHeader = declarations.find(symbol =>
        document.positionAt(symbol.declaration.offset).line === cursor.line &&
        offset <= symbol.declaration.offset);
    const symbol = onHeader || declarations.filter(({ outline }) => outline.start <= offset && offset < outline.end)
        .sort((a, b) => b.outline.start - a.outline.start)[0];
    if (!symbol) {
        vscode.window.showInformationMessage("Place the cursor on an OpenSCAD function or module declaration.");
        return;
    }

    const { name, kind, declaration, parameters } = symbol;
    const source = document.getText();
    const comments = precedingLineComments(source, declaration.offset);
    if (comments.some(({ text }) =>
        /^[ \t]*\/\/[ \t]*(?:Function&Module|Function|Module):[ \t]*(\$?[A-Za-z_]\w*)/.exec(text)?.[1] === name)) {
        vscode.window.showInformationMessage("This declaration already has a BOSL2 documentation block.");
        return;
    }

    const position = document.positionAt(declaration.offset);
    const line = document.lineAt(position.line);
    const prefix = line.text.slice(0, position.character);
    const inline = /\S/.test(prefix);
    const indentation = inline ? "" : prefix;
    const names = Array.from(parameters.keys());
    const snippet = new vscode.SnippetString();
    if (inline) snippet.appendText("\n");
    const heading = kind === "module" ? "Module" : "Function";
    snippet.appendText(indentation + "// " + heading + ": " + name + "()\n");
    snippet.appendText(indentation + "// Usage:\n");
    const call = name + "(" + names.join(", ") + ");";
    snippet.appendText(indentation + "//   " + (kind === "function" ? "result = " : "") + call + "\n");
    snippet.appendText(indentation + "// Description:\n" + indentation + "//   ");
    snippet.appendPlaceholder("Describe " + name + ".");
    snippet.appendText("\n");
    if (names.length) {
        snippet.appendText(indentation + "// Arguments:\n");
        for (const parameter of names) {
            snippet.appendText(indentation + "//   " + parameter + " = ");
            snippet.appendPlaceholder("Describe " + parameter + ".");
            snippet.appendText("\n");
        }
    }
    await editor.insertSnippet(snippet, inline ? position : line.range.start);
}

module.exports = { generateDocumentation, registerDocumentationContinuation };
