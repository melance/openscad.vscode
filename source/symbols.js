const { parseGroups } = require("./syntax");
const { importDirective, maskNonCode, openImport } = require("./imports");
const { readParameterDocs } = require("./parameter-docs");

const identifier = /^\$?[A-Za-z_]\w*$/;
const reserved = new Set("module function include use if else for intersection_for let each assert echo assign true false undef PI".split(" "));
const builtinKeywords = new Set(["assign", "assert", "echo"]);

function declarationEnd(group, start, kind) {
    const { items } = group;
    for (let i = start; i < items.length; i++) {
        const item = items[i];
        if (item.value === ";" || (kind === "module" && item.value === "{")) {
            if (kind === "module" && items[i + 1]?.value === "else") continue;
            return item.end ?? item.start;
        }
        if (item.value === "module" || (item.value === "function" && identifier.test(items[i + 1]?.value || ""))) {
            return item.start - 1;
        }
    }
    return group.end;
}

function indexDocument(document) {
    const source = document.getText();
    const code = maskNonCode(source);
    const groups = parseGroups(code.replace(importDirective, match => match.replace(/[^\r\n]/g, " ")));
    const directives = Array.from(code.matchAll(importDirective), match => ({
        kind: match[1], filename: match[2], offset: match.index,
        scope: groups.findLast(group => group.start < match.index && match.index <= group.end)
    }));
    const symbols = [];
    const occurrences = new Map();
    const declarationGroups = new Set();
    const declare = (item, kind, start, end) => {
        const symbol = { document, name: item.value, offset: item.start, kind, start, end };
        symbols.push(symbol);
        occurrences.set(item.start, { name: item.value, symbol, declaration: true });
        return symbol;
    };
    const addParameter = (owner, item, start, end) => {
        const parameter = declare(item, "variable", start, end);
        parameter.owner = owner;
        owner.parameters.set(item.value, parameter);
    };

    for (const group of groups) {
        const { items } = group;
        const statementScope = !group.parent || group.value === "{";
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const next = items[i + 1];
            const args = items[i + 2];
            if (!statementScope || !["module", "function"].includes(item.value) ||
                !identifier.test(next?.value || "") || args?.value !== "(") continue;
            const owner = declare(next, item.value, group.start, group.end);
            owner.declaration = { nameOffset: next.start, offset: item.start,
                signature: source.slice(item.start, args.end + 1) };
            owner.parameters = new Map();
            declarationGroups.add(args);
            const end = declarationEnd(group, i + 3, item.value);
            owner.outline = { start: item.start, end: Math.min(end + 1, source.length) };
            for (let j = 0; j < args.items.length; j++) {
                const param = args.items[j];
                if (identifier.test(param.value) && (j === 0 || args.items[j - 1].value === ",")) {
                    addParameter(owner, param, args.start, end);
                }
            }
            indexParameterDocs(source, item.start, owner.parameters, occurrences);
        }
    }

    for (const group of groups) {
        if (group.value !== "(" || !["let", "for", "intersection_for", "assign", "function"].includes(group.previous?.value)) continue;
        const siblings = group.parent.items;
        const index = siblings.indexOf(group);
        const body = siblings[index + 1];
        const end = body?.value === "{" ? body.end :
            siblings.slice(index + 1).find(item => [",", ";"].includes(item.value))?.start ?? group.parent.end;
        declarationGroups.add(group);
        for (let i = 0; i < group.items.length; i++) {
            const item = group.items[i];
            if (item.value === ";") break;
            if (identifier.test(item.value) && (i === 0 || group.items[i - 1].value === ",") &&
                (group.previous.value === "function" || group.items[i + 1]?.value === "=")) {
                declare(item, "variable", item.start - 1, end);
            }
        }
    }

    for (const group of groups) {
        const { items } = group;
        const statementScope = !group.parent || group.value === "{";
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const next = items[i + 1];
            if (!identifier.test(item.value) ||
                (reserved.has(item.value) && !(builtinKeywords.has(item.value) && next?.value === "(")) || occurrences.has(item.start) ||
                items[i - 1]?.value === ".") continue;
            if (statementScope && next?.value === "=") {
                const existing = symbols.find(symbol => symbol.kind === "variable" &&
                    symbol.name === item.value && symbol.start === group.start && symbol.end === group.end);
                if (existing) occurrences.set(item.start, { name: item.value, symbol: existing, declaration: true });
                else {
                    const symbol = declare(item, "variable", group.start, group.end);
                    const end = items.slice(i + 2).find(entry => entry.value === ";")?.start ?? group.end;
                    symbol.outline = { start: item.start, end: Math.min(end + 1, source.length) };
                }
                continue;
            }
            const occurrence = { name: item.value };
            if (next?.value === "(") {
                let expression = !statementScope;
                for (let j = i - 1; j >= 0 && !expression; j--) {
                    if ([";", "{"].includes(items[j].value)) break;
                    expression = items[j].value === "=";
                }
                occurrence.kind = expression ? "function" : "module";
            } else if (next?.value === "=" && group.value === "(" && !declarationGroups.has(group) &&
                (i === 0 || items[i - 1].value === ",") && identifier.test(group.previous?.value || "")) {
                occurrence.argumentOf = group.previous.start;
            } else {
                occurrence.kind = "variable";
            }
            occurrences.set(item.start, occurrence);
        }
    }
    return { document, code, groups, directives, symbols, occurrences };
}

function indexParameterDocs(source, declarationOffset, parameters, occurrences) {
    for (const { name, offset } of readParameterDocs(source, declarationOffset)) {
        const symbol = parameters.get(name);
        if (symbol) occurrences.set(offset, { name, symbol });
    }
}

function makeSession(token) {
    const indexes = new Map();
    const libraries = new Map();
    const files = new Map();
    const opened = new Map();
    const index = document => {
        const key = document.uri.toString();
        if (!indexes.has(key)) indexes.set(key, indexDocument(document));
        return indexes.get(key);
    };
    const importsFor = state => {
        if (!libraries.has(state)) {
            libraries.set(state, (async () => {
                const result = [];
                for (const directive of state.directives) {
                    if (token?.isCancellationRequested) break;
                    if (directive.kind === "use" && directive.scope.parent) continue;
                    const document = await openImport(state.document, directive.filename, opened);
                    if (document) result.push({ directive, state: index(document) });
                }
                return result;
            })());
        }
        return libraries.get(state);
    };
    const key = symbol => symbol.kind + ":" + symbol.name;
    async function expand(state, scope, stack) {
        const bindings = new Map();
        const uses = [];
        const path = new Set(stack).add(state);
        const entries = state.symbols.filter(symbol => symbol.start === scope.start && symbol.end === scope.end);
        for (const imported of await importsFor(state)) {
            if (imported.directive.scope === scope) {
                entries.push({ ...imported, offset: imported.directive.offset });
            }
        }
        entries.sort((a, b) => a.offset - b.offset);
        for (const entry of entries) {
            if (!entry.directive) {
                bindings.set(key(entry), entry);
            } else if (entry.directive.kind === "use") {
                uses.push(entry.state);
            } else if (!path.has(entry.state)) {
                const included = await expand(entry.state, entry.state.groups[0], path);
                for (const [name, symbol] of included.bindings) bindings.set(name, symbol);
                uses.push(...included.uses);
            }
        }
        return { bindings, uses };
    }
    const fileScope = state => {
        if (!files.has(state)) files.set(state, expand(state, state.groups[0], new Set()));
        return files.get(state);
    };
    async function visibleSymbols(state, offset, inherited) {
        const visible = new Map(inherited);
        if (!inherited) {
            const file = await fileScope(state);
            // Later use directives win, but declarations in the file take precedence.
            for (const used of file.uses) {
                for (const [name, symbol] of (await fileScope(used)).bindings) {
                    if (symbol.kind !== "variable") visible.set(name, symbol);
                }
            }
            for (const [name, symbol] of file.bindings) visible.set(name, symbol);
        }
        const nested = state.groups.filter(group =>
            group.value === "{" && group.start < offset && offset <= group.end);
        const lexical = state.symbols.filter(symbol =>
            symbol.start >= 0 && symbol.start < offset && offset <= symbol.end &&
            !nested.some(group => symbol.start === group.start && symbol.end === group.end));
        const scopes = nested.map(group => ({ start: group.start, group }));
        scopes.push(...lexical.map(symbol => ({ start: symbol.start, symbol })));
        scopes.sort((a, b) => a.start - b.start);
        for (const { group, symbol } of scopes) {
            if (symbol) visible.set(key(symbol), symbol);
            else {
                const block = await expand(state, group, new Set());
                for (const [name, binding] of block.bindings) visible.set(name, binding);
            }
        }
        return visible;
    }
    const visibleAt = new Map();
    function visibleAtOffset(state, offset) {
        // Calls within the same lexical scopes share their symbol table.
        const scopeKey = [
            ...state.groups.filter(group => group.value === "{" && group.start < offset && offset <= group.end)
                .map(group => group.start),
            ...state.symbols.filter(symbol => symbol.start >= 0 && symbol.start < offset && offset <= symbol.end)
                .map(symbol => symbol.start)
        ].join(",");
        if (!visibleAt.has(state)) visibleAt.set(state, new Map());
        const cache = visibleAt.get(state);
        if (!cache.has(scopeKey)) cache.set(scopeKey, visibleSymbols(state, offset));
        return cache.get(scopeKey);
    }
    async function resolve(state, offset, occurrence, inherited) {
        if (occurrence.symbol) return occurrence.symbol;
        if (occurrence.argumentOf !== undefined) {
            const call = state.occurrences.get(occurrence.argumentOf);
            const owner = call && await resolve(state, occurrence.argumentOf, call, inherited);
            return owner?.parameters?.get(occurrence.name);
        }
        const visible = inherited ? await visibleSymbols(state, offset, inherited) : await visibleAtOffset(state, offset);
        return visible.get(key(occurrence));
    }
    return { index, indexes, importsFor, resolve, visibleAt: visibleAtOffset, visibleSymbols };
}

function occurrenceAt(state, position) {
    const offset = state.document.offsetAt(position);
    return Array.from(state.occurrences).find(([start, occurrence]) =>
        start <= offset && offset <= start + occurrence.name.length);
}

module.exports = { identifier, reserved, indexDocument, makeSession, occurrenceAt };
