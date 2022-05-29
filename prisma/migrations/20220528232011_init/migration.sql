-- CreateTable
CREATE TABLE "Message" (
    "original" TEXT NOT NULL PRIMARY KEY,
    "originalChannel" TEXT NOT NULL,
    "proxied" TEXT NOT NULL,
    "proxiedChannel" TEXT NOT NULL,
    "time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_proxied_key" ON "Message"("proxied");

-- CreateIndex
CREATE INDEX "Message_time_idx" ON "Message"("time");
