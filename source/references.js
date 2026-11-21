const vscode = require("vscode");
const { importedDocuments } = require("./imports");
const { identifier, reserved, makeSession, occurrenceAt } = require("./symbols");

function rangeAt(document, offset, name) {
    return new vscode.Range(document.positionAt(offset), document.positionAt(offset + name.length));
}

async function canRename(origin, target, token) {
    if (vscode.workspace.workspaceFolders?.length && !vscode.workspace.getWorkspaceFolder(origin.document.uri)) {
        return false;
    }
    const targetUri = target.document.uri.toString();
    if (targetUri === origin.document.uri.toString()) return true;
    for await (const imported of importedDocuments(origin.document, origin.code, token, true)) {
        if (imported.document.uri.toString() === targetUri && (imported.included || target.kind !== "variable" || target.owner)) {
            return true;
        }
    }
    return false;
}

async function referenceContexts(session, candidates) {
    const parents = new Map();
    const standalone = new Set();
    for (const parent of candidates) {
        for (const edge of await session.importsFor(parent)) {
            if (!candidates.has(edge.state)) continue;
            if (edge.directive.kind === "use") {
                standalone.add(edge.state);
            } else {
                if (!parents.has(edge.state)) parents.set(edge.state, []);
                parents.get(edge.state).push({ parent, offset: edge.directive.offset });
            }
        }
    }
    async function inherited(state, visited = new Set()) {
        if (visited.has(state)) return [];
        const path = new Set(visited).add(state);
        const edges = parents.get(state);
        const contexts = !edges || standalone.has(state) ? [undefined] : [];
        for (const { parent, offset } of edges || []) {
            for (const scope of await inherited(parent, path)) {
                contexts.push(await session.visibleSymbols(parent, offset, scope));
            }
        }
        return contexts;
    }
    return inherited;
}

async function findReferences(document, position, token, includeDeclaration, newName) {
    const session = makeSession(token);
    const origin = session.index(document);
    const selected = occurrenceAt(origin, position);
    const target = selected && await session.resolve(origin, ...selected);
    if (!target || token?.isCancellationRequested) return;
    if (newName && !await canRename(origin, target, token)) {
        throw new Error("Rename is available for project files and relative imports.");
    }
    if (newName && (target.name.startsWith("$") !== newName.startsWith("$") ||
        target.owner?.parameters.has(newName) && newName !== target.name)) {
        throw new Error("The new name conflicts with this declaration.");
    }

    const project = new Set([origin]);
    const files = await vscode.workspace.findFiles("**/*.scad", undefined, undefined, token);
    for (const uri of files) {
        if (token?.isCancellationRequested) return;
        const indexed = session.indexes.get(uri.toString());
        if (indexed) {
            project.add(indexed);
            continue;
        }
        let candidate;
        try {
            candidate = await vscode.workspace.openTextDocument(uri);
        } catch {
            continue;
        }
        project.add(session.index(candidate));
    }
    // Include open unsaved files and the dependency graph of each candidate.
    for (const candidate of vscode.workspace.textDocuments) {
        if (candidate.languageId !== "openscad") continue;
        if (!newName || vscode.workspace.getWorkspaceFolder(candidate.uri)) {
            project.add(session.index(candidate));
        }
    }
    for (const state of newName ? project : session.indexes.values()) {
        if (token?.isCancellationRequested) return;
        if (newName) {
            for await (const imported of importedDocuments(state.document, state.code, token, true)) {
                project.add(session.index(imported.document));
            }
        } else {
            await session.importsFor(state);
        }
    }

    const candidates = newName ? project : new Set(session.indexes.values());
    const contextsFor = await referenceContexts(session, candidates);
    const references = [];
    for (const state of candidates) {
        let contexts;
        for (const [offset, occurrence] of state.occurrences) {
            if (token?.isCancellationRequested) return;
            if (occurrence.name !== target.name || (!includeDeclaration && occurrence.declaration)) continue;
            contexts ||= await contextsFor(state);
            if (!contexts.length) contexts = [undefined];
            const matches = await Promise.all(contexts.map(scope => session.resolve(state, offset, occurrence, scope)));
            if (matches.includes(target)) {
                if (newName && matches.some(symbol => symbol && symbol !== target)) {
                    throw new Error("This reference resolves to different declarations in different include contexts.");
                }
                if (newName && newName !== target.name && occurrence.argumentOf === undefined && !occurrence.symbol?.owner) {
                    for (const scope of contexts) {
                        if (await session.resolve(state, offset, { name: newName, kind: target.kind }, scope)) {
                            throw new Error("The new name is already in use in a reference's scope.");
                        }
                    }
                }
                const range = rangeAt(state.document, offset, occurrence.name);
                references.push(new vscode.Location(state.document.uri, range));
            }
        }
    }
    return references;
}

module.exports = {
    provideReferences(document, position, context, token) {
        return findReferences(document, position, token, context.includeDeclaration);
    },

    async prepareRename(document, position, token) {
        const session = makeSession(token);
        const state = session.index(document);
        const selected = occurrenceAt(state, position);
        const target = selected && await session.resolve(state, ...selected);
        if (!target) {
            throw new Error("No OpenSCAD declaration found for this symbol.");
        }
        if (!await canRename(state, target, token)) {
            throw new Error("Rename is available for project files and relative imports.");
        }
        return rangeAt(document, selected[0], selected[1].name);
    },

    async provideRenameEdits(document, position, newName, token) {
        if (!identifier.test(newName) || reserved.has(newName)) {
            throw new Error("Enter a valid OpenSCAD identifier.");
        }
        const references = await findReferences(document, position, token, true, newName);
        if (!references?.length) return;
        const edits = new vscode.WorkspaceEdit();
        for (const { uri, range } of references) edits.replace(uri, range, newName);
        return edits;
    }
};
