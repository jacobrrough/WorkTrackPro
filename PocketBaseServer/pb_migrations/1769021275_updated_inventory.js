/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3573984430")

  // add field
  collection.fields.addAt(8, new Field({
    "hidden": false,
    "id": "number1013902401",
    "max": null,
    "min": 0,
    "name": "disposed",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(9, new Field({
    "hidden": false,
    "id": "number3379313095",
    "max": null,
    "min": 0,
    "name": "received",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(10, new Field({
    "hidden": false,
    "id": "number2559139823",
    "max": null,
    "min": null,
    "name": "stockValue",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "bool1356056606",
    "name": "needsReorder",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "number1605135047",
    "max": null,
    "min": 0,
    "name": "reconcile",
    "onlyInt": false,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3573984430")

  // remove field
  collection.fields.removeById("number1013902401")

  // remove field
  collection.fields.removeById("number3379313095")

  // remove field
  collection.fields.removeById("number2559139823")

  // remove field
  collection.fields.removeById("bool1356056606")

  // remove field
  collection.fields.removeById("number1605135047")

  return app.save(collection)
})
