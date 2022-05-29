import { z } from "zod"
import { readFileSync } from "node:fs"

const channelSchema = z.object({
  id: z.string(),
  anonymous: z.boolean().default(true),
})
const schema = z.object({
  dmChannel: channelSchema,
  proxyChannels: z.array(z.array(channelSchema).length(2)),
  admins: z.array(z.string()).default([]),
})

const raw = readFileSync(process.env.CONFIG_FILE ?? "config.json", "utf8")
const config = schema.parse(JSON.parse(raw))

export { config }
