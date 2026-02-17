/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_attachments")

  // add field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "bool1109354278",
    "name": "isAdminOnly",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_attachments")

  // remove field
  collection.fields.removeById("bool1109354278")

  return app.save(collection)
})
