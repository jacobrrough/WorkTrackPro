/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "createRule": "",
    "listRule": "@request.auth.id != \"\"",
    "updateRule": "@request.auth.id != \"\" && user = @request.auth.id"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_705563745")

  // update collection data
  unmarshal({
    "createRule": null,
    "listRule": null,
    "updateRule": null
  }, collection)

  return app.save(collection)
})
