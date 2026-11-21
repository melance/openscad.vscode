// Each group's items are at its own delimiter depth. Nested groups occupy one item.
function parseGroups(code) {
    const root = { start: -1, end: code.length, items: [] };
    const stack = [root];
    const groups = [root];
    const closing = { "(": ")", "[": "]", "{": "}" };
    for (const match of code.matchAll(/\$?[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|==|!=|<=|>=|[^\s]/g)) {
        const value = match[0];
        const scope = stack[stack.length - 1];
        if (value === scope.close) {
            scope.end = match.index;
            stack.pop();
        } else {
            const token = { value, start: match.index };
            if (closing[value]) {
                Object.assign(token, { close: closing[value], end: code.length, items: [], parent: scope });
                token.previous = scope.items[scope.items.length - 1];
                stack.push(token);
                groups.push(token);
            }
            scope.items.push(token);
        }
    }
    return groups;
}

module.exports = { parseGroups };
