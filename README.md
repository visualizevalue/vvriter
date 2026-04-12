# vvriter

MCP server that generates articles from 50,000 tweets and 400 visual artworks. One command. Three article concepts. Pick a number.

## Why

AI is writing articles about our ideas whether we participate or not. So we built the source material — 50,000 tweets, 400 visuals, and an exact [writing profile](https://github.com/visualizevalue/jackbutcher.md) — into a tool anyone can plug into their AI agent.

## Install

```bash
npx vvriter
```

### Claude Code

```bash
claude mcp add vvriter -- npx vvriter
```

### Claude Desktop / Cursor / Windsurf

Add to your MCP config:

```json
{
  "mcpServers": {
    "vvriter": {
      "command": "npx",
      "args": ["vvriter"]
    }
  }
}
```

## How it works

1. Call `vvriter` with no arguments
2. Pick from 3 article concepts
3. Article saves to `~/vvriter/` and opens in your browser

The tool loads a randomized sample of tweets and visuals. The AI finds idea clusters. Every call shuffles — you never get the same suggestions twice.

## How it was built

Full technical breakdown: [How to Build an MCP Server for AI-Powered Content Generation](https://visualizevalue.com/workflows/how-vvriter-works)

## Related

- [jackbutcher.md](https://github.com/visualizevalue/jackbutcher.md) — the writing profile that powers the voice
- [How the writing profile was made](https://visualizevalue.com/workflows/how-jackbutcher-md-was-made)

## About Visualize Value

Art, courses, and tools by [Jack Butcher](https://visualizevalue.com/about/jack-butcher). 5 courses, 168 lessons, 55,000+ students, 607 five-star reviews.

- [Courses](https://visualizevalue.com/learn) — leverage, value creation, building independently
- [Workflows](https://visualizevalue.com/workflows) — how things get built with AI
- [Art](https://visualizevalue.com/art) — Checks ($250M+), Opepen, Self Checkout
- [Visuals](https://visualizevalue.com/visuals) — 600+ visual artworks
- [The $99 MBA](https://visualizevalue.com/mba) — all 5 courses for $99/year

## License

MIT
