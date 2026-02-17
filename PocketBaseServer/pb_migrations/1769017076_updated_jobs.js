/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.isAdmin = true"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.auth.isAdmin = true",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.isAdmin = true"
  }, collection)

  return app.save(collection)
})
