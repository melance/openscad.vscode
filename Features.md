# OpenSCAD language extension for VS Code

Minimum supported OpenSCAD release: **2021.01**. Checked items are implemented. Editor verification is called out separately where pending.

## Syntax and editing

- [x] Register .scad files and highlight comments, strings, numbers, constants, operators, punctuation and import paths.
- [x] Distinguish declarations, anonymous functions, built-in calls, generic calls, ordinary variables, special variables and built-in special variables.
- [x] Highlight the # geometry debug modifier.
- [x] Distinguish the remaining geometry modifiers from arithmetic and logical operators in context.
- [x] Configure comment toggling, bracket matching and automatic bracket closing.
- [x] Fold multiline curly-brace blocks.
- [x] Verify multiline folding in the editor.
- [x] Complete built-ins, user-defined functions and modules, visible variables and named parameters.
- [x] Hide underscore-prefixed names from imported files in autocomplete.
- [x] Show separate autocomplete entries for functions and modules that share a name.
- [x] Show the source filename for autocomplete suggestions.
- [x] Verify autocomplete and source filenames in the Extension Development Host.
- [x] Show signature help with defaults, argument documentation and the active positional or named parameter, including nested expressions.
- [x] Verify signature help in the Extension Development Host.

## Hover and navigation

- [x] Show signatures and BOSL2 descriptions for uniquely named function and module calls in the current file.
- [x] Jump from a call to the declaration name with F12 in the current file.
- [x] Support call hover and F12 across direct relative use and include directives.
- [x] Show a target file's BOSL2 LibFile header when hovering over a relative use or include path.
- [x] Verify the LibFile popup in the Extension Development Host against the repository version.
- [x] Open the target file with F12 on a relative import path.
- [x] Verify F12 on a relative import path in the Extension Development Host.
- [x] Follow nested include directives when resolving call hover and F12.
- [x] Resolve BOSL2 names such as cuboid that have both a module and a function declaration, using the call context.
- [x] Resolve lexical scope and the visibility rules of use and include across language providers.
- [x] Verify scoped declarations and use/include visibility in the Extension Development Host.
- [x] Share path resolution across hover and F12 for absolute paths and OpenSCAD library locations. Search the importing file's directory, OPENSCADPATH, the user library and the installation library in that order.
- [x] Verify hover and F12 for absolute paths and installed libraries in the Extension Development Host.
- [x] Allow configuring the OpenSCAD executable path to locate its installation libraries.
- [x] Find references and rename symbols across files, including named arguments and parameter documentation.
- [x] Restrict Rename Symbol to project files and relative imports.
- [x] Verify the relative-path rename restriction in the editor.
- [x] Verify Find References and Rename Symbol in the Extension Development Host.
- [x] List declarations in the document outline.
- [x] Verify the document outline in the Extension Development Host.
- [x] Show live diagnostics for missing statement terminators, mismatched delimiters, unterminated strings or comments, and malformed or unresolved imports.
- [x] Verify live diagnostics in the Extension Development Host, including missing statement terminators.

## Regions and documentation

- [x] Fold named, nested regions using spaced or compact comment markers.
- [x] Color entire region marker lines using the packaged openscad.regionForeground color.
- [x] Recognize BOSL2 Function, Module, Function&Module, Description, Arguments, Usage and Example headings in ordinary line comments.
- [x] Toggle BOSL2 documentation highlighting with `openscad.bosl2.highlighting.enabled`, enabled by default.
- [x] Highlight Customizer group headers such as `/* [Hidden] */` and inline bracketed settings such as `value = 10; // [0-10]`.
- [x] Style documentation titles and bodies separately, including indented continuation lines, using the packaged openscad.documentationBodyForeground color.
- [x] Associate matching BOSL2 declaration comments with function and module descriptions for hover.
- [x] Parse individual argument documentation for use in signature help.
- [x] Generate a BOSL2-style documentation skeleton from a declaration and its parameters.
- [x] Verify documentation skeleton generation in the Extension Development Host.

## Settings and compatibility

- [x] Expose extension preferences in VS Code Settings and settings.json with workspace overrides.
- [x] Provide openscad.regions.enabled, enabled by default. Apply folding and coloring changes without reloading.
- [x] Select OpenSCAD 2021.01 or Nightly per user or workspace and apply the target catalog to highlighting, completion, hover, and signature help.
- [x] Catalog newer Nightly built-ins and signature changes, with an opt-in for experimental roof().
- [x] Store built-in definitions and version differences in an editable JSON catalog.
- [x] Verify target switching and experimental built-ins in the Extension Development Host.
- [x] Provide settings for the OpenSCAD executable, user library directory, and installation library directory.
- [x] Configure extra library search folders beyond `OPENSCADPATH` with `openscad.extraLibraryPaths`.

## Preview

- [x] Preview the active .scad file with F5. On Windows, reuse a running OpenSCAD instance, prefer the window showing the file, and reload that preview on later presses.
- [x] Verify F5 opens and previews a file in an existing OpenSCAD window and reuses it on repeat presses.
- [x] Verify F5 launch when OpenSCAD is closed and reload after a file edit in the Windows Extension Development Host.

