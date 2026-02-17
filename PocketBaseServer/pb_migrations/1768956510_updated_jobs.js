/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_NwrFENyr54` ON `jobs` (`jobCode`)",
      "CREATE INDEX `idx_SYXAdBfDfQ` ON `jobs` (`status`)",
      "CREATE INDEX `idx_YcRlhSeRGO` ON `jobs` (`active`)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE UNIQUE INDEX `idx_F2Nj6FmJGC` ON `jobs` (`po`)",
      "CREATE UNIQUE INDEX `idx_NwrFENyr54` ON `jobs` (`jobCode`)",
      "CREATE INDEX `idx_lvdkWIe4xr` ON `jobs` (`name`)",
      "CREATE INDEX `idx_SYXAdBfDfQ` ON `jobs` (`status`)",
      "CREATE INDEX `idx_YcRlhSeRGO` ON `jobs` (`active`)"
    ]
  }, collection)

  return app.save(collection)
})
