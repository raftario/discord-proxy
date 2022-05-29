import { Client, Intents, MessageEmbed } from "discord.js"
import { PrismaClientKnownRequestError } from "@prisma/client/runtime"
import { logger } from "./logger"
import { config } from "./config"
import { db } from "./db"
import { inspect } from "node:util"
import type { Message, PartialMessage, ReplyOptions } from "discord.js"

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.DIRECT_MESSAGES,
  ],
  partials: ["CHANNEL"],
})

client.once("ready", () => {
  logger.info(`logged in as '${client.user?.tag}'`)
})

client.on("messageCreate", async (message) => {
  if (message.author.id === client.user?.id) return

  if (config.admins.includes(message.author.id)) {
    const regex = /^>>\s*(?:```(?:js)?\r?\n([\S\s]+)\r?\n```|`(.+)`|(.+))\s*$/
    const matches = regex.exec(message.content)

    if (matches) {
      const code = matches[1] ?? matches[2] ?? matches[3]
      const result = await exec(code)

      const [first, ...rest] = inspect(result, {
        depth: 4,
        getters: true,
        maxStringLength: 400,
        sorted: true,
      }).match(/[\S\s]{1,1980}(?:\n|$)/g) ?? [""]

      if (rest.length === 0) {
        await message.reply(["```js", first, "```"].join("\n"))
      } else {
        await message.reply(["```js", first, "```"].join("\n"))
        for (const chunk of rest) {
          await message.channel.send(["```js", chunk, "```"].join("\n"))
        }
      }

      return
    }
  }

  const cc = await channelConfig(message)
  if (!cc) return

  const otherChannel = await client.channels.fetch(cc.other!.id)
  if (otherChannel?.type !== "GUILD_TEXT" && otherChannel?.type !== "DM") {
    logger.warn(`'${cc.other!.id}' is not a valid text channel`)
    return
  }

  const proxied = await otherChannel.send({
    ...makeMessage(message, cc.self.anonymous),
    reply: await makeReply(message),
  })

  await db.message.create({
    data: {
      original: message.id,
      originalChannel: message.channel.id,
      proxied: proxied.id,
      proxiedChannel: proxied.channel.id,
    },
  })
})

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (newMessage.author?.id === client.user?.id) return

  const cc = await channelConfig(newMessage)
  if (!cc) return

  const record = await db.message.findUnique({
    where: { original: oldMessage.id },
    select: { proxied: true },
  })
  if (!record) return

  const otherChannel = await client.channels.fetch(cc.other.id)
  if (otherChannel?.type !== "GUILD_TEXT" && otherChannel?.type !== "DM") {
    logger.warn(`'${cc.other.id}' is not a valid text channel`)
    return
  }

  const edit = makeMessage(newMessage, cc.self.anonymous, true)
  if (cc.self.anonymous) {
    const oldProxied = await otherChannel.messages.fetch(record.proxied)
    if (!oldProxied) return

    await oldProxied.edit(edit)
  } else {
    const newProxied = await otherChannel.send({
      ...edit,
      reply: { messageReference: record.proxied },
    })

    await db.message.update({
      where: { proxied: record.proxied },
      data: { proxied: newProxied.id },
    })
  }
})

client.on("messageDelete", async (message) => {
  if (message.author?.id === client.user?.id) return

  const cc = await channelConfig(message)
  if (!cc?.self.anonymous) return

  try {
    const { proxied, proxiedChannel } = await db.message.delete({
      where: { original: message.id },
      select: { proxied: true, proxiedChannel: true },
    })

    const c = await client.channels.fetch(proxiedChannel)
    if (c?.type !== "GUILD_TEXT" && c?.type !== "DM") return

    const m = await c.messages.fetch(proxied)
    await m?.delete()
  } catch (error) {
    const notFound =
      error instanceof PrismaClientKnownRequestError &&
      ["P2015", "P2018", "P2025"].includes(error.code)
    if (!notFound) {
      throw error
    }
  }
})

export { client }

async function channelConfig(message: Message | PartialMessage) {
  const cc = config.proxyChannels.find((channels) =>
    channels.some((c) => c.id === message.channel.id),
  )
  if (cc) {
    const self = cc.find((c) => c.id === message.channel.id)!
    const other = cc.find((c) => c.id !== message.channel.id)!
    return { self, other }
  }

  if (message.channel.id === config.dmChannel.id) {
    if (message.type !== "REPLY") return
    const reference = await message.fetchReference()

    const record = await db.message.findUnique({
      where: { proxied: reference.id },
      select: { originalChannel: true },
    })
    if (!record) return

    return {
      self: config.dmChannel,
      other: { id: record.originalChannel, anonymous: false },
    }
  }

  if (message.channel.type === "DM") {
    return {
      self: { id: message.channel.id, anonymous: false },
      other: config.dmChannel,
    }
  }
}

function makeMessage(
  message: Message | PartialMessage,
  anonymous: boolean,
  edit = false,
) {
  const content = anonymous ? message.content : undefined
  const embeds = anonymous
    ? undefined
    : [
        new MessageEmbed()
          .setAuthor({
            name: message.author?.tag ?? "unknown",
            iconURL: message.author?.displayAvatarURL(),
          })
          .setDescription(message.content ?? "")
          .setURL(message.url)
          .setTimestamp(edit ? message.editedAt : message.createdAt)
          .setTitle(
            edit
              ? "EDIT"
              : message.channel.type === "DM"
              ? "DM"
              : `#${message.channel.name}`,
          ),
      ]
  const files = [...message.attachments.values()]

  return {
    content,
    embeds,
    files,
  }
}

async function makeReply(message: Message): Promise<ReplyOptions | undefined> {
  if (message.type !== "REPLY") return

  const reference = await message.fetchReference()
  const proxiedReference =
    reference.author.id === client.user?.id
      ? await db.message
          .findUnique({
            where: { proxied: reference.id },
            select: { original: true },
          })
          .then((r) => r?.original)
      : await db.message
          .findUnique({
            where: { original: reference.id },
            select: { proxied: true },
          })
          .then((r) => r?.proxied)

  if (proxiedReference) {
    return { messageReference: proxiedReference, failIfNotExists: false }
  }
}

const AsyncFunction = Object.getPrototypeOf(async function () {
  return
}).constructor
async function exec(code: string): Promise<unknown> {
  const f = new AsyncFunction("client", "db", "config", "logger", code)

  try {
    return await f(client, db, config, logger)
  } catch (error) {
    return error
  }
}
