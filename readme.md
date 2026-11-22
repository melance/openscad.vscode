# OpenSCAD Language Extension for VSCode
I work almost exclusively in OpenSCAD for developing 3-D objects and wanted a fully featured language extension for VSCode. There is an existing extension, [vscode-openscad](https://github.com/Antyos/vscode-openscad) but I wanted to add a lot of new features and also wanted to learn more about building VSCode extensions so I created my own from the ground up.

## Features

- **OpenSCAD editing** — Syntax highlighting for `.scad` files, including geometry modifiers, special variables, and Customizer annotations. Includes comment toggling, bracket matching, and automatic bracket closing.
- **Autocomplete and signature help** — Complete built-ins, user-defined functions and modules, in-scope variables, and named arguments. See parameter defaults, argument documentation, and the active parameter as you type.
- **Hover documentation** — See signatures and built-in descriptions, read Markdown from BOSL2 documentation comments, and view library headers by hovering over `use` and `include` paths.
- **Code navigation and refactoring** — Jump to definitions and imported files with `F12`, browse declarations in the Outline, find references across files, and rename project symbols, including named arguments and their documentation.
- **Live diagnostics** — Catch missing semicolons, mismatched delimiters, unterminated strings or comments, and malformed or unresolved imports.
- **Code folding** — Collapse curly-brace blocks, including modules with multiline declarations, and create named, nested regions with `// #region` and `// #endregion`.
- **BOSL2 documentation tools** — Highlight documentation sections formatted like those in the BOSL2 library, generate comment templates from function and module declarations, and continue documentation comments automatically with Enter. These comments support markdown.
- **Configurable OpenSCAD support** — Target OpenSCAD 2021.01 or Nightly, opt in to experimental built-ins such as `roof()`, and configure the executable and library search paths per workspace.
- **Preview with `F5`** — Open the active file in OpenSCAD. On Windows, reuse an existing OpenSCAD window and reload the preview on subsequent presses.  
  Requires OpenSCAD to be installed.
- **Custom OpenSCAD paths** — Uses the default executable and library locations, however you can configure the OpenSCAD executable, user and installation library directories, and additional search folders for use and include imports in VS Code Settings. These paths can be set per workspace.