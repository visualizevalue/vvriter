import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerGenerateTools } from './generate.js'
import { registerVoiceTool } from './voice.js'
import { registerFrameworkTools } from './frameworks.js'
import { registerTweetTools } from './tweets.js'
import { registerVisualTools } from './visuals.js'
import { registerCourseTools } from './courses.js'
import { registerProjectTools } from './projects.js'

export function registerTools(server: McpServer) {
  // Creation tools first — this is the product
  registerGenerateTools(server)

  // Reference tools — supporting context
  registerVoiceTool(server)
  registerFrameworkTools(server)
  registerTweetTools(server)
  registerVisualTools(server)
  registerCourseTools(server)
  registerProjectTools(server)
}
