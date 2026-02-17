/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2678691926")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_TcnlkZEPPx` ON `job_inventory` (\n  `job`,\n  `inventory`\n)",
      "CREATE INDEX `idx_MXAcszqIxs` ON `job_inventory` (`job`)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2678691926")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
