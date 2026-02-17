/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_inventory")

  // update field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number_inStock",
    "max": null,
    "min": 0,
    "name": "inStock",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "number_available",
    "max": null,
    "min": 0,
    "name": "available",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_inventory")

  // update field
  collection.fields.addAt(3, new Field({
    "hidden": false,
    "id": "number_inStock",
    "max": null,
    "min": 0,
    "name": "inStock",
    "onlyInt": true,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  // update field
  collection.fields.addAt(4, new Field({
    "hidden": false,
    "id": "number_available",
    "max": null,
    "min": 0,
    "name": "available",
    "onlyInt": true,
    "presentable": false,
    "required": true,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
})
