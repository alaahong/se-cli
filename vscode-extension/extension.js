/**
 * se-cli MCP Server extension for VS Code.
 *
 * This extension registers se-cli as an MCP server via `contributes.mcpServers`
 * in package.json. VS Code launches the MCP server process (npx @browsers-cli/se-cli mcp-server)
 * automatically — no activation logic is needed.
 *
 * The extension entry point exists only to satisfy the VS Code extension manifest
 * requirement. All functionality is provided by the MCP server process.
 */

function activate() {
  // MCP server is launched by VS Code via `contributes.mcpServers`.
  // No activation logic needed.
}

function deactivate() {
  // MCP server lifecycle is managed by VS Code.
}

module.exports = { activate, deactivate };
