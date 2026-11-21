function precedingLineComments(source, declarationOffset) {
    const lines = [];
    let end = declarationOffset;
    while (end > 0 && /\s/.test(source[end - 1])) end--;
    while (end > 0) {
        const start = source.lastIndexOf("\n", end - 1) + 1;
        const text = source.slice(start, end).trimEnd();
        if (!/^[ \t]*\/\//.test(text)) break;
        lines.push({ start, text });
        end = start - 1;
    }

    return lines.reverse();
}

function readParameterDocs(source, declarationOffset) {
    const entries = [];
    let inArguments = false;
    let current = [];
    for (const { start, text } of precedingLineComments(source, declarationOffset)) {
        const section = /^[ \t]*\/\/[ \t]?([A-Za-z][\w& ]*):/.exec(text);
        if (section) {
            inArguments = section[1] === "Arguments";
            current = [];
        }
        if (!inArguments) continue;
        const body = /^([ \t]*\/\/[ \t]{2,})(.*)$/.exec(text);
        if (!body) continue;

        const argument = /^(\$?[A-Za-z_]\w*(?:[ \t]*,[ \t]*\$?[A-Za-z_]\w*)*)[ \t]*=[ \t]*(.*)$/.exec(body[2]);
        if (argument) {
            current = Array.from(argument[1].matchAll(/\$?[A-Za-z_]\w*/g), name => ({
                name: name[0],
                offset: start + body[1].length + name.index,
                description: argument[2]
            }));
            entries.push(...current);
        } else if (body[2] === "---") {
            current = [];
        } else {
            for (const entry of current) {
                entry.description = [entry.description, body[2]].filter(Boolean).join("\n");
            }
        }
    }
    return entries;
}

module.exports = { precedingLineComments, readParameterDocs };
