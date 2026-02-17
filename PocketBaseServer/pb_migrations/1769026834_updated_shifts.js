/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "deleteRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\""
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "deleteRule": null,
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id",
    "viewRule": null
  }, collection)

  return app.save(collection)
})
