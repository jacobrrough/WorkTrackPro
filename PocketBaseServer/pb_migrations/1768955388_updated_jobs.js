/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "createRule": "@request.auth.id != \"\" && @request.auth.isAdmin = true",
    "deleteRule": "@request.auth.id != \"\" && @request.auth.isAdmin = true",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // update collection data
  unmarshal({
    "createRule": null,
    "deleteRule": null,
    "listRule": "@request.auth.id != null",
    "updateRule": null,
    "viewRule": "@request.auth.id != null"
  }, collection)

  return app.save(collection)
})
