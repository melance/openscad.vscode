const vscode = require("vscode");
const { findRegionMarkers, pairRegionMarkers, findBraceFolds } = require("./regions");
const hoverProvider = require("./hover");
const completionProvider = require("./completion");
const referenceProvider = require("./references");
const signatureHelpProvider = require("./signature-help");
const outlineProvider = require("./outline");
const { registerDiagnostics } = require("./diagnostics");
const { generateDocumentation, registerDocumentationContinuation } = require("./documentation");
const { registerBuiltinHighlighting } = require("./builtin-highlighting");
const { previewOpenSCAD } = require("./preview");

function findDocumentationBodyRanges(document, highlightBosl2) {
    const ranges = [];
    const heading = /^\/\/[ \t]+(?:Function&Module|Function|Module|Description|Arguments|Usage|Example):[ \t]*(.*)$/;
    const continuation = /^\/\/[ \t]{2,}(\S.*)$/;
    const customizerGroup = /^\/\*[ \t]*(\[[^\[\]\r\n]+\])[ \t]*\*\/$/;
    const customizerSetting = /^\/\/[ \t]*(\[[^\[\]\r\n]+\])[ \t]*$/;
    const stringsAndComments = /"(?:\\[\s\S]|[^"\\])*(?:"|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g;

    let previousDocLine = -2;

    for (const token of document.getText().matchAll(stringsAndComments)) {
        const comment = token[0];
        const group = customizerGroup.exec(comment);
        if (group) {
            const start = token.index + comment.indexOf("[");
            ranges.push(new vscode.Range(document.positionAt(start), document.positionAt(start + group[1].length)));
            continue;
        }
        if (!comment.startsWith("//")) {
            continue;
        }

        const position = document.positionAt(token.index);
        const line = document.lineAt(position.line);
        const setting = customizerSetting.exec(comment);
        if (setting && /;[ \t]*$/.test(line.text.slice(0, position.character))) {
            const start = token.index + comment.indexOf("[");
            ranges.push(new vscode.Range(document.positionAt(start), document.positionAt(start + setting[1].length)));
            continue;
        }
        if (!highlightBosl2) {
            continue;
        }
        if (position.character !== line.firstNonWhitespaceCharacterIndex) {
            continue;
        }

        let match = heading.exec(comment);
        if (!match && position.line === previousDocLine + 1) {
            match = continuation.exec(comment);
        }
        if (!match) {
            continue;
        }

        previousDocLine = position.line;
        const body = match[1];
        if (body.length > 0) {
            const end = line.range.end;
            ranges.push(new vscode.Range(end.translate(0, -body.length), end));
        }
    }

    return ranges;
}

function activate(context) {
    const output = vscode.window.createOutputChannel("OpenSCAD Language");
    context.subscriptions.push(output);
    registerDiagnostics(context, output);
    registerBuiltinHighlighting(context);
    registerDocumentationContinuation(context);

    const documentationBodyStyle = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor("openscad.documentationBodyForeground")
    });
    context.subscriptions.push(documentationBodyStyle);
    context.subscriptions.push(
        vscode.languages.registerHoverProvider("openscad", hoverProvider),
        vscode.languages.registerDefinitionProvider("openscad", hoverProvider),
        vscode.languages.registerCompletionItemProvider("openscad", completionProvider, "$"),
        vscode.languages.registerSignatureHelpProvider("openscad", signatureHelpProvider, {
            triggerCharacters: ["(", ",", "="],
            retriggerCharacters: [")"]
        }),
        vscode.languages.registerReferenceProvider("openscad", referenceProvider),
        vscode.languages.registerRenameProvider("openscad", referenceProvider),
        vscode.languages.registerDocumentSymbolProvider("openscad", outlineProvider),
        vscode.commands.registerCommand("openscad.generateDocumentation", generateDocumentation),
        vscode.commands.registerCommand("openscad.preview", previewOpenSCAD)
    );
    
    // Regions
    const foldingChanged = new vscode.EventEmitter();

    const foldingProvider = {
        onDidChangeFoldingRanges: foldingChanged.event,

        provideFoldingRanges(document) {
            const settings = vscode.workspace.getConfiguration("openscad", document.uri);
            const regions = settings.get("regions.enabled")
                ? pairRegionMarkers(findRegionMarkers(document)).map(({ start, end }) =>
                    new vscode.FoldingRange(start, end, vscode.FoldingRangeKind.Region))
                : [];
            const braces = findBraceFolds(document).map(({ start, end }) =>
                new vscode.FoldingRange(start, end));
            return [...regions, ...braces].sort((a, b) => a.start - b.start || b.end - a.end);
        }
    };

    context.subscriptions.push(
        foldingChanged,
        vscode.languages.registerFoldingRangeProvider("openscad", foldingProvider)
    );

    const regionLineStyle = vscode.window.createTextEditorDecorationType({
        color: new vscode.ThemeColor("openscad.regionForeground")
    });
    context.subscriptions.push(regionLineStyle);

    function updateRegionTitles(editor) {
        const document = editor.document;
        if (document.languageId !== "openscad") {
            return;
        }

        const settings = vscode.workspace.getConfiguration("openscad", document.uri);
        const ranges = settings.get("regions.enabled")
            ? findRegionMarkers(document).map(marker => document.lineAt(marker.line).range)
            : [];

        editor.setDecorations(regionLineStyle, ranges);
        editor.setDecorations(documentationBodyStyle,
            findDocumentationBodyRanges(document, settings.get("bosl2.highlighting.enabled")));
    }

    function refreshVisibleRegionTitles() {
        for (const editor of vscode.window.visibleTextEditors) {
            updateRegionTitles(editor);
        }
    }

    function reportRegionSetting() {
        const document = vscode.window.activeTextEditor?.document;
        if (document?.languageId !== "openscad") {
            return;
        }

        const settings = vscode.workspace.getConfiguration("openscad", document.uri);
        const enabled = settings.get("regions.enabled");
        output.appendLine(`Regions ${enabled ? "enabled" : "disabled"} for ${document.fileName}`);
    }

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(reportRegionSetting),
        vscode.window.onDidChangeVisibleTextEditors(refreshVisibleRegionTitles),
        vscode.workspace.onDidChangeTextDocument(event => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) {
                    updateRegionTitles(editor);
                }
            }
        }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration("openscad.regions.enabled")) {
                foldingChanged.fire();
                reportRegionSetting();
            }
            if (event.affectsConfiguration("openscad.regions.enabled") ||
                event.affectsConfiguration("openscad.bosl2.highlighting.enabled")) {
                refreshVisibleRegionTitles();
            }
        })
    );

    refreshVisibleRegionTitles();
    reportRegionSetting();
}

module.exports = { activate };
