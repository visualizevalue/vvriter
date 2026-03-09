import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { dataDir } from '../paths.js'

type Tweet = {
  id: string
  text: string
  date: string
  likes: number
  rts: number
}

type Visual = {
  id: string
  schema: string
  data: {
    text: string | null
    source: string | null
    image: { id: string; cdn: string; path: string; type: string }
    tags: string[]
  }
  publishedAt: string
}

let tweetsCache: Tweet[] | null = null
let visualsCache: Visual[] | null = null

function loadTweets(): Tweet[] {
  if (tweetsCache) return tweetsCache
  const raw = readFileSync(join(dataDir, 'tweet-index.json'), 'utf-8')
  tweetsCache = JSON.parse(raw)
  return tweetsCache!
}

function loadVisuals(): Visual[] {
  if (visualsCache) return visualsCache
  const raw = readFileSync(join(dataDir, 'visual-index.json'), 'utf-8')
  visualsCache = JSON.parse(raw)
  return visualsCache!
}

function loadDescriptions(): Record<string, string> {
  try {
    const raw = readFileSync(join(dataDir, 'visual-descriptions.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function imageUrl(img: { id: string; cdn: string; path: string; type: string }): string {
  return `https://${img.cdn}.cdn.vv.xyz/${img.path}/${img.id}.${img.type}`
}

/** Pick `n` random items from an array (Fisher-Yates on a copy) */
function shuffleSample<T>(arr: T[], n: number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

export function registerGenerateTools(server: McpServer) {
  // ─────────────────────────────────────────────────────────────
  // ARTICLE CREATION
  //
  // Two-step flow:
  //   1. suggest_article() — loads raw material, AI finds the stories
  //   2. generate_article() — AI writes the article
  //
  // No topic required. The archive surfaces the ideas.
  // Every call shuffles the sample so it's never the same twice.
  // ─────────────────────────────────────────────────────────────

  server.tool(
    'suggest_article',
    `Create article ideas on the fly. No input needed — call this and get back a randomized sample of Jack Butcher's tweet archive and VV visuals. The AI reads through the raw material, finds the interesting idea clusters, and proposes article concepts. Every call shuffles the sample so you always get fresh combinations. Optionally pass a topic to bias the mix.`,
    {
      topic: z
        .string()
        .optional()
        .describe('Optional direction to bias the sample. Usually omitted — the tool surfaces ideas you didn\'t know to look for.'),
    },
    async ({ topic }) => {
      const tweets = loadTweets()
      const visuals = loadVisuals()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')
      const descriptions = loadDescriptions()

      // Randomized tiered sample — different every call
      const seen = new Set<string>()

      const tier1 = tweets.slice(0, 50)
      tier1.forEach((t) => seen.add(t.id))

      const tier2 = shuffleSample(tweets.slice(50, 500), 75)
      tier2.forEach((t) => seen.add(t.id))

      const tier3 = shuffleSample(tweets.slice(500, 2000), 50)
      tier3.forEach((t) => seen.add(t.id))

      const candidateTweets = [...tier1, ...tier2, ...tier3]

      if (topic) {
        const terms = topic.toLowerCase().split(/\s+/)
        const topicMatches = tweets
          .filter((t) => {
            if (seen.has(t.id)) return false
            const lower = t.text.toLowerCase()
            return terms.some((term) => lower.includes(term))
          })
          .slice(0, 75)
        topicMatches.forEach((t) => {
          seen.add(t.id)
          candidateTweets.push(t)
        })
      }

      const tweetList = candidateTweets
        .map((t, i) => `[T${i}] "${t.text}" — ${t.likes} likes (id:${t.id})`)
        .join('\n')

      const visualsWithText = visuals.filter((v) => v.data.text)
      const sampledVisuals = shuffleSample(visualsWithText, Math.min(150, visualsWithText.length))
      const visualList = sampledVisuals
        .map((v, i) => {
          const desc = descriptions[v.id]
          const parts = [`[V${i}] "${v.data.text}"`]
          if (desc) parts.push(`  Context: ${desc}`)
          if (v.data.tags.length) parts.push(`  Tags: ${v.data.tags.join(', ')}`)
          parts.push(`  Image: ${imageUrl(v.data.image)}`)
          parts.push(`  ID: ${v.id}`)
          return parts.join('\n')
        })
        .join('\n')

      const parts = [
        `# Raw Material`,
        '',
        `## Voice`,
        profile,
        '',
        `## Tweets — ${candidateTweets.length} samples`,
        `Top 50 proven performers + 75 random mid-tier + 50 random deep cuts${topic ? ` + topic matches for "${topic}"` : ''}. Different every call.`,
        '',
        tweetList,
        '',
        `## Visuals — ${sampledVisuals.length} illustrations`,
        `Black-and-white minimalist illustrations. The caption IS the idea. Random sample.`,
        '',
        visualList,
        '',
        `## Create`,
        `Find the stories hiding in here. Connect tweets that weren't written together but share an underlying principle. Match them with visuals whose captions reinforce the argument.`,
        ``,
        `Create exactly 3 article concepts. Range from obvious to surprising.`,
        ``,
        `## IMPORTANT: How to present to the user`,
        ``,
        `Present the 3 options as a numbered list the user can pick from. For each:`,
        `- **Number and title** (e.g. "1. The Long Game Is the Only Game")`,
        `- **Angle** — one sentence`,
        `- A brief preview (2-3 sentences about what the article would cover)`,
        ``,
        `Keep it scannable. Don't dump the full tweet lists — just the title, angle, and preview.`,
        ``,
        `Internally, track the tweet IDs and visual IDs for each option so that when the user picks one (e.g. "2"), you can immediately call generate_article with the right IDs — no further input needed.`,
        ``,
        `After the user picks, call generate_article → then publish_draft → then open the file in the browser. The whole flow should be: pick a number → article appears in browser.`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  server.tool(
    'generate_article',
    `Write an article from selected tweets and visuals. Pass the title, angle, and IDs from suggest_article. Returns full ghostwriting context. Write tweets inline as blockquotes and visuals as images — no placeholders.`,
    {
      title: z.string().describe('Article title'),
      angle: z.string().describe('One-sentence thesis'),
      tweet_ids: z.array(z.string()).describe('Tweet IDs from suggest_article'),
      visual_ids: z.array(z.string()).describe('Visual IDs from suggest_article'),
    },
    async ({ title, angle, tweet_ids, visual_ids }) => {
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')
      const allTweets = loadTweets()
      const allVisuals = loadVisuals()
      const descriptions = loadDescriptions()

      const tweetMap = new Map(allTweets.map((t) => [t.id, t]))
      const visualMap = new Map(allVisuals.map((v) => [v.id, v]))

      const selectedTweets = tweet_ids.map((id) => tweetMap.get(id)).filter(Boolean) as Tweet[]
      const selectedVisuals = visual_ids.map((id) => visualMap.get(id)).filter(Boolean) as Visual[]

      const tweetBlock = selectedTweets
        .map((t, i) => {
          const embedHtml = `<blockquote class="twitter-tweet" data-conversation="none"><p>${t.text}</p>&mdash; <a href="https://x.com/jackbutcher/status/${t.id}">@jackbutcher</a></blockquote>`
          return `[TWEET_${i + 1}] "${t.text}" (${t.likes.toLocaleString()} likes)\nEmbed HTML: ${embedHtml}`
        })
        .join('\n\n')

      const visualBlock = selectedVisuals
        .map((v, i) => {
          const desc = descriptions[v.id]
          const url = imageUrl(v.data.image)
          const figureHtml = `<figure><img src="${url}" alt="${(v.data.text || '').replace(/"/g, '&quot;')}" />${v.data.text ? `<figcaption>${v.data.text}</figcaption>` : ''}</figure>`
          return [
            `[VISUAL_${i + 1}] "${v.data.text || '(no text)'}"`,
            desc ? `  Context: ${desc}` : null,
            `  Figure HTML: ${figureHtml}`,
          ].filter(Boolean).join('\n')
        })
        .join('\n\n')

      const parts = [
        `# Write: "${title}"`,
        '',
        `## Voice (match exactly)`,
        profile,
        '',
        `**Title:** ${title}`,
        `**Angle:** ${angle}`,
        '',
        `## Tweets (use the embed HTML inline in the article)`,
        tweetBlock,
        '',
        `## Visuals (use the figure HTML inline in the article)`,
        visualBlock,
        '',
        `## Instructions`,
        `- Short paragraphs, no fluff, no transition words, no hedging`,
        `- Open with the idea, not a preamble`,
        `- Place tweet embeds inline using the provided blockquote HTML — where they hit hardest`,
        `- Place visual figures inline using the provided figure HTML — reinforce points, don't decorate`,
        `- Do NOT use placeholder markers like {{TWEET_N}} — write the actual embed HTML directly in the article`,
        `- End sharp — no summary`,
        `- 500-1000 words, HTML (<p> tags)`,
        `- Include <script async src="https://platform.twitter.com/widgets.js"></script> at the end`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  // ─────────────────────────────────────────────────────────────
  // PUBLISH DRAFT
  //
  // Saves the article as a standalone HTML file and tells
  // the AI to open it in the browser for preview.
  // ─────────────────────────────────────────────────────────────

  server.tool(
    'publish_draft',
    `Save a generated article as a styled HTML file and open it in the browser. Call this after generate_article — pass the title and the HTML body you wrote. Saves to ~/ghostvvriter/ and returns the file path. Then open the file in the browser with: open <filepath>`,
    {
      title: z.string().describe('Article title'),
      body_html: z.string().describe('The article body HTML you wrote (with embedded tweets and visuals)'),
    },
    async ({ title, body_html }) => {
      const outDir = join(homedir(), 'ghostvvriter')
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')

      const filename = `${slug}.html`
      const filepath = join(outDir, filename)

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      max-width: 680px;
      margin: 0 auto;
      padding: 48px 24px 96px;
      line-height: 1.7;
      color: #111;
      background: #fff;
    }
    h1 {
      font-size: 32px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.2;
      margin-bottom: 48px;
    }
    p { margin-bottom: 24px; font-size: 17px; }
    figure {
      margin: 40px 0;
    }
    figure img {
      width: 100%;
      display: block;
      border-radius: 4px;
    }
    figcaption {
      margin-top: 8px;
      font-size: 14px;
      color: #666;
    }
    blockquote.twitter-tweet {
      border-left: 3px solid #ddd;
      padding: 16px 20px;
      margin: 32px 0;
      font-size: 16px;
      color: #333;
    }
    blockquote.twitter-tweet p { margin-bottom: 8px; }
    blockquote.twitter-tweet a { color: #666; font-size: 14px; text-decoration: none; }
    a { color: #111; }
    @media (prefers-color-scheme: dark) {
      body { background: #111; color: #eee; }
      blockquote.twitter-tweet { border-color: #333; color: #ccc; }
      blockquote.twitter-tweet a { color: #888; }
      figcaption { color: #888; }
    }
  </style>
</head>
<body>
  <h1>${title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>
  ${body_html}
  <footer style="margin-top:64px;padding-top:32px;border-top:1px solid #ddd;font-size:14px;color:#666;">
    Written by <a href="https://visualizevalue.com" style="color:inherit;text-decoration:underline;">Visualize Value</a>
  </footer>
  <script async src="https://platform.twitter.com/widgets.js"></script>
</body>
</html>`

      writeFileSync(filepath, html, 'utf-8')

      return {
        content: [
          {
            type: 'text' as const,
            text: `Article saved to: ${filepath}\n\nOpen it in the browser to preview:\n\nopen ${filepath}`,
          },
        ],
      }
    }
  )

  // ─────────────────────────────────────────────────────────────
  // TWEET CREATION
  // ─────────────────────────────────────────────────────────────

  server.tool(
    'draft_tweet',
    `Draft tweets in the VV voice. No input needed — call this and get back the writing profile, reference tweets, and instructions. Pass a topic to focus the drafts, or leave empty to riff on whatever the top performers suggest.`,
    {
      topic: z.string().optional().describe('Optional topic or idea. Leave empty to riff freely.'),
      style: z
        .enum(['observation', 'contrast', 'reframe', 'list', 'question', 'one-liner'])
        .optional()
        .describe('Optional rhetorical style'),
    },
    async ({ topic, style }) => {
      const tweets = loadTweets()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')

      let topicTweets: Tweet[] = []
      if (topic) {
        const q = topic.toLowerCase()
        topicTweets = tweets
          .filter((t) => t.text.toLowerCase().includes(q) && t.likes >= 50)
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 10)
      }

      // Random mix of top performers — different every call
      const topPerformers = shuffleSample(tweets.slice(0, 100), 15)

      const parts = [
        topic ? `# Drafts for: "${topic}"` : `# Tweet Drafts`,
        style ? `Style: ${style}` : null,
        '',
        '## Voice (follow exactly)',
        profile,
        '',
        topicTweets.length > 0
          ? `## Reference tweets on "${topic}"\n\n${topicTweets.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`
          : null,
        '',
        `## Top performers (structural reference)\n\n${topPerformers.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`,
        '',
        '## Create',
        'Draft 5 tweets. Under 15 words each. No hedging. No em dashes. Land on a noun.',
        'Vary the pattern: contrast, reframe, paradox, conditional, declaration.',
      ]
        .filter((p) => p !== null)
        .join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  // ─────────────────────────────────────────────────────────────
  // VISUAL IDEAS
  // ─────────────────────────────────────────────────────────────

  server.tool(
    'visual_ideas',
    `Generate concepts for new VV-style visuals. Returns a random sample of existing visuals as reference alongside the writing profile, so the AI can propose new illustration concepts (one-liner + visual description). No input needed.`,
    {
      theme: z.string().optional().describe('Optional theme or direction. Leave empty for open exploration.'),
    },
    async ({ theme }) => {
      const visuals = loadVisuals()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')
      const descriptions = loadDescriptions()

      // Random sample of existing visuals as reference
      const visualsWithText = visuals.filter((v) => v.data.text)
      const sample = shuffleSample(visualsWithText, 30)

      const visualRef = sample
        .map((v) => {
          const desc = descriptions[v.id]
          return `"${v.data.text}"${desc ? ` — ${desc}` : ''}`
        })
        .join('\n')

      const parts = [
        theme ? `# Visual Ideas: "${theme}"` : `# Visual Ideas`,
        '',
        `## VV Visual Style`,
        `Black and white. Minimal. Typographic or symbolic. One idea per image. The text caption IS the visual — it communicates the core concept the illustration makes tangible.`,
        '',
        `## Voice`,
        profile,
        '',
        `## Reference Visuals (${sample.length} random samples)`,
        visualRef,
        '',
        `## Create`,
        `Generate 8 new visual concepts. For each:`,
        `1. **One-liner** — the text that appears on/with the visual (under 15 words)`,
        `2. **Visual description** — how to illustrate it (what the image shows, the contrast or metaphor it uses)`,
        ``,
        `The best VV visuals take an abstract idea and make it concrete through a simple visual metaphor. Think: subtraction, contrast, before/after, part/whole.`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  // ─────────────────────────────────────────────────────────────
  // FRAMEWORK APPLICATION
  // ─────────────────────────────────────────────────────────────

  server.tool(
    'apply_framework',
    'Apply a VV framework to a specific situation. Returns the framework and instructions for walking through the application.',
    {
      framework: z
        .enum([
          'productization-spectrum',
          'shuhari',
          'time-ladder',
          'train',
          'permissionless-apprentice',
          'proof-price-loop',
        ])
        .describe('Which framework to apply'),
      situation: z.string().describe('The situation, business, or problem to apply it to'),
    },
    async ({ framework, situation }) => {
      const content = readFileSync(join(dataDir, 'frameworks', `${framework}.md`), 'utf-8')

      const prompt = [
        `# Apply: ${framework}`,
        '',
        '## The Framework',
        content,
        '',
        '## The Situation',
        situation,
        '',
        '## Instructions',
        'Walk through each stage/step of the framework and explain where this situation currently sits.',
        'Identify the specific next move. Be concrete and actionable.',
        'Use the VV voice: direct, declarative, no hedging. Short paragraphs.',
      ].join('\n')

      return { content: [{ type: 'text' as const, text: prompt }] }
    }
  )
}
