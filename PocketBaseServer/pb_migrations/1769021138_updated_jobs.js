/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // add field
  collection.fields.addAt(11, new Field({
    "hidden": false,
    "id": "select2540049030",
    "maxSelect": 1,
    "name": "boardType",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "select",
    "values": [
      "shopFloor",
      "admin"
    ]
  }))

  // add field
  collection.fields.addAt(12, new Field({
    "hidden": false,
    "id": "json2961414975",
    "maxSize": 0,
    "name": "checklists",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  // add field
  collection.fields.addAt(13, new Field({
    "cascadeDelete": false,
    "collectionId": "_pb_users_auth_",
    "hidden": false,
    "id": "relation3089989056",
    "maxSelect": 10,
    "minSelect": 0,
    "name": "workers",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2409499253")

  // remove field
  collection.fields.removeById("select2540049030")

  // remove field
  collection.fields.removeById("json2961414975")

  // remove field
  collection.fields.removeById("relation3089989056")

  return app.save(collection)
})
