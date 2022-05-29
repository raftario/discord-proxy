import pino from "pino"

const logger = pino()
logger.level = process.env.LOG_LEVEL ?? "info"

export { logger }
