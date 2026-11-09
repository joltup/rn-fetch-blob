// Used by ESLint's @babel/eslint-parser so it can parse the Flow-annotated
// sources. Not consumed by apps that install this package - Babel resolves a
// root config from the app, not from a dependency.
//
// Babel's own Flow syntax, not @react-native/babel-preset: the preset parses a
// file marked @flow with hermes-parser, whose tokens @babel/eslint-parser cannot
// convert ("Cannot read properties of undefined (reading 'forEach')" on any file
// with a template literal). That apps' builds can parse every file through
// hermes-parser is checked in tests/unit/flowPragma.test.js instead.
module.exports = {
    plugins: ['@babel/plugin-syntax-flow'],
};
