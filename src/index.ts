import * as dotenv from "dotenv"
import * as dotenvExpand from "dotenv-expand"
import { client } from "./client"

const env = dotenv.config()
dotenvExpand.expand(env)

client.login(process.env.DISCORD_TOKEN)
