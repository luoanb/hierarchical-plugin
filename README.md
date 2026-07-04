# @openclaw/hierarchical

> OpenClaw hierarchical agent plugin — inherited prompts (PLS) and node-type tool isolation (NTS).

## Features

- **PLS (Prompt Layering System)**: Hierarchical prompt inheritance from root to child agents
- **NTS (Node-Type Tool Isolation)**: Tool allow/deny lists per node type in the hierarchy
- **Subagent spawning**: Automatic session context alignment for spawned child agents

## Installation

```bash
openclaw plugins install hierarchical
```

Or via npm:

```bash
npm install @openclaw/hierarchical
```

## Usage

Enable the plugin in your OpenClaw config:

```json
{
  "plugins": {
    "enabled": true,
    "entries": {
      "hierarchical": {
        "enabled": true
      }
    }
  }
}
```

Create a `hierarchical/` directory in your workspace with the following structure:

```
workspace/
├── hierarchical/
│   ├── prompt/
│   │   ├── 10-core.md
│   │   └── 20-rules.md
│   └── children/
│       ├── architect/
│       │   ├── hierarchical/
│       │   │   ├── prompt/
│       │   │   │   └── 25-agents.md
│       │   │   └── children/
│       │   │       └── ...
│       │   └── ...
│       └── ...
```

## Development

```bash
git clone https://github.com/openclaw/hierarchical-plugin.git
cd hierarchical-plugin
npm install
npm run build
npm test
```

## License

MIT