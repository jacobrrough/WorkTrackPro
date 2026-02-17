/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_ypdvTFsESc` ON `shifts` (`user`)",
      "CREATE INDEX `idx_QqMXVW8Fml` ON `shifts` (`job`)",
      "CREATE INDEX `idx_Qac6PuIQ8v` ON `shifts` (\n  `job`,\n  `clockOutTime`\n)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
