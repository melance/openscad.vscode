const vscode = require("vscode");
const { indexDocument } = require("./symbols");
const { precedingLineComments } = require("./parameter-docs");

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

module.exports = { generateDocumentation };
