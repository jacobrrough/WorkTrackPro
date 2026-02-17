/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3573984430")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\"",
    "deleteRule": "@request.auth.isAdmin = true",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3573984430")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "updateRule": "@request.auth.id != \"\" && @request.auth.isAdmin = true",
    "viewRule": null
  }, collection)

  return app.save(collection)
})
