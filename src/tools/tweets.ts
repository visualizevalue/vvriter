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

let tweetsCache: Tweet[] | null = null

function loadTweets(): Tweet[] {
  if (tweetsCache) return tweetsCache
  const raw = readFileSync(join(dataDir, 'tweet-index.json'), 'utf-8')
  tweetsCache = JSON.parse(raw)
  return tweetsCache!
}

// Topic synonyms for broader matching
const TOPIC_SYNONYMS: Record<string, string[]> = {
  leverage: ['leverage', 'compound', 'scale', 'multiply', 'systems', 'automation', 'sleep'],
  simplicity: ['simple', 'simplicity', 'clarity', 'complex', 'complexity', 'reduce', 'subtract', 'minimal'],
  action: ['start', 'ship', 'build', 'do', 'practice', 'iterate', 'try', 'begin'],
  consistency: ['consistent', 'daily', 'show up', 'every day', 'keep going', 'routine', 'habit'],
  ownership: ['own', 'ownership', 'equity', 'rent', 'build', 'asset'],
  time: ['time', 'hours', 'freedom', 'sleep', 'morning', 'patience', 'long game'],
  focus: ['focus', 'distract', 'attention', 'narrow', 'concentrate', 'noise'],
  value: ['value', 'price', 'worth', 'money', 'customer', 'sell', 'pay'],
  creativity: ['creative', 'create', 'art', 'design', 'idea', 'imagination', 'produce'],
  failure: ['fail', 'failure', 'mistake', 'risk', 'scared', 'fear', 'wrong'],
}

function expandQuery(query: string): string[] {
  const q = query.toLowerCase()
  const terms = [q]

  for (const [topic, synonyms] of Object.entries(TOPIC_SYNONYMS)) {
    if (q.includes(topic) || synonyms.some((s) => q.includes(s))) {
      terms.push(...synonyms)
    }
  }

  return [...new Set(terms)]
}

export function registerTweetTools(server: McpServer) {
  server.tool(
    'search_tweets',
    "Search Jack Butcher's tweet archive by keyword. Returns matching tweets sorted by likes. Use this to find specific tweets for reference — for creating content, use draft_tweet or suggest_article instead.",
    {
      query: z.string().describe('Search term to match against tweet text'),
      min_likes: z.number().optional().describe('Minimum likes threshold (default: 0)'),
      limit: z.number().optional().describe('Max results to return (default: 20)'),
    },
    async ({ query, min_likes = 0, limit = 20 }) => {
      const tweets = loadTweets()
      const terms = expandQuery(query)

      const matches = tweets
        .filter((t) => {
          const text = t.text.toLowerCase()
          return terms.some((term) => text.includes(term)) && t.likes >= min_likes
        })
        .sort((a, b) => b.likes - a.likes)
        .slice(0, limit)

      if (matches.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `No tweets found matching "${query}" with ${min_likes}+ likes.` }],
        }
      }

      const formatted = matches
        .map((t) => `"${t.text}"\n  ${t.likes.toLocaleString()} likes (${t.date}, id:${t.id})`)
        .join('\n\n')

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${matches.length} tweets matching "${query}":\n\n${formatted}`,
          },
        ],
      }
    }
  )

  server.tool(
    'top_tweets',
    "Get Jack Butcher's top-performing tweets by likes.",
    {
      limit: z.number().optional().describe('Number of tweets to return (default: 25)'),
    },
    async ({ limit = 25 }) => {
      const tweets = loadTweets()
      const top = [...tweets].sort((a, b) => b.likes - a.likes).slice(0, limit)

      const formatted = top
        .map(
          (t, i) =>
            `${i + 1}. "${t.text}"\n   ${t.likes.toLocaleString()} likes (id:${t.id})`
        )
        .join('\n\n')

      return {
        content: [{ type: 'text' as const, text: `Top ${limit} tweets:\n\n${formatted}` }],
      }
    }
  )
}
