# @imapps/biome-config

Shared Biome configuration for IM Apps projects.

## Installation

```bash
yarn add -D @imapps/biome-config @biomejs/biome
```

## Usage

Create a `biome.json` in your project root and extend one of the provided configurations:

### Monorepo Configuration (Recommended for multi-package repos)

```json
{
  "extends": ["@imapps/biome-config/monorepo"]
}
```

### React Application Configuration

```json
{
  "extends": ["@imapps/biome-config/react"]
}
```

### Node.js Application Configuration

```json
{
  "extends": ["@imapps/biome-config/node"]
}
```

### Base Configuration

```json
{
  "extends": ["@imapps/biome-config/base"]
}
```

## Available Configurations

- **base** - Base configuration with formatter and linter rules
- **monorepo** - Extends base with relaxed rules for test and config files
- **react** - Extends base with React and accessibility rules
- **node** - Extends base for Node.js applications

## Configuration Details

All configurations include:

- **Formatter**: 4-space indentation, single quotes for JS, double quotes for JSX, always semicolons
- **Linter**: Recommended rules enabled with additional custom rules
- **Line Width**: 120 characters
- **Import Organization**: Automatic import sorting enabled

## Overriding Rules

You can override any rules in your project's `biome.json`:

```json
{
  "extends": ["@imapps/biome-config/monorepo"],
  "linter": {
    "rules": {
      "suspicious": {
        "noExplicitAny": "error"
      }
    }
  }
}
```

## Running Biome

Add these scripts to your `package.json`:

```json
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --fix --unsafe .",
    "format": "biome format --write ."
  }
}
```

