/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_inventory")

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "number547800793",
    "max": null,
    "min": 0,
    "name": "onOrder",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_inventory")

  // remove field
  collection.fields.removeById("number547800793")

  return app.save(collection)
})
