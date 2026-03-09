import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
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
  // ─── ARTICLE GENERATION (main flow) ───────────────────────────

  server.tool(
    'suggest_article',
    `Generate article concepts from Jack Butcher's tweet archive and VV visuals. This is the core creative tool — it samples diverse tweets (top performers, mid-tier, deep cuts, and topic matches), pairs them with visual one-liners, and returns editorial context for you to suggest 3 article concepts. Each concept should include a title, angle, tweet selections, and visual pairings.`,
    {
      topic: z
        .string()
        .optional()
        .describe('Topic or direction for the article. Leave empty for "surprise me" — the tool will surface the most interesting clusters.'),
    },
    async ({ topic }) => {
      const tweets = loadTweets()
      const visuals = loadVisuals()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')

      // Build diverse tweet sample — same tiered approach as the admin flow
      const seen = new Set<string>()

      // Tier 1: Top 50 (proven, high-signal)
      const tier1 = tweets.slice(0, 50)
      tier1.forEach((t) => seen.add(t.id))

      // Tier 2: Random 75 from ranks 50–500 (solid, different each run)
      const tier2 = shuffleSample(tweets.slice(50, 500), 75)
      tier2.forEach((t) => seen.add(t.id))

      // Tier 3: Random 50 from ranks 500–2000 (hidden gems)
      const tier3 = shuffleSample(tweets.slice(500, 2000), 50)
      tier3.forEach((t) => seen.add(t.id))

      const candidateTweets = [...tier1, ...tier2, ...tier3]

      // Topic matches from full archive (beyond what's already included)
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
        .map((t, i) => `[${i}] "${t.text}" (${t.likes} likes)`)
        .join('\n')

      // Visuals with text captions (these ARE the visual — the caption is the idea)
      const visualsWithText = visuals.filter((v) => v.data.text).slice(0, 200)
      const visualList = visualsWithText
        .map((v, i) => `[${i}] "${v.data.text}" (tags: ${v.data.tags.join(', ')})`)
        .join('\n')

      const topicInstruction = topic
        ? `The user is interested in: "${topic}". Use this as a starting direction, but if you see a more interesting angle or connection, pursue it.`
        : `No specific topic given. Find the most interesting, surprising, or powerful idea clusters in the tweets.`

      const parts = [
        `# Article Suggestion Context`,
        '',
        `## Voice & Style`,
        profile,
        '',
        `## Direction`,
        topicInstruction,
        '',
        `## Tweet Archive (${candidateTweets.length} diverse samples — top performers, mid-tier, deep cuts${topic ? ', and topic matches' : ''})`,
        tweetList,
        '',
        `## Available Visuals (${visualsWithText.length} with captions — the caption IS the visual's core idea)`,
        visualList,
        '',
        `## Editorial Instructions`,
        `You're an editor for Visualize Value. Find compelling article ideas hidden in this tweet archive.`,
        '',
        `Think like an editor:`,
        `- Look for IDEAS that connect across tweets, not just keyword matches`,
        `- Find non-obvious relationships — tweets that weren't written together but build on the same underlying principle`,
        `- Prioritize standalone insights (not conversations or references to external links)`,
        `- The best articles weave 4-8 tweets into a narrative the author didn't explicitly write but clearly believes`,
        `- Don't default to highest-liked tweets — mix popular and lesser-known for fresh, non-obvious articles`,
        `- Match visuals whose one-liners reinforce the core argument`,
        '',
        `Suggest 3 article concepts, ranging from obvious to surprising. For each:`,
        `- A compelling, specific title (not generic — something you'd actually click)`,
        `- A one-sentence angle: what's the thesis, and why does it matter?`,
        `- Which tweet indices (4-8) build a narrative arc together, ordered for flow`,
        `- Which visual indices (2-4) reinforce the ideas — pick visuals whose captions directly support the argument`,
        `- 4-6 alternate visual indices as backups`,
        '',
        `Format each suggestion clearly with the tweet texts and visual captions included (not just indices) so the user can review and edit before generating.`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  server.tool(
    'generate_article',
    `Generate a full article from selected tweets and visuals. Takes a title, angle, selected tweets, and visuals — returns the writing context and instructions for you to ghostwrite the article in Jack Butcher's voice. The output should use {{TWEET_N}} and {{VISUAL_N}} markers for embedding.`,
    {
      title: z.string().describe('Article title'),
      angle: z.string().describe('One-sentence thesis / angle'),
      tweets: z
        .array(
          z.object({
            id: z.string(),
            text: z.string(),
            likes: z.number(),
          })
        )
        .describe('Selected tweets to weave into the article (4-8)'),
      visuals: z
        .array(
          z.object({
            id: z.string(),
            text: z.string(),
          })
        )
        .describe('Selected visuals to embed (2-4)'),
    },
    async ({ title, angle, tweets, visuals }) => {
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')

      const tweetBlock = tweets
        .map((t, i) => `[TWEET_${i + 1}] "${t.text}" (${t.likes.toLocaleString()} likes, id: ${t.id})`)
        .join('\n')

      const visualBlock = visuals
        .map((v, i) => `[VISUAL_${i + 1}] "${v.text}" (id: ${v.id})`)
        .join('\n')

      const parts = [
        `# Ghostwrite: "${title}"`,
        '',
        `## Voice & Style (match this exactly)`,
        profile,
        '',
        `## Article Details`,
        `**Title:** ${title}`,
        `**Angle:** ${angle}`,
        '',
        `## Tweets to weave in`,
        tweetBlock,
        '',
        `## Visuals to embed`,
        visualBlock,
        '',
        `## Writing Instructions`,
        `1. Match Jack's voice — short paragraphs, no fluff, no transition words, no hedging`,
        `2. Open with the idea, not a preamble`,
        `3. Embed tweets using {{TWEET_N}} markers — use at least 2-3, placed where they hit hardest`,
        `4. Place visuals using {{VISUAL_N}} markers — use to reinforce points, not decorate`,
        `5. End sharp — no summary paragraph`,
        `6. 500-1000 words`,
        `7. Title is already decided, just write the body`,
        '',
        `Write the article body as HTML (<p> tags, clean markup). Include the {{TWEET_N}} and {{VISUAL_N}} markers inline where they should appear.`,
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  // ─── TWEET DRAFTING ───────────────────────────────────────────

  server.tool(
    'draft_tweet',
    'Get context for drafting a tweet in the VV voice. Returns the writing profile rules, top-performing tweets on the topic, and structural patterns to follow.',
    {
      topic: z.string().describe('The topic or idea to tweet about'),
      style: z
        .enum(['observation', 'contrast', 'reframe', 'list', 'question', 'one-liner'])
        .optional()
        .describe('Preferred rhetorical style (optional)'),
    },
    async ({ topic, style }) => {
      const tweets = loadTweets()
      const profile = readFileSync(join(dataDir, 'writing-profile.md'), 'utf-8')

      const q = topic.toLowerCase()
      const topicTweets = tweets
        .filter((t) => t.text.toLowerCase().includes(q) && t.likes >= 50)
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 10)

      const topPerformers = [...tweets]
        .sort((a, b) => b.likes - a.likes)
        .slice(0, 15)

      const parts = [
        `# Draft context for: "${topic}"`,
        style ? `Requested style: ${style}` : null,
        '',
        '## Writing rules (follow these exactly)',
        profile,
        '',
        topicTweets.length > 0
          ? `## Top tweets on "${topic}" (${topicTweets.length} found)\n\n${topicTweets.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`
          : `## No existing tweets found on "${topic}" — use the top performers below for structural reference`,
        '',
        `## Top 15 performers (structural reference)\n\n${topPerformers.map((t) => `"${t.text}" (${t.likes.toLocaleString()} likes)`).join('\n\n')}`,
        '',
        '## Instructions',
        'Using the writing profile rules and reference tweets above, draft 5 tweet options.',
        'Each should be under 15 words. No hedging. No em dashes. Land on a noun.',
        'Vary the rhetorical pattern across the 5 options (contrast, reframe, paradox, conditional, declaration).',
      ]
        .filter((p) => p !== null)
        .join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )

  // ─── FRAMEWORK APPLICATION ────────────────────────────────────

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
        'Walk through each stage/step of the framework above and explain where this situation currently sits.',
        'Identify the specific next move. Be concrete and actionable.',
        'Use the VV voice: direct, declarative, no hedging. Short paragraphs.',
      ].join('\n')

      return { content: [{ type: 'text' as const, text: prompt }] }
    }
  )

  // ─── VISUAL SUGGESTION ────────────────────────────────────────

  server.tool(
    'suggest_visual',
    'Given a concept or quote, find related VV visuals and suggest a visual approach. Uses local visual index for instant results.',
    {
      concept: z.string().describe('The concept, quote, or idea to visualize'),
    },
    async ({ concept }) => {
      const visuals = loadVisuals()
      let descriptions: Record<string, string> = {}
      try {
        const raw = readFileSync(join(dataDir, 'visual-descriptions.json'), 'utf-8')
        descriptions = JSON.parse(raw)
      } catch {}

      const q = concept.toLowerCase()
      const matches = visuals
        .filter((v) => {
          const text = v.data.text?.toLowerCase() ?? ''
          const tags = v.data.tags?.join(' ').toLowerCase() ?? ''
          const desc = descriptions[v.id]?.toLowerCase() ?? ''
          return text.includes(q) || tags.includes(q) || desc.includes(q)
        })
        .slice(0, 5)

      const formatted = matches.map((v) => {
        const desc = descriptions[v.id] || null
        return [
          v.data.text ? `"${v.data.text}"` : '(no text)',
          desc ? `Context: ${desc}` : null,
          `Image: ${imageUrl(v.data.image)}`,
          v.data.tags?.length ? `Tags: ${v.data.tags.join(', ')}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      })

      const parts = [
        `# Visual suggestions for: "${concept}"`,
        '',
        matches.length > 0
          ? `## ${matches.length} related visuals found\n\n${formatted.join('\n\n---\n\n')}`
          : '## No direct matches found',
        '',
        '## Approach suggestions',
        'Based on the VV visual style (black and white, minimal, typographic, symbolic):',
        '- What contrast or tension exists in this concept?',
        '- Can it be reduced to two opposing words or images?',
        '- What is the simplest possible visual representation?',
      ].join('\n')

      return { content: [{ type: 'text' as const, text: parts }] }
    }
  )
}
