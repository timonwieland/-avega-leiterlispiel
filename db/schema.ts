import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rooms = sqliteTable("rooms", {
  code: text("code").primaryKey(),
  state: text("state").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
