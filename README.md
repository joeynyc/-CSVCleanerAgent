<div align="center">

# CSV Cleaner Agent

**AI-powered CSV cleaning and validation for seamless data imports**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.2-black)](https://bun.sh)
[![Claude Agent SDK](https://img.shields.io/badge/Claude%20Agent%20SDK-0.1.76-orange)](https://platform.claude.com/docs/en/api/agent-sdk/overview)

[Features](#features) • [Quick Start](#quick-start) • [Demo](#demo) • [Architecture](#architecture)

</div>

---

## Overview

Transform messy, inconsistent CSV files into clean, import-ready data with the power of AI. CSV Cleaner Agent analyzes your data, detects quality issues, and provides intelligent recommendations for cleaning—all powered by Claude's Agent SDK.

Perfect for preparing data imports for **Shopify**, **QuickBooks**, **Business Central**, and more.

## Features

**Smart CSV Parsing** - Automatic header detection and data structure analysis

**Data Profiling** - Detect column types, null values, and anomalies

**AI-Powered Insights** - Intelligent cleaning recommendations based on your target platform

**Fast Processing** - Built on Bun for lightning-fast performance

**Custom MCP Tools** - Extensible tool architecture for specialized cleaning operations

### Upcoming Features

- Column mapping and header normalization
- Date format standardization
- Phone number formatting
- Deduplication
- Platform-specific schema validation (Shopify, QuickBooks, Business Central)
- Detailed cleaning reports
- Web interface for file upload and preview
- Saved cleaning presets

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.0+
- [Claude Code CLI](https://code.claude.com/docs/en/setup)
- [Anthropic API Key](https://console.anthropic.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/joeynyc/-CSVCleanerAgent.git
cd CSVCleanerAgent

# Install dependencies
bun install

# Set up your API key
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### Usage

**Interactive Mode:**
```bash
bun start
```

**Analyze a Specific File:**
```bash
bun start "Analyze sample.csv and suggest cleaning steps"
```

**Development Mode (Auto-reload):**
```bash
bun run dev
```

**Type Checking:**
```bash
bun run typecheck
```

## Demo

Try it with the included sample CSV that contains common data quality issues:

```bash
bun start "Profile the data in sample.csv and identify issues"
```

The agent will:
1. Parse the CSV structure
2. Analyze each column for data types and quality
3. Detect issues (missing values, format inconsistencies, duplicates)
4. Recommend cleaning strategies

**Sample Data Issues:**
- Missing names
- Inconsistent date formats (YYYY-MM-DD vs MM/DD/YYYY vs DD-MM-YYYY)
- Various phone number formats
- Inconsistent SKU casing
- Empty values in required fields

## Architecture

```
┌─────────────────────────────────────────────┐
│           Claude Agent SDK                  │
│  (Agent Loop + Context Management)          │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│          MCP Server (csv-cleaner)           │
│  ┌────────────────┐  ┌──────────────────┐  │
│  │  parse_csv     │  │  profile_data    │  │
│  │  - Headers     │  │  - Type detection│  │
│  │  - Row count   │  │  - Null analysis │  │
│  │  - Samples     │  │  - Anomalies     │  │
│  └────────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│         Your CSV Files                      │
└─────────────────────────────────────────────┘
```

### Tech Stack

- **[Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview)** - Autonomous agent framework
- **[Bun](https://bun.sh)** - Fast JavaScript runtime
- **[TypeScript](https://www.typescriptlang.org/)** - Type-safe development
- **[MCP](https://modelcontextprotocol.io/)** - Model Context Protocol for custom tools

## Project Structure

```
CSVCleanerAgent/
├── index.ts              # Main agent implementation
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment template
├── sample.csv            # Example data with quality issues
└── README.md             # You are here
```

## Contributing

Contributions are welcome! Here's how you can help:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Resources

- [Claude Agent SDK Documentation](https://platform.claude.com/docs/en/api/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/api/agent-sdk/typescript)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Bun Documentation](https://bun.sh/docs)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview) by Anthropic
- Powered by [Bun](https://bun.sh) runtime
- Inspired by the need for better data quality in business operations

---

<div align="center">

**Star this repo if you find it useful!**

Made with AI

</div>
