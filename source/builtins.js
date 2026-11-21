const vscode = require("vscode");

const data = require("./builtin-catalog.json");

function parameterList(spec) {
    const positional = Array.isArray(spec) ? spec : spec.positional || [];
    const named = Array.isArray(spec) ? [] : spec.named || [];
    return [...positional, ...named].map((parameter, index) => {
        const equals = parameter.indexOf("=");
        const name = equals < 0 ? parameter : parameter.slice(0, equals);
        const label = equals < 0 ? name : name + " = " + parameter.slice(equals + 1);
        return { name, label, namedOnly: index >= positional.length, variadic: name === "..." };
    });
}

function buildCatalog(profile, experimental = false) {
    const catalog = new Map();
    for (const [kind, specs] of [["module", profile.modules || {}], ["function", profile.functions || {}]]) {
        for (const [name, spec] of Object.entries(specs)) {
            if (spec === null) continue;
            catalog.set(kind + ":" + name, {
                name, kind, parameters: parameterList(spec), description: data.descriptions[name], experimental
            });
        }
    }
    for (const name of profile.variables || []) catalog.set("variable:" + name, { name, kind: "variable", experimental });
    return catalog;
}

const release = buildCatalog(data.base);
const nightly = buildCatalog({
    modules: { ...data.base.modules, ...data.nightly.modules },
    functions: { ...data.base.functions, ...data.nightly.functions },
    variables: [...data.base.variables, ...(data.nightly.variables || [])]
});
const experiments = new Map(Object.entries(data.experimental)
    .map(([feature, profile]) => [feature, buildCatalog(profile, true)]));

function getBuiltinCatalog(document) {
    const settings = vscode.workspace.getConfiguration("openscad", document.uri);
    if (settings.get("targetVersion") !== "nightly") return release;
    const enabled = (settings.get("experimentalFeatures") || [])
        .map(feature => experiments.get(feature)).filter(Boolean);
    return enabled.length ? new Map([...nightly, ...enabled.flatMap(profile => Array.from(profile))]) : nightly;
}

module.exports = { getBuiltinCatalog };
