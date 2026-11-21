const stringsAndComments = /"(?:\\[\s\S]|[^"\\])*(?:"|$)|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*/g;

function pairRegionMarkers(markers) {
    const openRegions = [];
    const ranges = [];

    for (const marker of markers) {
        if (marker.kind === "start") {
            openRegions.push(marker.line);
        } else if (marker.kind === "end" && openRegions.length > 0) {
            const start = openRegions.pop();
            ranges.push({ start, end: marker.line });
        }
    }

    return ranges;
}

function findRegionMarkers(document) {
    const markers = [];
    const text = document.getText();

    for (const match of text.matchAll(stringsAndComments)) {
        const marker = /^\/\/[ \t]*#(region|endregion)\b/.exec(match[0]);
        if (!marker) {
            continue;
        }

        const position = document.positionAt(match.index);
        if (position.character !== document.lineAt(position.line).firstNonWhitespaceCharacterIndex) {
            continue;
        }

        markers.push({
            kind: marker[1] === "region" ? "start" : "end",
            line: position.line
        });
    }

    return markers;
}

function findBraceFolds(document) {
    const tokens = new RegExp(stringsAndComments.source +
        String.raw`|\b(?:use|include)\s*<[^<>\r\n]+>`, "g");
    const code = document.getText().replace(tokens, token => token.replace(/[^\r\n]/g, " "));
    const ranges = [];

    for (const { items } of parseGroups(code)) {
        for (let i = 0; i < items.length; i++) {
            const block = items[i];
            if (block.value !== "{" || block.end === code.length) continue;

            const declaration = items[i - 3];
            const isModuleBody = declaration?.value === "module" &&
                /^\$?[A-Za-z_]\w*$/.test(items[i - 2].value) && items[i - 1].value === "(";
            const start = document.positionAt(isModuleBody ? declaration.start : block.start).line;
            const end = document.positionAt(block.end).line;
            if (end > start) ranges.push({ start, end });
        }
    }

    return ranges;
}

module.exports = { findRegionMarkers, pairRegionMarkers, findBraceFolds };
const { parseGroups } = require("./syntax");

